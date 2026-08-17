import 'dotenv/config';
import { createServer } from 'node:http';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';
import { validateOffer } from '../../packages/shared/catalog.mjs';

const port = Number(process.env.PORT || 8080);
const appDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(appDir, '../..');
const dataFile = process.env.OPHRA_DATA_FILE || join(appDir, 'local-store.json');
const allowedOrigins = String(process.env.CORS_ORIGIN || 'http://localhost:5173,http://localhost:5174,http://localhost:5175').split(',').map((origin) => origin.trim()).filter(Boolean);
const serveWeb = process.env.OPHRA_SERVE_WEB === 'true';
const webDist = resolve(process.env.OPHRA_WEB_DIST || join(workspaceRoot, 'apps/web/dist'));
const databaseUrl = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || '';
const sql = databaseUrl ? neon(databaseUrl) : null;
const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH || process.env.VITE_ADMIN_PASSWORD_HASH || '';
const adminPasswordSalt = process.env.ADMIN_PASSWORD_SALT || process.env.VITE_ADMIN_PASSWORD_SALT || '';
const adminSessionSecret = process.env.ADMIN_SESSION_SECRET || adminPasswordHash || randomBytes(32).toString('hex');
const adminCookieName = 'ophra_admin_session';
const adminSessionTtlMs = Number(process.env.ADMIN_SESSION_TTL_MS || 8 * 60 * 60 * 1000);
const maxJsonBytes = Number(process.env.OPHRA_MAX_JSON_BYTES || 5 * 1024 * 1024);
const loginAttempts = new Map();
const emptyStore = {
  products: [],
  productGroups: [],
  orders: [],
  customRequests: [],
  quotations: [],
  categories: [],
  transports: [],
  users: [],
  customers: [],
  supplierProfile: {},
  transportSettings: {},
};
const collectionMap = {
  '/products': 'products',
  '/product-groups': 'productGroups',
  '/orders': 'orders',
  '/custom-requests': 'customRequests',
  '/quotations': 'quotations',
  '/categories': 'categories',
  '/transports': 'transports',
  '/users': 'users',
  '/customers': 'customers',
};
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

async function ensureDatabase() {
  if (!sql) return;
  await sql`CREATE TABLE IF NOT EXISTS ophra_store (
    id text PRIMARY KEY,
    data jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`;
}

async function readFileStore() {
  try { return { ...emptyStore, ...JSON.parse(await readFile(dataFile, 'utf8')) }; }
  catch { return { ...emptyStore }; }
}

async function writeFileStore(store) {
  await mkdir(dirname(dataFile), { recursive: true });
  await writeFile(dataFile, JSON.stringify({ ...emptyStore, ...store }, null, 2));
}

async function readStore() {
  if (!sql) return readFileStore();
  await ensureDatabase();
  const rows = await sql`SELECT data FROM ophra_store WHERE id = 'main' LIMIT 1`;
  return { ...emptyStore, ...(rows[0]?.data || {}) };
}

async function writeStore(store) {
  const next = { ...emptyStore, ...store };
  if (!sql) return writeFileStore(next);
  await ensureDatabase();
  await sql`INSERT INTO ophra_store (id, data, updated_at) VALUES ('main', ${JSON.stringify(next)}::jsonb, now())
    ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
}


function storageLabel() {
  return sql ? 'neon' : 'file';
}

function originAllowed(origin) {
  if (!origin) return true;
  return allowedOrigins.includes('*') || allowedOrigins.includes(origin);
}

function responseOrigin(request) {
  const origin = request.headers.origin || '';
  if (origin && originAllowed(origin)) return origin;
  return allowedOrigins.includes('*') ? '*' : allowedOrigins[0] || 'null';
}

function securityHeaders(request, extra = {}) {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': responseOrigin(request),
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    ...extra,
  };
}

function send(request, response, status, body, extraHeaders = {}) {
  response.writeHead(status, securityHeaders(request, extraHeaders));
  response.end(status === 204 ? '' : JSON.stringify(body));
}

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxJsonBytes) throw fail(413, 'Request body is too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw fail(400, 'Invalid JSON body');
  }
}

function parseCookies(request) {
  return Object.fromEntries(String(request.headers.cookie || '').split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=');
    return index === -1 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
  }));
}

function passwordHash(password) {
  return createHash('sha256').update(`${adminPasswordSalt}:${password}`).digest('hex');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''), 'hex');
  const right = Buffer.from(String(b || ''), 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

function sign(value) {
  return createHmac('sha256', adminSessionSecret).update(value).digest('base64url');
}

function createSessionToken() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + adminSessionTtlMs, nonce: randomBytes(12).toString('hex') })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function verifySessionToken(token) {
  const [payload, signature] = String(token || '').split('.');
  if (!payload || !signature || sign(payload) !== signature) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number(data.exp || 0) > Date.now();
  } catch {
    return false;
  }
}

function cookieHeader(token = '') {
  const secure = process.env.OPHRA_COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production';
  const maxAge = token ? Math.floor(adminSessionTtlMs / 1000) : 0;
  return `${adminCookieName}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function isAdminRequest(request) {
  return verifySessionToken(parseCookies(request)[adminCookieName]);
}

function adminAuthReady() {
  return Boolean(adminPasswordHash && adminPasswordSalt);
}

function clientIp(request) {
  return String(request.headers['x-forwarded-for'] || request.socket.remoteAddress || 'unknown').split(',')[0].trim();
}

function loginAllowed(request) {
  const key = clientIp(request);
  const now = Date.now();
  const attempts = (loginAttempts.get(key) || []).filter((time) => now - time < 15 * 60 * 1000);
  if (attempts.length >= 8) return false;
  attempts.push(now);
  loginAttempts.set(key, attempts);
  return true;
}

function requireAdmin(request, response) {
  if (!adminAuthReady()) {
    send(request, response, 503, { error: 'Admin server authentication is not configured' });
    return false;
  }
  if (!isAdminRequest(request)) {
    send(request, response, 401, { error: 'Admin login required' });
    return false;
  }
  return true;
}

function collectionName(pathname) {
  return collectionMap[pathname];
}

function collectionPath(pathname) {
  const [, name, id] = pathname.match(/^\/([^/]+)\/?([^/]*)$/) || [];
  const base = name ? `/${name}` : pathname;
  return { collection: collectionName(base), id: id ? decodeURIComponent(id) : '' };
}

function singularName(collection) {
  if (collection === 'customRequests') return 'customRequest';
  if (collection.endsWith('ies')) return collection.slice(0, -3) + 'y';
  return collection.endsWith('s') ? collection.slice(0, -1) : collection;
}

function idFor(collection) {
  return `${singularName(collection)}_${Date.now()}`;
}

function normalizeImageUrl(value) {
  const image = String(value || '').trim();
  if (!image || image.startsWith('data:') || image.startsWith('blob:')) return '';
  return image;
}

function sanitizeRecord(collection, record) {
  if (!record || typeof record !== 'object') return record;
  const clean = { ...record };
  if (collection === 'productGroups') {
    clean.image = normalizeImageUrl(clean.image);
  }
  if (collection === 'products') {
    clean.image = normalizeImageUrl(clean.image);
    if (Array.isArray(clean.examples)) {
      clean.examples = clean.examples.map((item) => typeof item === 'object' && item ? { ...item, image: normalizeImageUrl(item.image) } : item);
    }
  }
  if (collection === 'customRequests') {
    clean.image = normalizeImageUrl(clean.image);
  }
  return clean;
}

function sanitizeCollection(collection, records) {
  return Array.isArray(records) ? records.map((record) => sanitizeRecord(collection, record)) : records;
}

async function sendFile(request, response) {
  if (!serveWeb || request.method !== 'GET') return false;
  const pathname = decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname);
  const requested = pathname === '/' ? '/index.html' : pathname;
  const candidate = normalize(join(webDist, requested));
  const filePath = candidate === webDist || candidate.startsWith(webDist + sep) ? candidate : join(webDist, 'index.html');

  try {
    const file = await readFile(filePath);
    response.writeHead(200, { 'Content-Type': contentTypes[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    response.end(file);
    return true;
  } catch {
    if (requested !== '/index.html') {
      try {
        const index = await readFile(join(webDist, 'index.html'));
        response.writeHead(200, { 'Content-Type': contentTypes['.html'] });
        response.end(index);
        return true;
      } catch {}
    }
    return false;
  }
}


function publicCollectionRead(collection) {
  return ['products', 'productGroups', 'categories'].includes(collection);
}

function publicCollectionCreate(collection) {
  return ['orders', 'customRequests', 'quotations', 'customers'].includes(collection);
}

function publicSettings(store) {
  const supplier = store.supplierProfile || {};
  return {
    transportSettings: store.transportSettings || {},
    supplierProfile: {
      companyName: supplier.companyName,
      logo: supplier.logo,
      phone: supplier.phone,
      location: supplier.location,
      email: supplier.email,
      tin: supplier.tin,
      vrn: supplier.vrn,
    },
  };
}

function createSecureOrder(store, body) {
  const requestedItems = Array.isArray(body.items) ? body.items : [];
  if (!requestedItems.length) throw fail(400, 'Order has no items');
  const nextProducts = [...store.products];
  const orderItems = requestedItems.map((item) => {
    const productIndex = nextProducts.findIndex((product) => product.id === item.productId);
    if (productIndex === -1) throw fail(422, 'A product in this order is no longer available');
    const product = nextProducts[productIndex];
    const quantity = Math.max(1, Number(item.quantity || 1));
    const stock = Math.max(0, Number(product.stock || 0));
    const price = Math.max(0, Number(product.price || 0));
    if (price <= 0) throw fail(422, `${product.name || 'Product'} requires a price confirmation`);
    if (quantity > stock) throw fail(422, `${product.name || 'Product'} has only ${stock} available`);
    const soldRevenue = quantity * price;
    nextProducts[productIndex] = {
      ...product,
      stock: stock - quantity,
      sold: Number(product.sold || 0) + quantity,
      revenue: Number(product.revenue || 0) + soldRevenue,
    };
    return {
      cartKey: item.cartKey || item.productId,
      productId: product.id,
      name: product.name,
      localName: item.localName || product.localName || '',
      image: product.image,
      price,
      unit: product.unit || item.unit || 'Piece',
      stock,
      quantity,
      selectedVariety: item.selectedVariety || '',
      selectedGrade: item.selectedGrade || '',
      selectedSize: item.selectedSize || '',
    };
  });
  const itemsTotal = orderItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const deliveryFee = Math.max(0, Number(body.deliveryFee || body.delivery?.fee || 0));
  const order = {
    id: body.id || 'ord_' + Date.now(),
    receiptNo: body.receiptNo || `RCT-${Date.now()}`,
    customerId: body.customerId,
    customerEmail: body.customerEmail,
    customer: body.customer || 'Storefront customer',
    status: body.status || 'Pending',
    paymentStatus: 'Pending payment',
    items: orderItems,
    createdAt: body.createdAt || new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }),
    createdAtIso: body.createdAtIso || new Date().toISOString(),
    itemsTotal,
    delivery: body.delivery || null,
    deliveryFee,
    total: itemsTotal + deliveryFee,
  };
  return { order, nextProducts };
}

const server = createServer(async (request, response) => {
  try {
    if (!originAllowed(request.headers.origin || '')) return send(request, response, 403, { error: 'Origin is not allowed' });
    const url = new URL(request.url || '/', 'http://' + request.headers.host);
    if (request.method === 'OPTIONS') return send(request, response, 204, {});

    if (request.method === 'POST' && url.pathname === '/admin/login') {
      if (!adminAuthReady()) return send(request, response, 503, { error: 'Admin server authentication is not configured' });
      if (!loginAllowed(request)) return send(request, response, 429, { error: 'Too many login attempts. Please try again later.' });
      const body = await readBody(request);
      if (!safeEqual(passwordHash(body.password || ''), adminPasswordHash)) return send(request, response, 401, { error: 'Incorrect admin password' });
      return send(request, response, 200, { ok: true }, { 'Set-Cookie': cookieHeader(createSessionToken()) });
    }
    if (request.method === 'POST' && url.pathname === '/admin/logout') return send(request, response, 200, { ok: true }, { 'Set-Cookie': cookieHeader('') });
    if (request.method === 'GET' && url.pathname === '/admin/session') return send(request, response, 200, { authenticated: isAdminRequest(request) });

    if (request.method === 'GET' && url.pathname === '/health') return send(request, response, 200, { ok: true, service: 'ophra-api', storage: storageLabel() });
    const store = await readStore();
    if (request.method === 'GET' && url.pathname === '/') return send(request, response, 200, { ok: true, service: 'ophra-api', health: '/health' });
    if (request.method === 'GET' && url.pathname === '/store') {
      if (!requireAdmin(request, response)) return;
      return send(request, response, 200, store);
    }
    if (request.method === 'PUT' && url.pathname === '/store') {
      if (!requireAdmin(request, response)) return;
      const body = await readBody(request);
      const next = { ...emptyStore, ...body, products: sanitizeCollection('products', body.products || []), productGroups: sanitizeCollection('productGroups', body.productGroups || []), customRequests: sanitizeCollection('customRequests', body.customRequests || []) };
      await writeStore(next);
      return send(request, response, 200, next);
    }
    if (request.method === 'GET' && url.pathname === '/settings') {
      return send(request, response, 200, isAdminRequest(request) ? { supplierProfile: store.supplierProfile, transportSettings: store.transportSettings } : publicSettings(store));
    }
    if (request.method === 'PUT' && url.pathname === '/settings') {
      if (!requireAdmin(request, response)) return;
      const body = await readBody(request);
      const next = { ...store, supplierProfile: body.supplierProfile || store.supplierProfile, transportSettings: body.transportSettings || store.transportSettings };
      await writeStore(next);
      return send(request, response, 200, { supplierProfile: next.supplierProfile, transportSettings: next.transportSettings });
    }

    const { collection, id } = collectionPath(url.pathname);
    if (request.method === 'GET' && collection) {
      if (!publicCollectionRead(collection) && !requireAdmin(request, response)) return;
      return send(request, response, 200, { [collection]: store[collection] });
    }
    if (request.method === 'POST' && url.pathname === '/quote/check') return send(request, response, 200, validateOffer(await readBody(request), store.products));
    if (request.method === 'POST' && collection) {
      if (!publicCollectionCreate(collection) && !requireAdmin(request, response)) return;
      const body = sanitizeRecord(collection, await readBody(request));
      if (collection === 'orders') {
        const { order, nextProducts } = createSecureOrder(store, body);
        store.products = nextProducts;
        store.orders.unshift(order);
        await writeStore(store);
        return send(request, response, 201, { order, check: { accepted: true, total: order.total } });
      }
      const singular = singularName(collection);
      const record = { id: body.id || idFor(collection), ...body, status: body.status || (collection === 'customRequests' ? 'Pending' : body.status) };
      store[collection].unshift(record);
      await writeStore(store);
      return send(request, response, 201, { [singular]: record });
    }
    if (request.method === 'PUT' && collection) {
      if (!requireAdmin(request, response)) return;
      const body = await readBody(request);
      const incoming = Array.isArray(body) ? body : body[collection] || store[collection];
      store[collection] = sanitizeCollection(collection, incoming);
      await writeStore(store);
      return send(request, response, 200, { [collection]: store[collection] });
    }
    if (request.method === 'PATCH' && collection && id) {
      if (!requireAdmin(request, response)) return;
      const body = sanitizeRecord(collection, await readBody(request));
      let updated = null;
      store[collection] = store[collection].map((record) => {
        if (record.id !== id) return record;
        updated = { ...record, ...body };
        return updated;
      });
      if (!updated) return send(request, response, 404, { error: 'Record not found' });
      await writeStore(store);
      return send(request, response, 200, { [singularName(collection)]: updated });
    }
    if (request.method === 'DELETE' && collection && id) {
      if (!requireAdmin(request, response)) return;
      const before = store[collection].length;
      store[collection] = store[collection].filter((record) => record.id !== id);
      if (store[collection].length === before) return send(request, response, 404, { error: 'Record not found' });
      await writeStore(store);
      return send(request, response, 200, { deleted: true, id });
    }
    if (await sendFile(request, response)) return;
    return send(request, response, 404, { error: 'Not found' });
  } catch (error) {
    return send(request, response, error.status || 500, { error: error.message || 'Server error' });
  }
});

server.listen(port, () => console.log('OPHRA API running on http://localhost:' + port));
