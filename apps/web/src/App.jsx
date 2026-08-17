import { Clipboard, ClipboardList, LayoutDashboard, MapPin, Menu, PackageOpen, Phone, Search, ShoppingCart, Tags, Truck, UsersRound, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import './index.css';
import { adminLogin, adminLogout, createRecord, getCollection, getSettings, hasApi, replaceCollection, saveSettings, updateRecord } from './lib/api';
import { ensureProducts, money, readStore, slug, writeStore } from './lib/store';

const QUOTATION_LIMIT = 1000000;
const VAT_RATE = 0.18;
const BRAND_NAME = 'OPHRA GENERAL SUPPLY';
const OPHRA_PHONE = import.meta.env.VITE_OPHRA_PHONE || ''; // Add the real OPHRA phone number in apps/web/.env or hosting env.
const CLOUDINARY_CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || '';
const CLOUDINARY_UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || '';
const CLOUDINARY_UPLOAD_FOLDER = import.meta.env.VITE_CLOUDINARY_UPLOAD_FOLDER || 'ophra-products';
const ADMIN_PASSWORD_HASH = import.meta.env.VITE_ADMIN_PASSWORD_HASH || '';
const ADMIN_PASSWORD_SALT = import.meta.env.VITE_ADMIN_PASSWORD_SALT || '';
const ADMIN_SESSION_KEY = 'ophraAdminSession';
const CUSTOMER_SESSION_KEY = 'ophraCustomerSession';
const ADMIN_INACTIVITY_TIMEOUT_MS = Number(import.meta.env.VITE_ADMIN_INACTIVITY_TIMEOUT_MS || 15 * 60 * 1000);
const ADMIN_HARD_SESSION_MS = Number(import.meta.env.VITE_ADMIN_HARD_SESSION_MS || 8 * 60 * 60 * 1000);
const CUSTOMER_INACTIVITY_TIMEOUT_MS = Number(import.meta.env.VITE_CUSTOMER_INACTIVITY_TIMEOUT_MS || 30 * 60 * 1000);
const CUSTOMER_HARD_SESSION_MS = Number(import.meta.env.VITE_CUSTOMER_HARD_SESSION_MS || 24 * 60 * 60 * 1000);
const SESSION_ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'scroll', 'touchstart', 'focus'];
const DEPARTMENTS = ['Hardware Tools', 'Food Products'];
const ALL_DEPARTMENTS = 'All Departments';
const STORE_PAGE_SIZE = 12;
const LOW_STOCK_LIMIT = 5;
const BLANK_PRODUCT = {
  name: '',
  localName: '',
  department: 'Hardware Tools',
  category: '',
  groupId: '',
  unit: 'Piece',
  price: '',
  stock: 0,
  image: '',
  description: '',
  tag: 'Available',
};
const BLANK_GROUP = {
  name: '',
  department: 'Hardware Tools',
  parentId: '',
  image: '',
  description: '',
  sortOrder: 0,
};
const BLANK_FAMILY_PRODUCT = {
  id: '',
  name: '',
  localName: '',
  category: '',
  unit: 'Piece',
  price: '',
  stock: 0,
  image: '',
  description: '',
  tag: 'Available',
};
const emptySupplierProfile = {
  companyName: BRAND_NAME,
  logo: '/ophra-logo.png',
  tin: '',
  vrn: '',
  poBox: '',
  phone: '',
  location: '',
  email: '',
  bankAccount: '',
};
const DEFAULT_TRANSPORT_SETTINGS = {
  enabled: true,
  officeName: 'OPHRA GENERAL SUPPLY Offices',
  officeAddress: '',
  officeLat: '',
  officeLng: '',
  baseFee: 0,
  pricePerKm: 0,
  minimumFee: 0,
  expectedDeliveryTime: '1-3 business days',
};

function App() {
  const path = window.location.pathname;
  if (path.includes('admin')) return <AdminPanel />;
  if (path.includes('account')) return <CustomerAccountPage />;
  return <Storefront />;
}

function getSupplierProfile() {
  return { ...emptySupplierProfile, ...readStore('ophraSupplierProfile', {}) };
}

function ophraPhone() {
  return String(getSupplierProfile().phone || OPHRA_PHONE).trim();
}

function canShowPrice(product) {
  return Number(product.price || 0) > 0;
}

function normalizeDepartment(value) {
  const department = String(value || '').trim();
  return DEPARTMENTS.includes(department) ? department : DEPARTMENTS[0];
}

function phoneHref(phone) {
  return `tel:${String(phone || '').replace(/\s+/g, '')}`;
}

async function copyText(value) {
  if (!value) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

function nowLabel() {
  return new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

function nowIso() {
  return new Date().toISOString();
}

async function loadCollection(collection, localKey, fallback = []) {
  if (hasApi) {
    try {
      const records = await getCollection(collection);
      const cleanRecords = collection === 'products' ? records.map(normalizeProduct) : collection === 'productGroups' ? records.map(normalizeCatalogGroup) : records;
      writeStore(localKey, cleanRecords);
      return cleanRecords;
    } catch (error) {
      console.warn('Using local data for', collection, error);
    }
  }
  const local = readStore(localKey, fallback);
  if (!Array.isArray(local)) return fallback;
  if (collection !== 'products' && collection !== 'productGroups') return local;
  const cleanLocal = collection === 'products' ? local.map(normalizeProduct) : local.map(normalizeCatalogGroup);
  writeStore(localKey, cleanLocal);
  return cleanLocal;
}

async function saveCollection(collection, localKey, records) {
  const cleanRecords = collection === 'products' ? records.map(normalizeProduct) : collection === 'productGroups' ? records.map(normalizeCatalogGroup) : records;
  writeStore(localKey, cleanRecords);
  if (!hasApi) return cleanRecords;
  try {
    return await replaceCollection(collection, cleanRecords);
  } catch (error) {
    console.warn('Could not save remote collection', collection, error);
    return cleanRecords;
  }
}

async function addRemoteRecord(collection, localKey, record) {
  if (!hasApi) {
    const next = [record, ...readStore(localKey, [])];
    writeStore(localKey, next);
    return record;
  }
  try {
    return await createRecord(collection, record);
  } catch (error) {
    console.warn('Could not create remote record', collection, error);
    const next = [record, ...readStore(localKey, [])];
    writeStore(localKey, next);
    return record;
  }
}

function normalizeImageUrl(value) {
  const image = String(value || '').trim();
  if (!image || image.startsWith('data:') || image.startsWith('blob:')) return '';
  return image;
}

async function uploadImageToCloudinary(file) {
  if (!file) return '';
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_UPLOAD_PRESET) {
    throw new Error('Cloudinary is not configured. Add VITE_CLOUDINARY_CLOUD_NAME and VITE_CLOUDINARY_UPLOAD_PRESET.');
  }

  const form = new FormData();
  form.append('file', file);
  form.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
  if (CLOUDINARY_UPLOAD_FOLDER) form.append('folder', CLOUDINARY_UPLOAD_FOLDER);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
    method: 'POST',
    body: form,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || 'Cloudinary upload failed.');
  const imageUrl = normalizeImageUrl(body.secure_url || body.url);
  if (!imageUrl) throw new Error('Cloudinary did not return an image URL.');
  return imageUrl;
}

function getTransportSettings() {
  return { ...DEFAULT_TRANSPORT_SETTINGS, ...readStore('ophraTransportSettings', {}) };
}

function toNumber(value) {
  return Number(value || 0);
}

function parseCoordinates(value) {
  const text = String(value || '');
  const atMatch = text.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  const queryMatch = text.match(/[?&](?:q|query|destination|daddr)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  const plainMatch = text.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  const match = atMatch || queryMatch || plainMatch;
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function distanceKmBetween(start, end) {
  const earthKm = 6371;
  const toRad = (degree) => degree * Math.PI / 180;
  const dLat = toRad(end.lat - start.lat);
  const dLng = toRad(end.lng - start.lng);
  const lat1 = toRad(start.lat);
  const lat2 = toRad(end.lat);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return earthKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function optionTextToList(value) {
  return String(value || '').split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);
}

function listToOptionText(value) {
  return Array.isArray(value) ? value.join('\n') : '';
}

function calculateDeliveryFee(distanceKm, settings) {
  if (!distanceKm || distanceKm <= 0) return 0;
  const fee = toNumber(settings.baseFee) + distanceKm * toNumber(settings.pricePerKm);
  return Math.max(toNumber(settings.minimumFee), Math.round(fee));
}

function expectedDeliveryTime(settings) {
  return String(settings?.expectedDeliveryTime || DEFAULT_TRANSPORT_SETTINGS.expectedDeliveryTime).trim() || DEFAULT_TRANSPORT_SETTINGS.expectedDeliveryTime;
}

function googleDirectionsUrl(settings, destination) {
  const origin = settings.officeLat && settings.officeLng ? `${settings.officeLat},${settings.officeLng}` : settings.officeAddress || settings.officeName;
  const target = destination || '';
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(target)}`;
}

function googleMapEmbedUrl(value) {
  const query = value || 'Tanzania';
  return `https://maps.google.com/maps?q=${encodeURIComponent(query)}&z=14&output=embed`;
}

function customerKey(email) {
  return String(email || '').trim().toLowerCase();
}

function readCustomers() {
  const customers = readStore('ophraCustomers', []);
  return Array.isArray(customers) ? customers : [];
}

function sessionFresh(session, inactivityTimeoutMs, hardTimeoutMs) {
  if (!session?.createdAt || !session?.lastActiveAt) return false;
  const now = Date.now();
  return now - Number(session.lastActiveAt) <= inactivityTimeoutMs && now - Number(session.createdAt) <= hardTimeoutMs;
}

function currentCustomer() {
  const session = readStore(CUSTOMER_SESSION_KEY, null);
  if (!session?.email) return null;
  if (!sessionFresh(session, CUSTOMER_INACTIVITY_TIMEOUT_MS, CUSTOMER_HARD_SESSION_MS)) {
    saveCustomerSession(null);
    return null;
  }
  return readCustomers().find((customer) => customer.email === session.email) || null;
}

function saveCustomerSession(customer) {
  if (customer) writeStore(CUSTOMER_SESSION_KEY, { email: customer.email, createdAt: Date.now(), lastActiveAt: Date.now() });
  else localStorage.removeItem(CUSTOMER_SESSION_KEY);
}

function touchCustomerSession() {
  const session = readStore(CUSTOMER_SESSION_KEY, null);
  if (!session?.email || !sessionFresh(session, CUSTOMER_INACTIVITY_TIMEOUT_MS, CUSTOMER_HARD_SESSION_MS)) {
    saveCustomerSession(null);
    return false;
  }
  writeStore(CUSTOMER_SESSION_KEY, { ...session, lastActiveAt: Date.now() });
  return true;
}

function randomSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password, salt) {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function upsertCustomer(customer) {
  const normalized = { ...customer, email: customerKey(customer.email), name: String(customer.name || '').trim() };
  const customers = readCustomers();
  const exists = customers.some((item) => item.email === normalized.email);
  const next = exists ? customers.map((item) => item.email === normalized.email ? { ...item, ...normalized } : item) : [{ ...normalized, id: `customer-${Date.now()}`, createdAt: nowLabel(), createdAtIso: nowIso() }, ...customers];
  writeStore('ophraCustomers', next);
  const saved = next.find((item) => item.email === normalized.email);
  saveCustomerSession(saved);
  return saved;
}

function customerOrders(customer) {
  if (!customer) return [];
  return readStore('ophraOrdersAdmin', []).filter((order) => order.customerId === customer.id || order.customerEmail === customer.email);
}

function customerQuotes(customer) {
  if (!customer) return [];
  return readStore('ophraQuotations', []).filter((quote) => quote.customerId === customer.id || quote.customer?.email === customer.email || quote.customer?.contact === customer.email);
}

function printHtml(title, body) {
  const win = window.open('', '_blank', 'width=860,height=900');
  if (!win) return;
  win.document.write(`<!doctype html><html><head><title>${title}</title><style>body{font-family:Segoe UI,Inter,system-ui,sans-serif;padding:28px;color:#0f172a}.brand-head{display:flex;align-items:center;gap:20px;margin-bottom:18px}.brand-logo{width:180px;height:128px;object-fit:contain;background:#fff}.brand-title{margin:0;font-size:28px;line-height:1.1;font-weight:900;color:#102f43}.doc-title{margin:4px 0 0;font-size:18px;font-weight:800}.muted{color:#64748b}.row{display:flex;justify-content:space-between;border-bottom:1px solid #e2e8f0;padding:8px 0;gap:18px}.invoice-table,.invoice-meta,.invoice-summary{width:100%;border-collapse:collapse;margin-top:18px;border:1.5px solid #102f43}.invoice-meta{margin-top:8px}.invoice-summary{margin-top:0;border-top:0}.invoice-table th,.invoice-table td,.invoice-meta td,.invoice-summary td{border:1px solid #102f43;padding:10px;text-align:left;vertical-align:top}.invoice-table th{background:#eef5f8;font-weight:900}.invoice-meta td:first-child,.invoice-summary td:first-child{font-weight:700;width:42%}.invoice-meta td:last-child,.invoice-summary td:last-child{text-align:right;font-weight:900}.invoice-summary .total-row td{background:#eef5f8;font-size:17px;font-weight:900}.thanks{margin-top:18px}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{text-align:left;border:1px solid #102f43;padding:10px}button{margin-top:20px;padding:10px 18px}@media print{button{display:none}body{padding:16px}}</style></head><body>${body}<button onclick="window.print()">Print</button></body></html>`);
  win.document.close();
}

function printReceipt(order) {
  const rows = (order.items || []).map((item) => `<tr><td>${item.name}</td><td>${item.quantity}</td><td>${money.format(item.price)}</td><td>${money.format(item.price * item.quantity)}</td></tr>`).join('');
  printHtml(`Receipt ${order.receiptNo || order.id}`, `<h1>${BRAND_NAME} Receipt</h1><p class="muted">${order.receiptNo || order.id} - ${order.createdAt}</p><div class="row"><span>Customer</span><strong>${order.customer}</strong></div><table><thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table><div class="row"><span>Delivery</span><strong>${money.format(order.deliveryFee || 0)}</strong></div><div class="row"><span>Total</span><strong>${money.format(order.total || 0)}</strong></div><p>Thank you for choosing us.</p>`);
}

function printProforma(quote) {
  const supplier = quote.supplier || getSupplierProfile();
  const rows = (quote.items || []).map((item, index) => `<tr><td>${index + 1}</td><td>${item.description}</td><td>${item.quantity}</td><td>${money.format(item.price)}</td><td>${money.format(item.amount)}</td><td>${money.format(item.amountWithVat)}</td></tr>`).join('');
  const deliveryTime = quote.expectedDeliveryTime || quote.delivery?.expectedDeliveryTime || 'To be confirmed';
  printHtml(`Proforma ${quote.id}`, `<div class="brand-head"><img class="brand-logo" src="/ophra-logo.png" alt="${BRAND_NAME} logo" /><div><h1 class="brand-title">${BRAND_NAME}</h1><p class="doc-title">Proforma Invoice</p><p class="muted">${quote.approvedAt || quote.createdAt}</p></div></div><table class="invoice-meta"><tbody><tr><td>Supplier TIN</td><td>${supplier.tin || '-'}</td></tr><tr><td>Supplier VRN</td><td>${supplier.vrn || '-'}</td></tr><tr><td>Customer</td><td>${quote.customer?.name || 'Customer'}</td></tr></tbody></table><table class="invoice-table"><thead><tr><th>#</th><th>Description</th><th>Qty</th><th>Price</th><th>Amount</th><th>Amount + VAT</th></tr></thead><tbody>${rows}</tbody></table><table class="invoice-summary"><tbody><tr><td>Delivery charge</td><td>${money.format(quote.deliveryFee || 0)}</td></tr><tr><td>Expected delivery time</td><td>${deliveryTime}</td></tr><tr class="total-row"><td>Total</td><td>${money.format(quote.totalWithVat || 0)}</td></tr><tr><td>Bank account</td><td>${quote.bankAccount || '-'}</td></tr></tbody></table><p class="thanks">Thank you for choosing us.</p>`);
}

function proformaItems(items) {
  return items.map((item) => {
    const amount = Number(item.price || 0) * Number(item.quantity || 0);
    const vat = amount * VAT_RATE;
    return {
      description: `${item.name}${item.localName ? ` (${item.localName})` : ''}`,
      quantity: item.quantity,
      unit: item.unit,
      price: item.price,
      amount,
      vat,
      amountWithVat: amount + vat,
    };
  });
}

function normalizeProduct(product) {
  const name = String(product.name || '').trim();
  const id = product.id || slug(`${name}-${product.localName || product.category || Date.now()}`);
  return {
    ...product,
    id,
    name,
    localName: String(product.localName || '').trim(),
    department: normalizeDepartment(product.department),
    category: String(product.category || 'Uncategorized').trim(),
    groupId: String(product.groupId || '').trim(),
    unit: String(product.unit || 'Piece').trim(),
    price: product.price === '' || product.price === null || product.price === undefined ? 0 : Math.max(0, Number(product.price || 0)),
    stock: Math.max(0, Number(product.stock || 0)),
    image: normalizeImageUrl(product.image) || '/ophra-logo.png',
    description: String(product.description || '').trim(),
    examples: Array.isArray(product.examples) ? product.examples.map((item) => typeof item === 'object' && item ? { ...item, image: normalizeImageUrl(item.image) } : item) : [],
    tag: String(product.tag || 'Available').trim(),
    sold: Number(product.sold || 0),
    revenue: Number(product.revenue || 0),
  };
}

function normalizeCatalogGroup(group) {
  const name = String(group?.name || '').trim();
  const id = String(group?.id || slug(`${name || 'group'}-${group?.parentId || group?.department || Date.now()}`)).trim();
  return {
    ...group,
    id,
    name,
    department: normalizeDepartment(group?.department),
    parentId: String(group?.parentId || '').trim(),
    image: normalizeImageUrl(group?.image) || '/ophra-logo.png',
    description: String(group?.description || '').trim(),
    sortOrder: Number(group?.sortOrder || 0),
  };
}

function groupLabel(group, groups = []) {
  if (!group) return 'No group';
  const parents = [];
  let parent = groups.find((item) => item.id === group.parentId);
  while (parent && parents.length < 4) {
    parents.unshift(parent.name);
    parent = groups.find((item) => item.id === parent.parentId);
  }
  return [...parents, group.name].filter(Boolean).join(' / ');
}

function groupProductCount(group, products, groups) {
  const childIds = new Set([group.id]);
  let changed = true;
  while (changed) {
    changed = false;
    groups.forEach((item) => {
      if (item.parentId && childIds.has(item.parentId) && !childIds.has(item.id)) {
        childIds.add(item.id);
        changed = true;
      }
    });
  }
  return products.filter((product) => childIds.has(product.groupId)).length;
}

function Storefront() {
  const [products, setProducts] = useState(() => ensureProducts().map(normalizeProduct));
  const [productGroups, setProductGroups] = useState(() => {
    const groups = readStore('ophraProductGroups', []);
    return Array.isArray(groups) ? groups.map(normalizeCatalogGroup) : [];
  });
  const [department, setDepartment] = useState(ALL_DEPARTMENTS);
  const [activeGroupId, setActiveGroupId] = useState('');
  const [category, setCategory] = useState('All Categories');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [cart, setCart] = useState(() => {
    const savedCart = readStore('ophraCart', []);
    return Array.isArray(savedCart) ? savedCart : [];
  });
  const [cartOpen, setCartOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [detailProduct, setDetailProduct] = useState(null);
  const [notice, setNotice] = useState('');
  const [customImageFile, setCustomImageFile] = useState(null);
  const [customImagePreview, setCustomImagePreview] = useState('');
  const [customUploadStatus, setCustomUploadStatus] = useState('');
  const [customSubmitting, setCustomSubmitting] = useState(false);
  const [customer, setCustomer] = useState(() => currentCustomer());

  useSessionTimeout({
    enabled: Boolean(customer),
    sessionKey: CUSTOMER_SESSION_KEY,
    inactivityTimeoutMs: CUSTOMER_INACTIVITY_TIMEOUT_MS,
    hardTimeoutMs: CUSTOMER_HARD_SESSION_MS,
    touchSession: touchCustomerSession,
    onTimeout: () => {
      saveCustomerSession(null);
      setCustomer(null);
      setNotice('Your account session expired. Please log in again before checkout.');
    },
  });

  useEffect(() => {
    async function refreshCatalog() {
      const [nextProducts, nextGroups] = await Promise.all([
        loadCollection('products', 'ophraProducts', ensureProducts()),
        loadCollection('productGroups', 'ophraProductGroups', []),
      ]);
      setProducts(nextProducts);
      setProductGroups(nextGroups);
      setCustomer(currentCustomer());
    }
    function handleStorage(event) {
      if (!event.key || ['ophraProducts', 'shareDcProducts', 'ophraProductGroups', 'ophraCustomers', CUSTOMER_SESSION_KEY].includes(event.key)) refreshCatalog();
      if (!event.key || event.key === 'ophraCart') {
        const savedCart = readStore('ophraCart', []);
        setCart(Array.isArray(savedCart) ? savedCart : []);
      }
    }
    window.addEventListener('focus', refreshCatalog);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('focus', refreshCatalog);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  useEffect(() => {
    writeStore('ophraCart', cart);
  }, [cart]);

  const visibleDepartments = useMemo(() => [ALL_DEPARTMENTS, ...DEPARTMENTS], []);
  const queryText = query.trim().toLowerCase();
  const departmentProducts = useMemo(() => products.filter((product) => department === ALL_DEPARTMENTS || normalizeDepartment(product.department) === department), [products, department]);
  const departmentGroups = useMemo(() => productGroups.filter((group) => department === ALL_DEPARTMENTS || normalizeDepartment(group.department) === department).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)), [productGroups, department]);
  const activeGroup = departmentGroups.find((group) => group.id === activeGroupId) || null;
  const groupTrail = useMemo(() => {
    const trail = [];
    let group = activeGroup;
    while (group && trail.length < 6) {
      trail.unshift(group);
      group = departmentGroups.find((item) => item.id === group.parentId);
    }
    return trail;
  }, [activeGroup, departmentGroups]);
  const childGroups = departmentGroups.filter((group) => {
    const haystack = `${group.name} ${group.description} ${normalizeDepartment(group.department)}`.toLowerCase();
    if (queryText) return haystack.includes(queryText);
    return activeGroupId ? group.parentId === activeGroupId : !group.parentId;
  });
  const scopedProducts = departmentProducts.filter((product) => {
    const haystack = `${product.name} ${product.localName || ''} ${normalizeDepartment(product.department)} ${product.category} ${product.description}`.toLowerCase();
    if (queryText) return haystack.includes(queryText);
    return activeGroupId ? product.groupId === activeGroupId : !product.groupId;
  });
  const categories = useMemo(() => ['All Categories', ...new Set(scopedProducts.map((p) => p.category).filter(Boolean))], [scopedProducts]);
  const visibleProducts = scopedProducts.filter((p) => category === 'All Categories' || p.category === category);
  const listingItems = [
    ...childGroups.map((group) => ({ type: 'group', id: group.id, group })),
    ...visibleProducts.map((product) => ({ type: 'product', id: product.id, product })),
  ];
  const totalItems = listingItems.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / STORE_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * STORE_PAGE_SIZE;
  const pageItems = listingItems.slice(pageStart, pageStart + STORE_PAGE_SIZE);
  const pagedGroups = pageItems.filter((item) => item.type === 'group').map((item) => item.group);
  const pagedProducts = pageItems.filter((item) => item.type === 'product').map((item) => item.product);
  const shownFrom = totalItems ? pageStart + 1 : 0;
  const shownTo = Math.min(pageStart + pageItems.length, totalItems);
  const cartItemCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  useEffect(() => {
    setPage(1);
  }, [department, activeGroupId, category, queryText]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  function showDone(message = 'Done') {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 2600);
  }

  function openCatalogGroup(group) {
    setActiveGroupId(group.id);
    setCategory('All Categories');
    setDetailProduct(null);
    window.history.pushState({}, '', `/shop/${slug(groupLabel(group, productGroups))}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openProductDetails(product) {
    setDetailProduct(product);
    window.history.pushState({}, '', `/shop/${slug(`${product.name}-${product.localName || product.category}`)}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function addToCart(product, quantity) {
    const requestedQuantity = Math.max(1, Math.min(Number(quantity) || 1, Number(product.stock || 0)));
    if (!requestedQuantity) return;
    setCart((current) => {
      const cartKey = product.cartKey || product.id;
      const existing = current.find((item) => (item.cartKey || item.productId) === cartKey);
      if (existing) {
        return current.map((item) => (item.cartKey || item.productId) === cartKey ? { ...item, quantity: Math.min(product.stock, item.quantity + requestedQuantity) } : item);
      }
      return [...current, { cartKey, productId: product.id, name: product.name, localName: product.localName, image: product.image, price: product.price, unit: product.unit, stock: product.stock, quantity: requestedQuantity, selectedVariety: product.selectedVariety, selectedGrade: product.selectedGrade, selectedSize: product.selectedSize }];
    });
    setSelectedProduct(null);
    setCartOpen(true);
  }

  async function completeSale(delivery = null, checkoutCustomer = customer) {
    const latest = ensureProducts();
    const nextProducts = latest.map((product) => {
      const soldItems = cart.filter((entry) => entry.productId === product.id);
      const soldQuantity = soldItems.reduce((sum, item) => sum + item.quantity, 0);
      const soldRevenue = soldItems.reduce((sum, item) => sum + item.quantity * item.price, 0);
      return soldQuantity ? { ...product, stock: product.stock - soldQuantity, sold: (product.sold || 0) + soldQuantity, revenue: (product.revenue || 0) + soldRevenue } : product;
    });
    const itemsTotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const deliveryFee = delivery?.fee || 0;
    const orders = readStore('ophraOrdersAdmin', []);
    const buyer = checkoutCustomer || customer;
    const receiptNo = `RCT-${Date.now()}`;
    const order = { id: `order-${Date.now()}`, receiptNo, customerId: buyer?.id, customerEmail: buyer?.email, customer: buyer?.name || 'Storefront customer', status: 'Pending', paymentStatus: 'Paid', items: cart, createdAt: nowLabel(), createdAtIso: nowIso(), itemsTotal, delivery, deliveryFee, total: itemsTotal + deliveryFee };
    orders.unshift(order);
    writeStore('ophraOrdersAdmin', orders);
    await addRemoteRecord('orders', 'ophraOrdersAdmin', order);
    if (!hasApi) await saveCollection('products', 'ophraProducts', nextProducts);
    else writeStore('ophraProducts', nextProducts);
    setProducts(nextProducts);
    setCart([]);
    setCartOpen(false);
    showDone('Order saved');
  }

  async function createQuotationRequest(quoteCustomer, delivery = null, accountCustomer = customer) {
    const items = proformaItems(cart);
    const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
    const vatTotal = items.reduce((sum, item) => sum + item.vat, 0);
    const deliveryFee = delivery?.fee || 0;
    const deliveryTime = delivery?.expectedDeliveryTime || expectedDeliveryTime(getTransportSettings());
    const supplier = getSupplierProfile();
    const quotations = readStore('ophraQuotations', []);
    const quotation = {
      id: `quote-${Date.now()}`,
      status: 'Pending admin approval',
      createdAt: nowLabel(),
      createdAtIso: nowIso(),
      supplier,
      customerId: accountCustomer?.id,
      customer: { ...quoteCustomer, email: accountCustomer?.email || quoteCustomer.email },
      delivery,
      deliveryFee,
      expectedDeliveryTime: deliveryTime,
      items,
      subtotal,
      vatRate: VAT_RATE,
      vatTotal,
      totalWithVat: subtotal + vatTotal + deliveryFee,
      bankAccount: supplier.bankAccount,
    };
    quotations.unshift(quotation);
    writeStore('ophraQuotations', quotations);
    await addRemoteRecord('quotations', 'ophraQuotations', quotation);
    setCart([]);
    setCartOpen(false);
    showDone('Done');
  }
  function handleCustomImageFile(event) {
    const file = event.target.files?.[0] || null;
    setCustomImageFile(file);
    setCustomUploadStatus(file ? 'Image selected. It will be uploaded when you submit.' : '');
    if (customImagePreview) URL.revokeObjectURL(customImagePreview);
    setCustomImagePreview(file ? URL.createObjectURL(file) : '');
  }

  function clearCustomImage() {
    setCustomImageFile(null);
    setCustomUploadStatus('');
    if (customImagePreview) URL.revokeObjectURL(customImagePreview);
    setCustomImagePreview('');
  }

  async function submitCustom(event) {
    event.preventDefault();
    if (customSubmitting) return;
    setCustomSubmitting(true);
    setCustomUploadStatus('');
    const form = new FormData(event.currentTarget);
    let imageUrl = normalizeImageUrl(form.get('image'));
    try {
      if (customImageFile) {
        setCustomUploadStatus('Uploading image...');
        imageUrl = await uploadImageToCloudinary(customImageFile);
        setCustomUploadStatus('Image uploaded. Sending request...');
      }
      const requests = readStore('ophraCustomRequests', []);
      const customRequest = {
        id: `custom-${Date.now()}`,
        createdAt: nowLabel(),
        createdAtIso: nowIso(),
        status: 'Pending',
        name: String(form.get('name') || '').trim(),
        description: String(form.get('description') || '').trim(),
        quantity: Number(form.get('quantity') || 1),
        location: String(form.get('location') || '').trim(),
        email: String(form.get('email') || '').trim(),
        phone: String(form.get('phone') || '').trim(),
        image: imageUrl,
      };
      requests.unshift(customRequest);
      writeStore('ophraCustomRequests', requests);
      await addRemoteRecord('customRequests', 'ophraCustomRequests', customRequest);
      event.currentTarget.reset();
      clearCustomImage();
      showDone('Done');
    } catch (error) {
      setCustomUploadStatus(error.message || 'Image upload failed. Please try again.');
    } finally {
      setCustomSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-white text-slate-950">
      <div className="h-10 bg-brand-navy" />
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 shadow-sm">
        <div className="flex min-h-[64px] items-center justify-between gap-3 px-3 py-2 sm:px-4 md:min-h-[78px] md:gap-6 md:px-10">
          <a href="/" className="flex min-w-0 items-center gap-2 text-sm font-black sm:gap-3 md:text-xl"><img className="h-12 w-20 shrink-0 object-contain sm:h-14 sm:w-24 md:h-20 md:w-36" src="/ophra-logo.png" alt="OPHRA GENERAL SUPPLY logo" /><span className="max-w-[130px] leading-tight sm:max-w-[180px] md:max-w-none">{BRAND_NAME}</span></a>
          <nav className="hidden items-center gap-9 text-lg lg:flex"><a href="/">Home</a><a className="font-black text-brand-navy" href="#shop">Shop</a><a href="/admin">Admin</a></nav>
          <a className="inline-flex h-10 shrink-0 items-center rounded-lg bg-brand-navy px-3 text-sm font-black text-white sm:px-4 md:px-8" href="/account">LOGIN</a>
        </div>
      </header>

      <main id="shop" className="mx-auto w-full max-w-7xl px-3 pb-10 sm:px-4 lg:px-8">
        <section className="sticky top-[64px] z-30 bg-white/90 pb-3 pt-3 backdrop-blur md:top-[78px]">
          <label className="flex h-12 items-center gap-3 rounded-xl bg-slate-100 px-4 shadow-md"><Search className="text-brand-navy" size={20} /><input className="h-full flex-1 border-0 bg-transparent outline-none" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search general supply products..." /></label>
          <div className="mt-2 flex gap-1 overflow-x-auto rounded-full bg-white p-1 shadow-sm">{visibleDepartments.map((item) => <button key={item} className={`h-10 shrink-0 rounded-full px-5 text-sm ${department === item ? 'bg-brand-navy font-bold text-white' : 'bg-slate-100 text-slate-600'}`} onClick={() => { setDepartment(item); setActiveGroupId(''); setCategory('All Categories'); setDetailProduct(null); }} type="button">{item}</button>)}</div>
          <div className="mt-2 flex gap-1 overflow-x-auto rounded-full bg-white p-1 shadow-sm">{categories.map((item) => <button key={item} className={`h-9 shrink-0 rounded-full px-5 text-sm ${category === item ? 'bg-brand-pale font-bold text-brand-navy' : 'bg-slate-100 text-slate-600'}`} onClick={() => setCategory(item)} type="button">{item}</button>)}</div>
        </section>

        {detailProduct ? <ProductDetails product={detailProduct} products={products} openQuantityModal={setSelectedProduct} openProductDetails={openProductDetails} closeDetails={() => setDetailProduct(null)} /> : (
          <>
            {(activeGroup || groupTrail.length > 0) && (
              <CatalogBreadcrumb
                department={department}
                trail={groupTrail}
                openRoot={() => { setActiveGroupId(''); setCategory('All Categories'); }}
                openGroup={(group) => { setActiveGroupId(group.id); setCategory('All Categories'); }}
              />
            )}
            {pagedGroups.length > 0 && (
              <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {pagedGroups.map((group) => <CatalogGroupCard key={group.id} group={group} productCount={groupProductCount(group, departmentProducts, departmentGroups)} openGroup={openCatalogGroup} />)}
              </section>
            )}
            {pagedProducts.length > 0 && <section className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">{pagedProducts.map((product) => <ProductCard key={product.id} product={product} openQuantityModal={setSelectedProduct} openProductDetails={openProductDetails} />)}</section>}
            {totalItems === 0 && <EmptyState title="No products yet" text="Add product families or products for this level from the admin page." />}
            <StorePagination page={safePage} totalPages={totalPages} totalItems={totalItems} shownFrom={shownFrom} shownTo={shownTo} productCount={visibleProducts.length} groupCount={childGroups.length} setPage={setPage} />
          </>
        )}

        <section id="custom" className="mt-8 grid gap-6 border-t border-slate-200 py-8 md:py-10 lg:grid-cols-[0.8fr_1fr]">
          <div><h2 className="text-2xl font-black md:text-3xl">Request a custom product</h2><p className="mt-3 max-w-xl text-slate-500">Send the product name, description, quantity, optional image and contact details. Admin can accept or decline the request.</p></div>
          <form className="grid gap-3 rounded-2xl bg-slate-50 p-4" onSubmit={submitCustom}>
            <input className="rounded-xl bg-white px-4 py-3" name="name" required placeholder="Product name" />
            <textarea className="min-h-24 rounded-xl bg-white px-4 py-3" name="description" required placeholder="Description, size, brand, use case..." />
            <CustomOrderImageInput
              preview={customImagePreview}
              status={customUploadStatus}
              onFileChange={handleCustomImageFile}
              onClear={clearCustomImage}
            />
            <input className="rounded-xl bg-white px-4 py-3" name="image" placeholder="Image URL fallback (optional)" />
            <div className="grid gap-3 md:grid-cols-2"><input className="rounded-xl bg-white px-4 py-3" name="quantity" type="number" min="1" defaultValue="1" /><input className="rounded-xl bg-white px-4 py-3" name="location" placeholder="Site location" /></div>
            <div className="grid gap-3 md:grid-cols-2"><input className="rounded-xl bg-white px-4 py-3" name="email" type="email" placeholder="Email address" /><input className="rounded-xl bg-white px-4 py-3" name="phone" type="tel" placeholder="Phone number" /></div>
            <button className="rounded-xl bg-brand-navy px-5 py-3 font-black text-white disabled:opacity-60" disabled={customSubmitting} type="submit">{customSubmitting ? 'Submitting...' : 'Submit custom order'}</button>
          </form>
        </section>
        <footer className="mt-10 grid gap-8 border-t border-slate-200 py-8 sm:grid-cols-2 md:grid-cols-3 md:py-10"><div><h3 className="text-lg font-black">Services</h3><ul className="mt-5 grid gap-4 text-slate-600"><li><a className="hover:text-brand-navy" href="#shop">Shop products</a></li><li><a className="hover:text-brand-navy" href="#custom">Request custom order</a></li><li><a className="hover:text-brand-navy" href="/account">Customer login</a></li></ul></div><div><h3 className="text-lg font-black">Explore</h3><ul className="mt-5 grid gap-4 text-slate-600"><li><a className="hover:text-brand-navy" href="/">Home</a></li><li><a className="hover:text-brand-navy" href="#shop">Shop</a></li><li><a className="hover:text-brand-navy" href="/admin">Admin</a></li></ul></div><div className="flex flex-col items-start justify-center gap-3 sm:flex-row sm:items-center sm:gap-5"><img className="h-20 w-32 shrink-0 object-contain md:h-28 md:w-44" src="/ophra-logo.png" alt="OPHRA GENERAL SUPPLY logo" /><strong className="text-xl leading-tight md:text-2xl">{BRAND_NAME}</strong></div></footer>
      </main>

      <button className="fixed bottom-4 right-4 z-40 grid h-14 w-14 place-items-center rounded-full border-4 border-white bg-brand-navy text-white shadow-2xl md:bottom-7 md:right-7 md:h-20 md:w-20 md:border-[6px]" onClick={() => setCartOpen(true)} type="button" aria-label="Open cart"><ShoppingCart className="h-7 w-7 md:h-[42px] md:w-[42px]" />{cartItemCount > 0 && <span className="absolute -right-1 -top-2 grid h-7 min-w-7 place-items-center rounded-full border-2 border-white bg-rose-600 px-1 text-sm font-black md:-top-3 md:h-10 md:min-w-10 md:border-4 md:px-2 md:text-2xl">{cartItemCount}</span>}</button>
      {notice && <div className="fixed bottom-7 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-brand-navy px-8 py-4 text-lg font-black text-white shadow-2xl">{notice}</div>}
      {selectedProduct && <QuantityModal product={selectedProduct} close={() => setSelectedProduct(null)} confirm={addToCart} />}
      {cartOpen && <CartDrawer cart={cart} setCart={setCart} close={() => setCartOpen(false)} completeSale={completeSale} createQuotationRequest={createQuotationRequest} customer={customer} openAccount={() => { window.location.href = '/account'; }} />}
    </div>
  );
}

function EmptyState({ title, text }) {
  return <section className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-8 text-center"><h2 className="text-2xl font-black text-slate-950">{title}</h2><p className="mt-2 text-slate-600">{text}</p></section>;
}

function StorePagination({ page, totalPages, totalItems, shownFrom, shownTo, productCount, groupCount, setPage }) {
  const pageNumbers = Array.from({ length: totalPages }, (_, index) => index + 1).filter((item) => {
    if (totalPages <= 5) return true;
    return item === 1 || item === totalPages || Math.abs(item - page) <= 1;
  });

  if (totalItems === 0) return null;

  return (
    <section className="mt-10 grid justify-items-center gap-3 text-center">
      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button className="grid h-10 min-w-10 place-items-center rounded-xl bg-slate-100 px-3 font-black text-slate-700 disabled:text-slate-300" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} type="button">&lt;</button>
          {pageNumbers.map((item, index) => {
            const previous = pageNumbers[index - 1];
            const showGap = previous && item - previous > 1;
            return (
              <span key={item} className="inline-flex items-center gap-2">
                {showGap && <span className="px-1 font-black text-slate-400">...</span>}
                <button className={`grid h-11 min-w-11 place-items-center rounded-xl px-3 font-black shadow-sm ${page === item ? 'bg-brand-navy text-white' : 'bg-slate-100 text-slate-800'}`} onClick={() => setPage(item)} type="button">{item}</button>
              </span>
            );
          })}
          <button className="grid h-10 min-w-10 place-items-center rounded-xl bg-slate-100 px-3 font-black text-slate-700 disabled:text-slate-300" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))} type="button">&gt;</button>
        </div>
      )}
      <p className="text-slate-600">showing <strong className="text-brand-navy">{shownFrom}-{shownTo}</strong> of <strong className="text-brand-navy">{totalItems}</strong> results</p>
      <p className="text-slate-600"><strong className="text-brand-navy">{productCount}</strong> products and <strong className="text-brand-navy">{groupCount}</strong> families in this view</p>
      <p className="text-slate-600">page {page} / {totalPages}</p>
    </section>
  );
}

function CatalogBreadcrumb({ department, trail, openRoot, openGroup }) {
  return (
    <nav className="mt-5 flex flex-wrap items-center gap-2 text-sm font-bold text-slate-600">
      <button className="rounded-lg bg-slate-100 px-3 py-2 text-brand-navy" onClick={openRoot} type="button">{department}</button>
      {trail.map((group, index) => (
        <span key={group.id} className="inline-flex items-center gap-2">
          <span>/</span>
          <button className={`rounded-lg px-3 py-2 ${index === trail.length - 1 ? 'bg-brand-navy text-white' : 'bg-slate-100 text-brand-navy'}`} onClick={() => openGroup(group)} type="button">{group.name}</button>
        </span>
      ))}
    </nav>
  );
}

function CatalogGroupCard({ group, productCount, openGroup }) {
  return (
    <button className="grid min-h-[180px] overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-lg shadow-slate-200/70 transition hover:-translate-y-0.5 hover:border-brand-navy sm:grid-cols-[132px_1fr]" onClick={() => openGroup(group)} type="button">
      <div className="grid h-full place-items-center bg-slate-50 p-4">
        <img className="max-h-28 max-w-full object-contain sm:max-h-32" src={group.image || '/ophra-logo.png'} alt={group.name} />
      </div>
      <div className="flex min-w-0 flex-col justify-center p-4">
        <h2 className="text-lg font-black leading-tight text-slate-950 md:text-xl">{group.name}</h2>
        <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">{group.description || 'Tap to view available varieties and prices.'}</p>
        <p className="mt-3 text-sm font-black text-brand-navy">{productCount} products</p>
      </div>
    </button>
  );
}

function ProductCard({ product, openQuantityModal, openProductDetails }) {
  const hasPrice = canShowPrice(product);
  const secondaryName = product.localName || product.category;

  return (
    <article className="grid min-h-[350px] grid-rows-[190px_1fr] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg shadow-slate-200/70 md:min-h-[380px] md:grid-rows-[210px_1fr]">
      <div className="grid place-items-center bg-white p-4">
        <img className="max-h-[170px] max-w-full object-contain md:max-h-[190px]" src={product.image || '/ophra-logo.png'} alt={product.name} />
      </div>
      <div className="grid grid-rows-[1fr_auto_auto] gap-2 px-3 pb-3">
        <div className="min-w-0">
          <h2 className="line-clamp-2 text-lg font-black leading-tight text-slate-950">{product.name}{secondaryName ? <span className="font-normal"> ({secondaryName})</span> : null}</h2>
          <p className="mt-1 truncate text-sm text-slate-500">{normalizeDepartment(product.department)} - {product.unit}</p>
        </div>
        {hasPrice ? <button className="h-10 w-full rounded-lg bg-brand-navy text-sm font-black text-white disabled:opacity-50" disabled={product.stock <= 0} onClick={() => openQuantityModal(product)} type="button">{product.stock <= 0 ? 'Out of Stock' : 'Add to Cart'}</button> : <ProductContactCallout compact />}
        <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-brand-navy/20 text-center">
          <div className="grid min-h-10 place-items-center bg-white px-2 py-2 text-sm font-black text-brand-navy">{hasPrice ? money.format(product.price) : 'Call for price'}</div>
          <button className="min-h-10 bg-brand-pale px-2 py-2 text-sm font-bold text-brand-navy" onClick={() => openProductDetails(product)} type="button">View More</button>
        </div>
      </div>
    </article>
  );
}

function ProductContactCallout({ compact = false }) {
  const phone = ophraPhone();
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const ok = await copyText(phone);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  if (!phone) {
    return <div className={`${compact ? 'grid h-10 place-items-center text-center text-xs' : 'mt-5 text-sm'} rounded-lg bg-amber-50 px-3 py-2 font-bold text-amber-800`}>OPHRA phone number not set</div>;
  }

  if (compact) {
    return (
      <div className="grid grid-cols-2 gap-2">
        <a className="inline-flex h-10 items-center justify-center gap-1 rounded-lg bg-brand-navy px-2 text-xs font-black text-white" href={phoneHref(phone)}><Phone size={14} />Call</a>
        <button className="inline-flex h-10 items-center justify-center gap-1 rounded-lg bg-brand-pale px-2 text-xs font-black text-brand-navy" onClick={handleCopy} type="button"><Clipboard size={14} />{copied ? 'Copied' : 'Copy'}</button>
      </div>
    );
  }

  return (
    <div className="mt-5 grid gap-2 rounded-lg bg-brand-pale p-3 text-sm">
      <p className="font-black text-brand-navy">Call OPHRA for price</p>
      <div className="flex flex-wrap items-center gap-2">
        <a className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-navy px-3 font-black text-white" href={phoneHref(phone)}><Phone size={16} />{phone}</a>
        <button className="inline-flex h-10 items-center gap-2 rounded-lg bg-white px-3 font-black text-brand-navy shadow-sm" onClick={handleCopy} type="button"><Clipboard size={16} />{copied ? 'Copied' : 'Copy'}</button>
      </div>
    </div>
  );
}

function ProductDetails({ product, products, openQuantityModal, openProductDetails, closeDetails }) {
  const related = products.filter((item) => item.id !== product.id && item.category === product.category).slice(0, 4);
  const examples = Array.isArray(product.examples) ? product.examples : [];
  const grades = Array.isArray(product.grades) ? product.grades : [];
  const sizes = Array.isArray(product.sizes) ? product.sizes : [];
  const [selectedVarietyIndex, setSelectedVarietyIndex] = useState(examples.length ? 0 : -1);
  const [selectedGrade, setSelectedGrade] = useState(grades[0] || '');
  const [selectedSize, setSelectedSize] = useState(sizes[0] || '');
  const selectedVariety = selectedVarietyIndex >= 0 ? examples[selectedVarietyIndex] : null;
  const variety = typeof selectedVariety === 'string' ? { name: selectedVariety, description: '', image: '' } : selectedVariety;
  const choiceLabel = [variety?.name, selectedGrade && `Grade ${selectedGrade}`, selectedSize && `Size ${selectedSize}`].filter(Boolean).join(' - ');
  const selectedProduct = {
    ...product,
    image: variety?.image || product.image,
    localName: choiceLabel || product.localName,
    selectedVariety: variety?.name || '',
    selectedGrade,
    selectedSize,
    cartKey: [product.id, variety?.name, selectedGrade, selectedSize].filter(Boolean).join('|'),
  };

  return (
    <section className="mt-6">
      <button className="mb-5 rounded-lg bg-slate-100 px-4 py-2 font-bold text-brand-navy" onClick={closeDetails} type="button">&lt; Back to shop</button>
      <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr] lg:gap-8">
        <div className="grid min-h-[260px] place-items-center rounded-xl border border-slate-200 bg-white p-4 shadow-lg md:min-h-[360px] md:p-6">
          <img className="max-h-[300px] max-w-full object-contain md:max-h-[420px]" src={selectedProduct.image || '/ophra-logo.png'} alt={product.name} />
        </div>
        <div>
          <p className="font-bold uppercase tracking-[0.2em] text-brand-navy">{normalizeDepartment(product.department)} / {product.category}</p>
          <h1 className="mt-2 text-3xl font-black md:text-4xl">{product.name}</h1>
          <p className="mt-1 text-xl text-slate-500">{choiceLabel || product.localName}</p>
          {canShowPrice(product) ? <p className="mt-5 text-2xl font-black text-brand-navy md:text-3xl">{money.format(product.price)}</p> : <ProductContactCallout />}
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600 md:text-lg md:leading-8">{variety?.description || product.description || 'Available from OPHRA GENERAL SUPPLY.'}</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <InfoBox label="Stock" value={`${product.stock} ${product.unit}`} />
            <InfoBox label="Unit" value={product.unit} />
            <InfoBox label="Status" value={product.tag || 'Available'} />
          </div>
          {canShowPrice(product) && <button className="mt-6 h-12 rounded-xl bg-brand-navy px-8 font-black text-white disabled:opacity-50" disabled={product.stock <= 0} onClick={() => openQuantityModal(selectedProduct)} type="button">Add selected option</button>}
        </div>
      </div>

      {examples.length > 0 && <VarietyCards varieties={examples} selectedIndex={selectedVarietyIndex} onSelect={setSelectedVarietyIndex} />}
      {(grades.length > 0 || sizes.length > 0) && (
        <div className="mt-8 grid gap-5 lg:grid-cols-2">
          {grades.length > 0 && <ChoiceButtons title="Grades" items={grades} selected={selectedGrade} onSelect={setSelectedGrade} />}
          {sizes.length > 0 && <ChoiceButtons title="Sizes" items={sizes} selected={selectedSize} onSelect={setSelectedSize} />}
        </div>
      )}

      {related.length > 0 && (
        <div className="mt-10">
          <h2 className="text-2xl font-black">Related products</h2>
          <div className="mt-5 grid gap-7 sm:grid-cols-2 lg:grid-cols-4">
            {related.map((item) => <ProductCard key={item.id} product={item} openQuantityModal={openQuantityModal} openProductDetails={openProductDetails} />)}
          </div>
        </div>
      )}
    </section>
  );
}
function VarietyCards({ varieties, selectedIndex = -1, onSelect = () => {} }) {
  return (
    <section className="mt-8">
      <h2 className="text-2xl font-black">Available varieties</h2>
      <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {varieties.map((item, index) => {
          const variety = typeof item === 'string' ? { name: item, description: '', image: '' } : item;
          return (
            <button key={`${variety.name}-${index}`} className={`overflow-hidden rounded-xl border bg-white text-left shadow-sm ${selectedIndex === index ? 'border-brand-navy ring-2 ring-brand-navy' : 'border-slate-200'}`} onClick={() => onSelect(index)} type="button">
              <div className="grid h-44 place-items-center bg-slate-50 p-4">
                <img className="max-h-full max-w-full object-contain" src={variety.image || '/ophra-logo.png'} alt={variety.name || 'Product variety'} />
              </div>
              <div className="p-4">
                <h3 className="text-lg font-black">{variety.name || 'Variety'}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{variety.description || 'Available option for this product.'}</p>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ChoiceButtons({ title, items, selected, onSelect }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
      <h3 className="font-black text-slate-950">{title}</h3>
      <div className="mt-4 flex flex-wrap gap-2">
        {items.map((item) => <button key={item} className={`rounded-full px-4 py-2 text-sm font-bold shadow-sm ${selected === item ? 'bg-brand-navy text-white' : 'bg-white text-brand-navy'}`} onClick={() => onSelect(item)} type="button">{item}</button>)}
      </div>
    </div>
  );
}

function Chips({ title, items }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
      <h3 className="font-black text-slate-950">{title}</h3>
      <div className="mt-4 flex flex-wrap gap-2">
        {items.map((item) => <span key={item} className="rounded-full bg-white px-4 py-2 text-sm font-bold text-brand-navy shadow-sm">{item}</span>)}
      </div>
    </div>
  );
}

function InfoBox({ label, value }) {
  return <div className="rounded-xl bg-slate-50 p-4"><p className="text-sm text-slate-500">{label}</p><p className="mt-1 font-black text-slate-950">{value}</p></div>;
}

function QuantityModal({ product, close, confirm }) {
  const [quantity, setQuantity] = useState(1);
  const max = Math.max(1, Number(product.stock || 1));
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl">
        <div className="flex items-center justify-between gap-3">
          <div><h2 className="text-xl font-black">{product.name}</h2>{product.localName && <p className="text-sm text-slate-500">{product.localName}</p>}</div>
          <button className="grid h-9 w-9 place-items-center rounded-lg bg-slate-100" onClick={close} type="button"><X size={18} /></button>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-[120px_1fr]">
          <img className="h-28 w-28 rounded-lg object-contain" src={product.image || '/ophra-logo.png'} alt={product.name} />
          <div>
            <p className="text-sm text-slate-500">Available: {product.stock} {product.unit}</p>
            <p className="mt-2 text-2xl font-black text-brand-navy">{money.format(product.price)}</p>
            <label className="mt-4 block text-sm font-bold text-slate-600">Quantity</label>
            <input className="mt-1 h-11 w-full rounded-lg border border-slate-200 px-3" min="1" max={max} value={quantity} onChange={(event) => setQuantity(Math.min(max, Math.max(1, Number(event.target.value) || 1)))} type="number" />
          </div>
        </div>
        <button className="mt-5 h-12 w-full rounded-xl bg-brand-navy font-black text-white" onClick={() => confirm(product, quantity)} type="button">Add to Cart</button>
      </div>
    </div>
  );
}


function CustomOrderImageInput({ preview, status, onFileChange, onClear }) {
  const ready = Boolean(CLOUDINARY_CLOUD_NAME && CLOUDINARY_UPLOAD_PRESET);
  return (
    <div className="grid gap-2 rounded-xl bg-white p-3">
      <label className="grid gap-2 text-sm font-bold text-slate-600">
        Upload image (optional)
        <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal" type="file" accept="image/*" onChange={onFileChange} disabled={!ready} />
      </label>
      {preview && <div className="grid gap-2 sm:grid-cols-[120px_1fr]"><div className="grid h-28 w-28 place-items-center rounded-lg bg-slate-50 p-2"><img className="max-h-full max-w-full object-contain" src={preview} alt="Custom order preview" /></div><button className="h-10 self-center justify-self-start rounded-lg bg-slate-100 px-4 text-sm font-black text-brand-navy" onClick={onClear} type="button">Remove image</button></div>}
      <p className="text-xs text-slate-500">{ready ? status || 'The image uploads to Cloudinary when you submit. OPHRA saves only the URL.' : 'Image upload is not configured yet. You can paste an image URL below.'}</p>
    </div>
  );
}

function CartDrawer({ cart, setCart, close, completeSale, createQuotationRequest, customer: accountCustomer, openAccount }) {
  const transportSettings = getTransportSettings();
  const activeCustomer = accountCustomer || currentCustomer();
  const [customer, setCustomer] = useState(() => ({ tin: '', vrn: '', notes: '' }));
  const [wantsDelivery, setWantsDelivery] = useState(false);
  const [deliverySite, setDeliverySite] = useState('');
  const [deliveryCoords, setDeliveryCoords] = useState(null);
  const itemsTotal = cart.reduce((sum, item) => sum + item.quantity * item.price, 0);
  const officeCoords = parseCoordinates(`${transportSettings.officeLat},${transportSettings.officeLng}`);
  const siteCoords = deliveryCoords || parseCoordinates(deliverySite);
  const mapDistanceKm = officeCoords && siteCoords ? distanceKmBetween(officeCoords, siteCoords) : 0;
  const distanceKm = wantsDelivery ? mapDistanceKm : 0;
  const deliveryFee = wantsDelivery ? calculateDeliveryFee(distanceKm, transportSettings) : 0;
  const total = itemsTotal + deliveryFee;
  const requiresQuote = total > QUOTATION_LIMIT;
  const delivery = wantsDelivery ? {
    requested: true,
    site: deliverySite,
    distanceKm: Number(distanceKm.toFixed ? distanceKm.toFixed(2) : distanceKm),
    fee: deliveryFee,
    expectedDeliveryTime: expectedDeliveryTime(transportSettings),
    directionsUrl: googleDirectionsUrl(transportSettings, deliveryCoords ? `${deliveryCoords.lat},${deliveryCoords.lng}` : deliverySite),
  } : { requested: false, fee: 0, expectedDeliveryTime: expectedDeliveryTime(transportSettings) };
  const deliveryReady = !wantsDelivery || Boolean(deliverySite.trim());
  const quoteCustomer = { ...customer, name: activeCustomer?.name || 'Customer', contact: activeCustomer?.email || '', email: activeCustomer?.email || '' };

  function updateQuantity(cartKey, quantity) {
    setCart((current) => current.map((item) => (item.cartKey || item.productId) === cartKey ? { ...item, quantity: Math.min(item.stock, Math.max(1, Number(quantity) || 1)) } : item));
  }

  function sendQuote() {
    if (!activeCustomer || cart.length === 0 || !deliveryReady) return;
    createQuotationRequest(quoteCustomer, delivery, activeCustomer);
  }

  return (
    <aside className="fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-white shadow-2xl sm:max-w-xl">
      <div className="flex items-center justify-between border-b border-slate-200 p-4 sm:p-5">
        <h2 className="text-2xl font-black">Cart</h2>
        <button className="grid h-10 w-10 place-items-center rounded-lg bg-slate-100" onClick={close} type="button"><X size={20} /></button>
      </div>
      <div className="flex-1 overflow-auto p-3 sm:p-5">
        {cart.length === 0 ? <EmptyState title="Cart is empty" text="Add products from the storefront." /> : cart.map((item) => (
          <div key={item.cartKey || item.productId} className="mb-4 grid grid-cols-[64px_1fr] gap-3 rounded-xl border border-slate-200 p-3 sm:grid-cols-[80px_1fr] sm:gap-4">
            <img className="h-16 w-16 rounded-lg object-contain sm:h-20 sm:w-20" src={item.image || '/ophra-logo.png'} alt={item.name} />
            <div>
              <h3 className="font-black">{item.name}</h3>
              <p className="text-sm text-slate-500">{money.format(item.price)} per {item.unit}</p>
              <div className="mt-3 flex items-center gap-2">
                <input className="h-10 w-24 rounded-lg border border-slate-200 px-3" min="1" max={item.stock} value={item.quantity} onChange={(event) => updateQuantity(item.cartKey || item.productId, event.target.value)} type="number" />
                <button className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-bold text-slate-600" onClick={() => setCart((current) => current.filter((entry) => (entry.cartKey || entry.productId) !== (item.cartKey || item.productId)))} type="button">Remove</button>
              </div>
            </div>
          </div>
        ))}

        {cart.length > 0 && (
          <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between gap-4">
              <div><h3 className="font-black">Delivery service</h3><p className="text-sm text-slate-500">Delivery is optional and charged before checkout.</p></div>
              <label className="inline-flex cursor-pointer items-center gap-2 font-bold text-brand-navy"><input checked={wantsDelivery} onChange={(event) => setWantsDelivery(event.target.checked)} type="checkbox" /> Yes</label>
            </div>
            {wantsDelivery && (
              <div className="mt-3 grid gap-3">
                <div className="rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-800">Delivery will be charged before you submit. The charge appears in your total and on the proforma.</div>
                <MapDeliveryPicker
                  address={deliverySite}
                  coords={deliveryCoords}
                  distanceKm={distanceKm}
                  fee={deliveryFee}
                  settings={transportSettings}
                  setAddress={setDeliverySite}
                  setCoords={setDeliveryCoords}
                />
              </div>
            )}
          </section>
        )}
      </div>
      <div className="border-t border-slate-200 p-4 sm:p-5">
        <div className="grid gap-2 text-sm text-slate-600">
          <div className="flex items-center justify-between"><span>Items</span><span>{money.format(itemsTotal)}</span></div>
          {wantsDelivery && <div className="flex items-center justify-between"><span>Delivery charge</span><span>{money.format(deliveryFee)}</span></div>}
          {wantsDelivery && <div className="flex items-center justify-between"><span>Expected delivery</span><span>{delivery.expectedDeliveryTime}</span></div>}
          <div className="flex items-center justify-between text-xl font-black text-slate-950"><span>Total</span><span>{money.format(total)}</span></div>
        </div>
        {!activeCustomer && <button className="mt-4 h-11 w-full rounded-xl bg-slate-100 font-black text-brand-navy" onClick={openAccount} type="button">Sign up or log in to checkout</button>}
        {requiresQuote ? (
          <div className="mt-4 grid gap-3">
            <p className="rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-800">Orders above 1,000,000 require a quotation. Any delivery charge shown here will be included before you submit, and the proforma will show the expected delivery time.</p>
            {activeCustomer && <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600"><strong className="block text-slate-950">Quoting as {activeCustomer.name || 'Customer'}</strong><span>{activeCustomer.email}</span></div>}
            <input className="rounded-lg border border-slate-200 px-3 py-3" value={customer.tin} onChange={(event) => setCustomer({ ...customer, tin: event.target.value })} placeholder="TIN (optional)" />
            <input className="rounded-lg border border-slate-200 px-3 py-3" value={customer.vrn} onChange={(event) => setCustomer({ ...customer, vrn: event.target.value })} placeholder="VRN (optional)" />
            <textarea className="min-h-20 rounded-lg border border-slate-200 px-3 py-3" value={customer.notes} onChange={(event) => setCustomer({ ...customer, notes: event.target.value })} placeholder="Extra notes for admin (optional)" />
            <button className="h-12 rounded-xl bg-brand-navy font-black text-white disabled:opacity-50" disabled={cart.length === 0 || !activeCustomer || !deliveryReady} onClick={sendQuote} type="button">Send quotation</button>
          </div>
        ) : (
          <button className="mt-4 h-12 w-full rounded-xl bg-brand-navy font-black text-white disabled:opacity-50" disabled={cart.length === 0 || !activeCustomer || !deliveryReady} onClick={() => completeSale(delivery, activeCustomer)} type="button">Buy now</button>
        )}
      </div>
    </aside>
  );
}
function MapDeliveryPicker({ address, coords, distanceKm, fee, settings, setAddress, setCoords }) {
  const mapQuery = coords ? `${coords.lat},${coords.lng}` : address || settings.officeAddress || settings.officeName;
  const officeReady = settings.officeLat && settings.officeLng;

  function useCurrentLocation() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((position) => {
      const next = { lat: Number(position.coords.latitude.toFixed(6)), lng: Number(position.coords.longitude.toFixed(6)) };
      setCoords(next);
      setAddress(`${next.lat}, ${next.lng}`);
    });
  }

  function useAddress(value) {
    setAddress(value);
    const parsed = parseCoordinates(value);
    if (parsed) setCoords(parsed);
    else setCoords(null);
  }

  return (
    <div className="mt-4 grid gap-3">
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <iframe className="h-52 w-full border-0" src={googleMapEmbedUrl(mapQuery)} title="Delivery map" loading="lazy" />
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <input className="rounded-lg border border-slate-200 px-3 py-3" value={address} onChange={(event) => useAddress(event.target.value)} placeholder="Search delivery site or enter coordinates" />
        <button className="rounded-lg bg-white px-4 py-3 font-black text-brand-navy shadow-sm" onClick={useCurrentLocation} type="button">Use my location</button>
      </div>
      <div className="grid gap-2 rounded-xl bg-white p-3 text-sm text-slate-600">
        {!officeReady && <span className="font-bold text-amber-700">Admin needs office coordinates in Transport settings.</span>}
        <span>Distance: <strong className="text-slate-950">{distanceKm ? `${distanceKm.toFixed(2)} km` : 'Waiting for location'}</strong></span>
        <span>Transport fee: <strong className="text-brand-navy">{money.format(fee)}</strong></span>
        <a className="font-black text-brand-navy" href={googleDirectionsUrl(settings, coords ? `${coords.lat},${coords.lng}` : address)} target="_blank" rel="noreferrer">Open route in Google Maps</a>
      </div>
    </div>
  );
}

function CustomerAccountPage() {
  const [customer, setCustomer] = useState(() => currentCustomer());
  const [mode, setMode] = useState(customer ? 'ACCOUNT' : 'SIGNUP');
  const [form, setForm] = useState({ name: customer?.name || '', email: customer?.email || '', passwordInput: '' });
  const [accountNotice, setAccountNotice] = useState('');
  const [orders, setOrders] = useState(() => customerOrders(customer));
  const [quotes, setQuotes] = useState(() => customerQuotes(customer));

  useSessionTimeout({
    enabled: Boolean(customer),
    sessionKey: CUSTOMER_SESSION_KEY,
    inactivityTimeoutMs: CUSTOMER_INACTIVITY_TIMEOUT_MS,
    hardTimeoutMs: CUSTOMER_HARD_SESSION_MS,
    touchSession: touchCustomerSession,
    onTimeout: () => {
      saveCustomerSession(null);
      setCustomer(null);
      setForm({ name: '', email: '', passwordInput: '' });
      setOrders([]);
      setQuotes([]);
      setAccountNotice('Your session expired. Please log in again.');
      setMode('LOGIN');
    },
  });

  useEffect(() => {
    let active = true;
    async function loadCustomerRecords() {
      if (!customer) {
        setOrders([]);
        setQuotes([]);
        return;
      }
      const [remoteOrders, remoteQuotes] = await Promise.all([
        loadCollection('orders', 'ophraOrdersAdmin', []),
        loadCollection('quotations', 'ophraQuotations', []),
      ]);
      if (!active) return;
      setOrders(remoteOrders.filter((order) => order.customerId === customer.id || order.customerEmail === customer.email));
      setQuotes(remoteQuotes.filter((quote) => quote.customerId === customer.id || quote.customer?.email === customer.email || quote.customer?.contact === customer.email));
    }
    loadCustomerRecords();
    return () => { active = false; };
  }, [customer]);

  async function submit(event) {
    event.preventDefault();
    setAccountNotice('');
    const email = customerKey(form.email);
    const passwordInput = String(form.passwordInput || '');
    if (!email || !passwordInput) return setAccountNotice('Email and password are required.');
    const existing = readCustomers().find((item) => item.email === email);

    if (mode === 'LOGIN') {
      if (!existing) return setAccountNotice('No account found for this email.');
      if (!existing.passwordHash || !existing.passwordSalt) return setAccountNotice('This account needs a new signup with a password.');
      const passwordHash = await hashPassword(passwordInput, existing.passwordSalt);
      if (passwordHash !== existing.passwordHash) return setAccountNotice('Incorrect password.');
      saveCustomerSession(existing);
      setCustomer(existing);
      setForm({ name: existing.name || '', email: existing.email || '', passwordInput: '' });
      setMode('ACCOUNT');
      return;
    }

    if (!form.name.trim()) return setAccountNotice('Name or company is required.');
    if (existing) return setAccountNotice('This email already has an account. Please log in.');
    const passwordSalt = randomSalt();
    const passwordHash = await hashPassword(passwordInput, passwordSalt);
    const next = upsertCustomer({ name: form.name, email, passwordSalt, passwordHash });
    if (hasApi) await saveCollection('customers', 'ophraCustomers', readCustomers());
    setCustomer(next);
    setForm({ name: next.name || '', email: next.email || '', passwordInput: '' });
    setMode('ACCOUNT');
  }

  function logout() {
    saveCustomerSession(null);
    setCustomer(null);
    setForm({ name: '', email: '', passwordInput: '' });
    setAccountNotice('');
    setMode('SIGNUP');
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-950">
      <header className="border-b border-slate-200 bg-white shadow-sm">
        <div className="mx-auto flex min-h-16 max-w-6xl items-center justify-between gap-3 px-3 py-2 sm:px-4 md:min-h-20">
          <a href="/" className="flex min-w-0 items-center gap-2 text-sm font-black sm:gap-3 md:text-xl"><img className="h-12 w-20 shrink-0 object-contain sm:h-14 sm:w-24 md:h-20 md:w-36" src="/ophra-logo.png" alt="OPHRA GENERAL SUPPLY logo" /><span className="max-w-[130px] leading-tight sm:max-w-[180px] md:max-w-none">{BRAND_NAME}</span></a>
          <nav className="flex shrink-0 items-center gap-2 text-sm font-black sm:gap-3"><a className="rounded-lg bg-slate-100 px-4 py-2 text-brand-navy" href="/">Storefront</a><a className="rounded-lg bg-brand-navy px-4 py-2 text-white" href="/admin">Admin</a></nav>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-8">
        <section>
          <p className="font-bold uppercase tracking-[0.2em] text-brand-navy">Customer area</p>
          <h1 className="mt-2 text-3xl font-black md:text-4xl">Account</h1>
        </section>

        {mode !== 'ACCOUNT' || !customer ? (
          <section className="rounded-xl bg-white p-4 shadow-sm sm:p-6">
            <form className="mx-auto grid max-w-xl gap-3" onSubmit={submit}>
              <div className="flex gap-2"><button className={`h-10 rounded-lg px-4 font-black ${mode === 'SIGNUP' ? 'bg-brand-navy text-white' : 'bg-slate-100 text-slate-600'}`} onClick={() => { setMode('SIGNUP'); setAccountNotice(''); }} type="button">Sign up</button><button className={`h-10 rounded-lg px-4 font-black ${mode === 'LOGIN' ? 'bg-brand-navy text-white' : 'bg-slate-100 text-slate-600'}`} onClick={() => { setMode('LOGIN'); setAccountNotice(''); }} type="button">Log in</button></div>
              {mode === 'SIGNUP' && <AdminInput label="Name or company" value={form.name} onChange={(value) => setForm({ ...form, name: value })} required />}
              <AdminInput label="Email" value={form.email} onChange={(value) => setForm({ ...form, email: value })} type="email" required />
              <AdminInput label="Password" value={form.passwordInput} onChange={(value) => setForm({ ...form, passwordInput: value })} type="password" required />
              {accountNotice && <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">{accountNotice}</p>}
              <button className="h-11 rounded-xl bg-brand-navy px-6 font-black text-white" type="submit">{mode === 'LOGIN' ? 'Log in' : 'Create account'}</button>
            </form>
          </section>
        ) : (
          <div className="grid gap-6">
            <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white p-5 shadow-sm"><div><h2 className="text-2xl font-black">{customer.name || customer.email}</h2><p className="text-sm text-slate-500">{customer.email}</p></div><button className="rounded-lg bg-slate-100 px-4 py-2 font-black text-slate-600" onClick={logout} type="button">Log out</button></section>
            <AccountSection title="Purchase history" empty="No purchases yet.">{orders.map((order) => <div key={order.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex flex-wrap justify-between gap-3"><div><h4 className="font-black">{order.receiptNo || order.id}</h4><p className="text-sm text-slate-500">{order.createdAt} - {order.status}</p></div><strong className="text-brand-navy">{money.format(order.total || 0)}</strong></div><DeliverySummary delivery={order.delivery || { requested: false }} /><button className="mt-3 rounded-lg bg-brand-navy px-4 py-2 font-black text-white" onClick={() => printReceipt(order)} type="button">Print receipt</button></div>)}</AccountSection>
            <AccountSection title="Quotation status" empty="No quotation requests yet.">{quotes.map((quote) => <div key={quote.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex flex-wrap justify-between gap-3"><div><h4 className="font-black">{quote.id}</h4><p className="text-sm text-slate-500">{quote.createdAt} - {quote.status}</p></div><strong className="text-brand-navy">{money.format(quote.totalWithVat || 0)}</strong></div>{quote.status === 'Approved' && <button className="mt-3 rounded-lg bg-brand-navy px-4 py-2 font-black text-white" onClick={() => printProforma(quote)} type="button">View / print proforma</button>}</div>)}</AccountSection>
          </div>
        )}
      </main>
    </div>
  );
}
function AccountSection({ title, empty, children }) {
  const hasItems = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return <section><h3 className="text-xl font-black">{title}</h3><div className="mt-3 grid gap-3">{hasItems ? children : <EmptyState title={empty} text="Your account records will appear here." />}</div></section>;
}

function adminAuthConfigured() {
  return Boolean(ADMIN_PASSWORD_HASH && ADMIN_PASSWORD_SALT);
}

function adminSessionValid() {
  const session = readStore(ADMIN_SESSION_KEY, null);
  const valid = Boolean(session?.passwordHash && session.passwordHash === ADMIN_PASSWORD_HASH && sessionFresh(session, ADMIN_INACTIVITY_TIMEOUT_MS, ADMIN_HARD_SESSION_MS));
  if (!valid) clearAdminSession();
  return valid;
}

function saveAdminSession() {
  writeStore(ADMIN_SESSION_KEY, { passwordHash: ADMIN_PASSWORD_HASH, createdAt: Date.now(), lastActiveAt: Date.now() });
}

function touchAdminSession() {
  const session = readStore(ADMIN_SESSION_KEY, null);
  if (!session?.passwordHash || session.passwordHash !== ADMIN_PASSWORD_HASH || !sessionFresh(session, ADMIN_INACTIVITY_TIMEOUT_MS, ADMIN_HARD_SESSION_MS)) {
    clearAdminSession();
    return false;
  }
  writeStore(ADMIN_SESSION_KEY, { ...session, lastActiveAt: Date.now() });
  return true;
}

function clearAdminSession() {
  localStorage.removeItem(ADMIN_SESSION_KEY);
}

function useSessionTimeout({ enabled, sessionKey, inactivityTimeoutMs, hardTimeoutMs, touchSession, onTimeout }) {
  useEffect(() => {
    if (!enabled) return undefined;
    let timerId = 0;
    let lastTouchAt = 0;

    function expire() {
      window.clearTimeout(timerId);
      onTimeout();
    }

    function schedule() {
      window.clearTimeout(timerId);
      const session = readStore(sessionKey, null);
      if (!session) return;
      if (!sessionFresh(session, inactivityTimeoutMs, hardTimeoutMs)) return expire();
      const inactivityExpiresAt = Number(session.lastActiveAt) + inactivityTimeoutMs;
      const hardExpiresAt = Number(session.createdAt) + hardTimeoutMs;
      const delay = Math.max(1000, Math.min(inactivityExpiresAt, hardExpiresAt) - Date.now());
      timerId = window.setTimeout(expire, delay);
    }

    function markActivity() {
      if (document.hidden) return;
      const now = Date.now();
      if (now - lastTouchAt < 30 * 1000) return schedule();
      lastTouchAt = now;
      if (!touchSession()) return expire();
      schedule();
    }

    function checkVisibility() {
      if (!document.hidden) schedule();
    }

    schedule();
    SESSION_ACTIVITY_EVENTS.forEach((eventName) => window.addEventListener(eventName, markActivity, { passive: true }));
    document.addEventListener('visibilitychange', checkVisibility);
    return () => {
      window.clearTimeout(timerId);
      SESSION_ACTIVITY_EVENTS.forEach((eventName) => window.removeEventListener(eventName, markActivity));
      document.removeEventListener('visibilitychange', checkVisibility);
    };
  }, [enabled, sessionKey, inactivityTimeoutMs, hardTimeoutMs, touchSession, onTimeout]);
}

function AdminLogin({ onLogin }) {
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState('');
  const configured = adminAuthConfigured();

  async function submit(event) {
    event.preventDefault();
    setNotice('');
    if (!configured) return setNotice('Admin access is not ready yet. Please contact the site owner.');
    const passwordHash = await hashPassword(password, ADMIN_PASSWORD_SALT);
    if (passwordHash !== ADMIN_PASSWORD_HASH) return setNotice('Incorrect admin password.');
    if (hasApi) {
      try {
        await adminLogin(password);
      } catch {
        return setNotice('Admin server login failed. Check backend admin password settings.');
      }
    }
    saveAdminSession();
    onLogin();
  }

  return (
    <div className="grid min-h-screen place-items-center bg-slate-100 px-4 text-slate-950">
      <form className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onSubmit={submit}>
        <div className="flex items-center gap-3">
          <img className="h-20 w-36 shrink-0 object-contain" src="/ophra-logo.png" alt="OPHRA GENERAL SUPPLY logo" />
          <div><p className="text-xl font-black leading-tight text-brand-navy">{BRAND_NAME}</p><p className="text-sm font-bold text-slate-500">Admin login</p></div>
        </div>
        <div className="mt-6 grid gap-3">
          <AdminInput label="Admin password" value={password} onChange={setPassword} type="password" required />
          {notice && <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">{notice}</p>}
          <button className="h-11 rounded-xl bg-brand-navy px-6 font-black text-white" type="submit">Log in as admin</button>
          <a className="text-center text-sm font-black text-brand-navy" href="/">Back to storefront</a>
        </div>
      </form>
    </div>
  );
}

function AdminPanel() {
  const [adminAuthenticated, setAdminAuthenticated] = useState(() => adminSessionValid());
  const [activeView, setActiveView] = useState('DASHBOARD');
  const [products, setProducts] = useState(() => ensureProducts().map(normalizeProduct));
  const [productGroups, setProductGroups] = useState(() => {
    const groups = readStore('ophraProductGroups', []);
    return Array.isArray(groups) ? groups.map(normalizeCatalogGroup) : [];
  });
  const [customOrders, setCustomOrders] = useState(() => readStore('ophraCustomRequests', []));
  const [quotations, setQuotations] = useState(() => readStore('ophraQuotations', []));
  const [orders, setOrders] = useState(() => readStore('ophraOrdersAdmin', []));
  const [transportDraft, setTransportDraft] = useState(() => getTransportSettings());
  const [draft, setDraft] = useState(BLANK_PRODUCT);
  const [groupDraft, setGroupDraft] = useState(BLANK_GROUP);
  const [familyProductDrafts, setFamilyProductDrafts] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editingGroupId, setEditingGroupId] = useState(null);
  const [adminDepartmentFilter, setAdminDepartmentFilter] = useState(ALL_DEPARTMENTS);
  const [adminNotice, setAdminNotice] = useState('');

  useSessionTimeout({
    enabled: adminAuthenticated,
    sessionKey: ADMIN_SESSION_KEY,
    inactivityTimeoutMs: ADMIN_INACTIVITY_TIMEOUT_MS,
    hardTimeoutMs: ADMIN_HARD_SESSION_MS,
    touchSession: touchAdminSession,
    onTimeout: () => {
      if (hasApi) adminLogout().catch((error) => console.warn('Could not clear expired server admin session', error));
      clearAdminSession();
      setAdminAuthenticated(false);
    },
  });

  useEffect(() => {
    if (!adminAuthenticated) return;
    let active = true;
    async function loadAdminData() {
      const [remoteProducts, remoteGroups, remoteCustomOrders, remoteQuotations, remoteOrders] = await Promise.all([
        loadCollection('products', 'ophraProducts', ensureProducts()),
        loadCollection('productGroups', 'ophraProductGroups', []),
        loadCollection('customRequests', 'ophraCustomRequests', []),
        loadCollection('quotations', 'ophraQuotations', []),
        loadCollection('orders', 'ophraOrdersAdmin', []),
      ]);
      if (!active) return;
      setProducts(remoteProducts);
      setProductGroups(remoteGroups);
      setCustomOrders(remoteCustomOrders);
      setQuotations(remoteQuotations);
      setOrders(remoteOrders);
      if (hasApi) {
        try {
          const settings = await getSettings();
          if (settings?.transportSettings) {
            writeStore('ophraTransportSettings', settings.transportSettings);
            setTransportDraft({ ...DEFAULT_TRANSPORT_SETTINGS, ...settings.transportSettings });
          }
        } catch (error) {
          console.warn('Could not load remote settings', error);
        }
      }
    }
    loadAdminData();
    return () => { active = false; };
  }, [adminAuthenticated]);

  const navItems = [
    ['DASHBOARD', LayoutDashboard, 'ADMIN DASHBOARD'],
    ['REPORTS', ClipboardList],
    ['PRODUCTS', PackageOpen],
    ['PRODUCT FAMILIES', Tags],
    ['CUSTOM ORDERS', ClipboardList],
    ['QUOTATIONS', Tags],
    ['TRANSPORT', MapPin],
    ['ORDERS', ShoppingCart],
  ];

  const adminProducts = products.filter((product) => adminDepartmentFilter === ALL_DEPARTMENTS || normalizeDepartment(product.department) === adminDepartmentFilter);
  const adminGroups = productGroups.filter((group) => adminDepartmentFilter === ALL_DEPARTMENTS || normalizeDepartment(group.department) === adminDepartmentFilter).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const hardwareCount = products.filter((product) => normalizeDepartment(product.department) === 'Hardware Tools').length;
  const foodCount = products.filter((product) => normalizeDepartment(product.department) === 'Food Products').length;

  if (!adminAuthenticated) return <AdminLogin onLogin={() => setAdminAuthenticated(true)} />;

  const customers = readCustomers();
  const monitoring = adminMonitoringData({ products, productGroups, orders, quotations, customOrders, customers, transportSettings: transportDraft });
  const adminPageTitle = activeView === 'DASHBOARD' ? 'Admin Dashboard' : activeView === 'REPORTS' ? 'Reports' : activeView;

  function notify(message) {
    setAdminNotice(message);
    window.setTimeout(() => setAdminNotice(''), 2400);
  }

  async function logoutAdmin() {
    if (hasApi) {
      try {
        await adminLogout();
      } catch (error) {
        console.warn('Could not clear server admin session', error);
      }
    }
    clearAdminSession();
    setAdminAuthenticated(false);
  }

  function setField(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function setGroupField(field, value) {
    setGroupDraft((current) => ({ ...current, [field]: value }));
  }

  function updateVariety(index, field, value) {
    setDraft((current) => {
      const examples = Array.isArray(current.examples) ? [...current.examples] : [];
      examples[index] = { ...(examples[index] || { name: '', description: '', image: '' }), [field]: value };
      return { ...current, examples };
    });
  }

  function addVariety() {
    setDraft((current) => ({ ...current, examples: [...(Array.isArray(current.examples) ? current.examples : []), { name: '', description: '', image: '' }] }));
  }

  function removeVariety(index) {
    setDraft((current) => ({ ...current, examples: (Array.isArray(current.examples) ? current.examples : []).filter((_, itemIndex) => itemIndex !== index) }));
  }

  function setTransportField(field, value) {
    setTransportDraft((current) => ({ ...current, [field]: value }));
  }

  function resetProductForm() {
    setDraft(BLANK_PRODUCT);
    setEditingId(null);
  }

  function resetGroupForm() {
    setGroupDraft(BLANK_GROUP);
    setFamilyProductDrafts([]);
    setEditingGroupId(null);
  }

  function familyProductFromProduct(product) {
    return {
      id: product.id,
      name: product.name || '',
      localName: product.localName || '',
      category: product.category || '',
      unit: product.unit || 'Piece',
      price: canShowPrice(product) ? String(product.price) : '',
      stock: product.stock || 0,
      image: product.image === '/ophra-logo.png' ? '' : product.image || '',
      description: product.description || '',
      tag: product.tag || 'Available',
    };
  }

  function updateFamilyProduct(index, field, value) {
    setFamilyProductDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item));
  }

  function addFamilyProduct() {
    setFamilyProductDrafts((current) => [...current, { ...BLANK_FAMILY_PRODUCT, category: groupDraft.name || '' }]);
  }

  function removeFamilyProduct(index) {
    setFamilyProductDrafts((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  async function saveCatalogGroup(event) {
    event.preventDefault();
    const group = normalizeCatalogGroup({ ...groupDraft, id: editingGroupId || groupDraft.id });
    if (!group.name) return;
    if (!group.parentId && group.name.trim().toLowerCase() === normalizeDepartment(group.department).toLowerCase()) return notify('Use a product family name like Rice, Paint, Hammer, or Cooking Oil.');
    if (group.parentId === group.id) return notify('Choose a different parent family');
    const exists = productGroups.some((item) => item.id === group.id);
    const next = exists ? productGroups.map((item) => item.id === group.id ? group : item) : [group, ...productGroups];
    const familyProducts = familyProductDrafts
      .filter((item) => String(item.name || '').trim())
      .map((item, index) => normalizeProduct({
        ...BLANK_PRODUCT,
        ...item,
        id: item.id || slug(`${group.name}-${item.name}-${Date.now()}-${index}`),
        department: group.department,
        groupId: group.id,
        category: item.category || group.name,
        image: normalizeImageUrl(item.image) || group.image,
        price: item.price === '' || item.price === null || item.price === undefined ? 0 : item.price,
        stock: item.stock || 0,
        unit: item.unit || 'Piece',
        tag: item.tag || 'Available',
      }));
    const nextProducts = [...familyProducts, ...products.filter((product) => product.groupId !== group.id)];
    setProductGroups(next);
    setProducts(nextProducts);
    await Promise.all([
      saveCollection('productGroups', 'ophraProductGroups', next),
      saveCollection('products', 'ophraProducts', nextProducts),
    ]);
    resetGroupForm();
    notify('Product family saved');
  }

  function editCatalogGroup(group) {
    setEditingGroupId(group.id);
    setGroupDraft({ ...BLANK_GROUP, ...group, department: normalizeDepartment(group.department) });
    setFamilyProductDrafts(products.filter((product) => product.groupId === group.id).map(familyProductFromProduct));
    setActiveView('PRODUCT FAMILIES');
    notify('Editing product family. Make changes and save.');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function deleteCatalogGroup(groupId) {
    const childIds = new Set([groupId]);
    let changed = true;
    while (changed) {
      changed = false;
      productGroups.forEach((group) => {
        if (childIds.has(group.parentId) && !childIds.has(group.id)) {
          childIds.add(group.id);
          changed = true;
        }
      });
    }
    const nextGroups = productGroups.filter((group) => !childIds.has(group.id));
    const nextProducts = products.map((product) => childIds.has(product.groupId) ? { ...product, groupId: '' } : product);
    setProductGroups(nextGroups);
    setProducts(nextProducts);
    await Promise.all([
      saveCollection('productGroups', 'ophraProductGroups', nextGroups),
      saveCollection('products', 'ophraProducts', nextProducts),
    ]);
    notify('Product family deleted');
  }

  async function saveProduct(event) {
    event.preventDefault();
    const product = normalizeProduct({ ...draft, id: editingId || draft.id });
    if (!product.name) return;
    const exists = products.some((item) => item.id === product.id);
    const next = exists ? products.map((item) => item.id === product.id ? product : item) : [product, ...products];
    setProducts(next);
    await saveCollection('products', 'ophraProducts', next);
    resetProductForm();
    notify('Product saved');
  }

  function editProduct(product) {
    setEditingId(product.id);
    setDraft({ ...BLANK_PRODUCT, ...product, department: normalizeDepartment(product.department) });
    setActiveView('PRODUCTS');
    notify('Editing product. Make changes and save.');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function deleteProduct(productId) {
    const next = products.filter((product) => product.id !== productId);
    setProducts(next);
    await saveCollection('products', 'ophraProducts', next);
    notify('Product deleted');
  }

  async function saveTransportSettings(event) {
    event.preventDefault();
    const next = {
      ...transportDraft,
      baseFee: toNumber(transportDraft.baseFee),
      pricePerKm: toNumber(transportDraft.pricePerKm),
      minimumFee: toNumber(transportDraft.minimumFee),
    };
    setTransportDraft(next);
    writeStore('ophraTransportSettings', next);
    if (hasApi) {
      try {
        await saveSettings({ transportSettings: next });
      } catch (error) {
        console.warn('Could not save remote transport settings', error);
      }
    }
    notify('Transport settings saved');
  }

  async function updateCustomOrder(orderId, status) {
    const next = customOrders.map((order) => order.id === orderId ? { ...order, status } : order);
    setCustomOrders(next);
    writeStore('ophraCustomRequests', next);
    if (hasApi) {
      try {
        await updateRecord('customRequests', orderId, { status });
      } catch (error) {
        console.warn('Could not update custom order remotely', error);
      }
    }
    notify(`Custom order ${status.toLowerCase()}`);
  }

  async function updateQuotation(quotationId, status) {
    const next = quotations.map((quote) => quote.id === quotationId ? { ...quote, status, approvedAt: status === 'Approved' ? nowLabel() : quote.approvedAt } : quote);
    setQuotations(next);
    writeStore('ophraQuotations', next);
    const updated = next.find((quote) => quote.id === quotationId);
    if (hasApi && updated) {
      try {
        await updateRecord('quotations', quotationId, { status: updated.status, approvedAt: updated.approvedAt });
      } catch (error) {
        console.warn('Could not update quotation remotely', error);
      }
    }
    notify(status === 'Approved' ? 'Proforma approved' : 'Quotation declined');
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-950 lg:grid lg:grid-cols-[280px_1fr]">
      <aside className="border-r border-slate-200 bg-brand-navy text-white lg:min-h-screen">
        <div className="flex min-h-24 items-center gap-3 border-b border-white/10 px-6 py-3">
          <img className="h-16 w-28 shrink-0 object-contain" src="/ophra-logo.png" alt="OPHRA GENERAL SUPPLY logo" />
          <div><p className="text-lg font-black leading-tight">{BRAND_NAME}</p><p className="text-xs text-white/70">Admin</p></div>
        </div>
        <nav className="flex gap-2 overflow-x-auto p-3 lg:grid lg:p-4">
          {navItems.map(([label, Icon, displayLabel]) => <button key={label} className={`flex shrink-0 items-center gap-3 rounded-lg px-4 py-3 text-left font-bold ${activeView === label ? 'bg-white text-brand-navy' : 'text-white/80 hover:bg-white/10'}`} onClick={() => setActiveView(label)} type="button"><Icon size={18} />{displayLabel || label}</button>)}
        </nav>
        <a className="mx-3 mb-3 flex w-max items-center gap-3 rounded-lg bg-white/10 px-4 py-3 font-bold text-white lg:mx-4 lg:mt-4" href="/"><Truck size={18} />Storefront</a>
      </aside>

      <main className="min-w-0 p-3 sm:p-4 md:p-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-bold uppercase tracking-[0.2em] text-brand-navy">Admin</p>
            <h1 className="text-2xl font-black md:text-3xl">{adminPageTitle}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3"><div className="flex items-center gap-3 rounded-xl bg-white px-4 py-3 shadow-sm"><UsersRound size={18} /><span className="font-bold">{hasApi ? 'API connected' : 'Local workspace'}</span></div><button className="rounded-xl bg-white px-4 py-3 font-black text-brand-navy shadow-sm" onClick={logoutAdmin} type="button">Log out</button></div>
        </header>

        {activeView === 'DASHBOARD' && (
          <AdminDashboard
            monitoring={monitoring}
            editProduct={editProduct}
            openView={setActiveView}
          />
        )}

        {activeView === 'REPORTS' && (
          <AdminReports
            products={products}
            productGroups={productGroups}
            orders={orders}
            quotations={quotations}
            customOrders={customOrders}
            customers={customers}
          />
        )}

        {activeView === 'PRODUCTS' && (
          <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(320px,420px)_1fr]">
            <form className="rounded-xl bg-white p-5 shadow-sm" onSubmit={saveProduct}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><h2 className="text-xl font-black">{editingId ? 'Edit product' : 'Add new product'}</h2>{editingId && <p className="mt-1 text-sm font-bold text-brand-navy">Editing mode is active.</p>}</div>
                {editingId && <div className="flex gap-2"><button className="h-10 rounded-lg bg-brand-navy px-4 text-sm font-black text-white" type="submit">Save changes</button><button className="h-10 rounded-lg bg-slate-100 px-4 text-sm font-black text-slate-600" onClick={resetProductForm} type="button">Cancel</button></div>}
              </div>
              <div className="mt-5 grid gap-3">
                <AdminInput label="Product name" value={draft.name} onChange={(value) => setField('name', value)} required />
                <AdminInput label="Local name" value={draft.localName} onChange={(value) => setField('localName', value)} />
                <AdminSelect label="Department" value={draft.department} onChange={(value) => setDraft((current) => ({ ...current, department: value, groupId: '' }))} options={DEPARTMENTS} required />
                <CatalogGroupSelect label="Show product under family" value={draft.groupId || ''} onChange={(value) => setField('groupId', value)} groups={productGroups.filter((group) => normalizeDepartment(group.department) === normalizeDepartment(draft.department))} />
                <AdminInput label="Category" value={draft.category} onChange={(value) => setField('category', value)} required />
                <div className="grid gap-3 sm:grid-cols-2">
                  <AdminInput label="Unit" value={draft.unit} onChange={(value) => setField('unit', value)} required />
                  <AdminInput label="Tag" value={draft.tag} onChange={(value) => setField('tag', value)} />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <AdminInput label="Price (optional)" value={draft.price} onChange={(value) => setField('price', value)} type="number" />
                  <AdminInput label="Stock" value={draft.stock} onChange={(value) => setField('stock', value)} type="number" required />
                </div>
                <ProductImageUrlInput image={draft.image} onChange={(value) => setField('image', value)} onRemove={() => setField('image', '')} />
                <label className="grid gap-1 text-sm font-bold text-slate-600">Description<textarea className="min-h-24 rounded-lg border border-slate-200 px-3 py-2 text-base font-normal text-slate-950 outline-none focus:border-brand-navy" value={draft.description} onChange={(event) => setField('description', event.target.value)} /></label>
                <ProductOptionTextarea label="Grades" value={draft.grades} placeholder="8.8\n12.9" onChange={(items) => setField('grades', items)} />
                <ProductOptionTextarea label="Sizes" value={draft.sizes} placeholder="6*20\n6*22\n10*20\n10*22" onChange={(items) => setField('sizes', items)} />
                <ProductVarietiesEditor varieties={draft.examples} updateVariety={updateVariety} addVariety={addVariety} removeVariety={removeVariety} />
              </div>
              <div className="mt-5 flex gap-3">
                <button className="h-11 rounded-xl bg-brand-navy px-6 font-black text-white" type="submit">{editingId ? 'Save changes' : 'Add product'}</button>
                {editingId && <button className="h-11 rounded-xl bg-slate-100 px-6 font-black text-slate-600" onClick={resetProductForm} type="button">Cancel</button>}
              </div>
            </form>

            <div className="rounded-xl bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl font-black">General supply products</h2>
                <span className="rounded-full bg-brand-pale px-4 py-2 text-sm font-black text-brand-navy">{adminProducts.length} shown / {products.length} total</span>
              </div>
              <div className="mt-4 flex gap-1 overflow-x-auto rounded-full bg-slate-50 p-1">
                {[ALL_DEPARTMENTS, ...DEPARTMENTS].map((item) => <button key={item} className={`h-9 shrink-0 rounded-full px-4 text-sm font-bold ${adminDepartmentFilter === item ? 'bg-brand-navy text-white' : 'bg-white text-slate-600'}`} onClick={() => setAdminDepartmentFilter(item)} type="button">{item}</button>)}
              </div>
              <div className="mt-5 grid gap-3">
                {adminProducts.length === 0 ? <EmptyState title="No products here yet" text="Use the form to add products for this department." /> : adminProducts.map((product) => (
                  <article key={product.id} className="grid gap-4 rounded-xl border border-slate-200 p-4 md:grid-cols-[90px_1fr_auto]">
                    <img className="h-24 w-24 rounded-lg object-contain" src={product.image || '/ophra-logo.png'} alt={product.name} />
                    <div>
                      <h3 className="text-lg font-black">{product.name}</h3>
                      <p className="text-sm text-slate-500">{normalizeDepartment(product.department)} - {product.category} - {product.groupId ? groupLabel(productGroups.find((group) => group.id === product.groupId), productGroups) : 'No product family'} - {product.localName || product.unit}</p>
                      <p className="mt-2 font-black text-brand-navy">{canShowPrice(product) ? money.format(product.price) : 'Call for price'}</p>
                      <p className="text-sm text-slate-500">Stock: {product.stock} {product.unit}</p>
                    </div>
                    <div className="flex items-start gap-2 md:flex-col">
                      <button className="h-10 rounded-lg bg-brand-navy px-4 text-sm font-black text-white" onClick={() => editProduct(product)} type="button">Edit</button>
                      <button className="h-10 rounded-lg bg-rose-50 px-4 text-sm font-black text-rose-700" onClick={() => deleteProduct(product.id)} type="button">Delete</button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </section>
        )}

        {activeView === 'PRODUCT FAMILIES' && (
          <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(320px,420px)_1fr]">
            <form className="rounded-xl bg-white p-5 shadow-sm" onSubmit={saveCatalogGroup}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><h2 className="text-xl font-black">{editingGroupId ? 'Edit product family' : 'Add product family'}</h2>{editingGroupId && <p className="mt-1 text-sm font-bold text-brand-navy">Editing mode is active.</p>}</div>
                {editingGroupId && <div className="flex gap-2"><button className="h-10 rounded-lg bg-brand-navy px-4 text-sm font-black text-white" type="submit">Save changes</button><button className="h-10 rounded-lg bg-slate-100 px-4 text-sm font-black text-slate-600" onClick={resetGroupForm} type="button">Cancel</button></div>}
              </div>
              <div className="mt-5 grid gap-3">
                <AdminInput label="Product family name" value={groupDraft.name} onChange={(value) => setGroupField('name', value)} required />
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs font-bold text-slate-500">Use generic names customers recognize, for example Rice, Paint, Hammer, Cooking Oil. For bolts/screws, create nested families like Bolts / Hex Bolts / Steel Hex Bolts.</p>
                <AdminSelect label="Department" value={groupDraft.department} onChange={(value) => setGroupDraft((current) => ({ ...current, department: value, parentId: '' }))} options={DEPARTMENTS} required />
                <CatalogGroupSelect label="Parent family" value={groupDraft.parentId || ''} onChange={(value) => setGroupField('parentId', value)} groups={productGroups.filter((group) => group.id !== editingGroupId && normalizeDepartment(group.department) === normalizeDepartment(groupDraft.department))} />
                <ProductImageUrlInput image={groupDraft.image} onChange={(value) => setGroupField('image', value)} onRemove={() => setGroupField('image', '')} />
                <AdminInput label="Sort order" value={groupDraft.sortOrder} onChange={(value) => setGroupField('sortOrder', value)} type="number" />
                <label className="grid gap-1 text-sm font-bold text-slate-600">Description<textarea className="min-h-24 rounded-lg border border-slate-200 px-3 py-2 text-base font-normal text-slate-950 outline-none focus:border-brand-navy" value={groupDraft.description} onChange={(event) => setGroupField('description', event.target.value)} /></label>
                <FamilyProductsEditor
                  familyName={groupDraft.name}
                  products={familyProductDrafts}
                  updateProduct={updateFamilyProduct}
                  addProduct={addFamilyProduct}
                  removeProduct={removeFamilyProduct}
                />
              </div>
              <div className="mt-5 flex gap-3">
                <button className="h-11 rounded-xl bg-brand-navy px-6 font-black text-white" type="submit">{editingGroupId ? 'Save changes' : 'Add family'}</button>
                {editingGroupId && <button className="h-11 rounded-xl bg-slate-100 px-6 font-black text-slate-600" onClick={resetGroupForm} type="button">Cancel</button>}
              </div>
            </form>

            <div className="rounded-xl bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl font-black">Clickable product families</h2>
                <span className="rounded-full bg-brand-pale px-4 py-2 text-sm font-black text-brand-navy">{adminGroups.length} shown / {productGroups.length} total</span>
              </div>
              <div className="mt-4 flex gap-1 overflow-x-auto rounded-full bg-slate-50 p-1">
                {[ALL_DEPARTMENTS, ...DEPARTMENTS].map((item) => <button key={item} className={`h-9 shrink-0 rounded-full px-4 text-sm font-bold ${adminDepartmentFilter === item ? 'bg-brand-navy text-white' : 'bg-white text-slate-600'}`} onClick={() => setAdminDepartmentFilter(item)} type="button">{item}</button>)}
              </div>
              <div className="mt-5 grid gap-3">
                {adminGroups.length === 0 ? <EmptyState title="No product families yet" text="Add families like Rice, Paint, Hammer, Cooking Oil, or nested bolt/screw types." /> : adminGroups.map((group) => (
                  <article key={group.id} className="grid gap-4 rounded-xl border border-slate-200 p-4 md:grid-cols-[90px_1fr_auto]">
                    <img className="h-24 w-24 rounded-lg object-contain" src={group.image || '/ophra-logo.png'} alt={group.name} />
                    <div>
                      <h3 className="text-lg font-black">{group.name}</h3>
                      <p className="text-sm text-slate-500">{normalizeDepartment(group.department)} - {group.parentId ? groupLabel(productGroups.find((item) => item.id === group.parentId), productGroups) : 'Top level'}</p>
                      <p className="mt-2 text-sm text-slate-600">{group.description || 'No description set.'}</p>
                      <p className="mt-2 font-black text-brand-navy">{groupProductCount(group, products, productGroups)} products</p>
                    </div>
                    <div className="flex items-start gap-2 md:flex-col">
                      <button className="h-10 rounded-lg bg-brand-navy px-4 text-sm font-black text-white" onClick={() => editCatalogGroup(group)} type="button">Edit</button>
                      <button className="h-10 rounded-lg bg-rose-50 px-4 text-sm font-black text-rose-700" onClick={() => deleteCatalogGroup(group.id)} type="button">Delete</button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </section>
        )}

        {activeView === 'TRANSPORT' && (
          <TransportSettingsView settings={transportDraft} setField={setTransportField} saveSettings={saveTransportSettings} />
        )}

        {activeView === 'CUSTOM ORDERS' && <AdminList title="Customer custom orders" empty="No custom orders yet." items={customOrders} renderItem={(order) => <CustomOrderRow order={order} updateCustomOrder={updateCustomOrder} />} />}
        {activeView === 'QUOTATIONS' && <AdminList title="Quotation requests" empty="No quotation requests yet." items={quotations} renderItem={(quote) => <QuotationRow quote={quote} updateQuotation={updateQuotation} />} />}
        {activeView === 'ORDERS' && <AdminList title="Direct orders" empty="No direct orders yet." items={orders} renderItem={(order) => <OrderRow order={order} />} />}
      </main>
      {adminNotice && <div className="fixed bottom-7 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-brand-navy px-8 py-4 font-black text-white shadow-2xl">{adminNotice}</div>}
    </div>
  );
}



function AdminReports({ products, productGroups, orders, quotations, customOrders, customers }) {
  const [activeReport, setActiveReport] = useState('Sales');
  const [filters, setFilters] = useState({ period: 'All Time', startDate: '', endDate: '', customer: '', product: '', status: 'All', department: ALL_DEPARTMENTS });
  const productLookup = useMemo(() => new Map(products.map((product) => [product.id, normalizeProduct(product)])), [products]);
  const groupsLookup = useMemo(() => new Map(productGroups.map((group) => [group.id, group])), [productGroups]);
  const reportTabs = ['Sales', 'Customers', 'Quotations', 'Stock', 'Delivery'];
  const reportRows = useMemo(() => buildReportRows({ products, orders, quotations, customOrders, customers, productLookup, groupsLookup, filters }), [products, orders, quotations, customOrders, customers, productLookup, groupsLookup, filters]);
  const visibleRows = reportRows[activeReport] || [];

  function setReportFilter(field, value) {
    setFilters((current) => ({ ...current, [field]: value }));
  }

  function downloadCurrentCsv() {
    const suffix = reportDateSuffix(filters);
    downloadCsv(`ophra-${activeReport.toLowerCase()}-report-${suffix}.csv`, visibleRows);
  }

  function downloadCurrentPdf() {
    const suffix = reportDateSuffix(filters);
    downloadReportPdf(`ophra-${activeReport.toLowerCase()}-report-${suffix}.pdf`, `${activeReport} Report`, visibleRows, filters);
  }

  return (
    <section className="mt-6 grid gap-5">
      <div className="rounded-xl bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-xl font-black">Reports</h2><p className="mt-1 text-sm text-slate-500">Filter by date, customer, product, status, and department, then download the active report.</p></div>
          <div className="flex flex-wrap gap-2">
            <button className="rounded-xl bg-brand-navy px-5 py-3 font-black text-white disabled:opacity-50" onClick={downloadCurrentCsv} disabled={!visibleRows.length} type="button">Download CSV</button>
            <button className="rounded-xl bg-white px-5 py-3 font-black text-brand-navy shadow-sm disabled:opacity-50" onClick={downloadCurrentPdf} disabled={!visibleRows.length} type="button">Download PDF</button>
          </div>
        </div>
        <div className="mt-5 flex gap-1 overflow-x-auto rounded-full bg-slate-50 p-1">
          {reportTabs.map((tab) => <button key={tab} className={`h-10 shrink-0 rounded-full px-5 text-sm font-black ${activeReport === tab ? 'bg-brand-navy text-white' : 'bg-white text-slate-600'}`} onClick={() => setActiveReport(tab)} type="button">{tab}</button>)}
        </div>
        <ReportFilters filters={filters} setFilter={setReportFilter} />
      </div>
      <ReportTable title={`${activeReport} Report`} rows={visibleRows} />
    </section>
  );
}

function ReportFilters({ filters, setFilter }) {
  return (
    <div className="mt-5 grid gap-3 lg:grid-cols-4">
      <AdminSelect label="Period" value={filters.period} onChange={(value) => setFilter('period', value)} options={['All Time', 'Daily', 'Quarterly', 'Annual', 'Custom']} />
      <AdminInput label="Start date" value={filters.startDate} onChange={(value) => setFilter('startDate', value)} type="date" />
      <AdminInput label="End date" value={filters.endDate} onChange={(value) => setFilter('endDate', value)} type="date" />
      <AdminSelect label="Department" value={filters.department} onChange={(value) => setFilter('department', value)} options={[ALL_DEPARTMENTS, ...DEPARTMENTS]} />
      <AdminInput label="Customer search" value={filters.customer} onChange={(value) => setFilter('customer', value)} />
      <AdminInput label="Product search" value={filters.product} onChange={(value) => setFilter('product', value)} />
      <AdminInput label="Status search" value={filters.status === 'All' ? '' : filters.status} onChange={(value) => setFilter('status', value || 'All')} />
      <div className="grid content-end"><button className="h-11 rounded-lg bg-slate-100 px-4 font-black text-brand-navy" onClick={() => { setFilter('customer', ''); setFilter('product', ''); setFilter('status', 'All'); setFilter('department', ALL_DEPARTMENTS); }} type="button">Clear search</button></div>
    </div>
  );
}

function buildReportRows({ products, orders, quotations, customOrders, customers, productLookup, groupsLookup, filters }) {
  const matchesText = (value, search) => !String(search || '').trim() || String(value || '').toLowerCase().includes(String(search).trim().toLowerCase());
  const matchesStatus = (value) => filters.status === 'All' || matchesText(value, filters.status);
  const productDepartment = (product) => normalizeDepartment(product?.department);
  const productFamily = (product) => product?.groupId ? groupLabel(groupsLookup.get(product.groupId), [...groupsLookup.values()]) : '';
  const orderProduct = (item) => productLookup.get(item.productId) || products.find((product) => product.name === item.name) || {};
  const sales = (orders || []).flatMap((order) => (order.items || []).map((item) => {
    const product = orderProduct(item);
    return {
      Date: reportDateLabel(order),
      'Order No': order.receiptNo || order.id,
      Customer: order.customer || order.customerEmail || 'Customer',
      Product: [item.name, item.localName].filter(Boolean).join(' - '),
      Department: productDepartment(product),
      Quantity: item.quantity || 0,
      Price: money.format(item.price || 0),
      Amount: money.format(Number(item.price || 0) * Number(item.quantity || 0)),
      'Delivery Fee': money.format(order.deliveryFee || order.delivery?.fee || 0),
      Total: money.format(order.total || 0),
      Status: order.status || 'Not set',
      Payment: order.paymentStatus || 'Not set',
      _date: reportDate(order),
      _customer: `${order.customer || ''} ${order.customerEmail || ''} ${order.customerId || ''}`,
      _product: item.name,
      _department: productDepartment(product),
      _status: `${order.status || ''} ${order.paymentStatus || ''}`,
    };
  })).filter((row) => dateMatchesFilter(row._date, filters) && matchesText(row._customer, filters.customer) && matchesText(row._product, filters.product) && matchesStatus(row._status) && departmentMatches(row._department, filters.department)).map(stripReportMeta);

  const customerRows = (customers || []).map((customer) => {
    const customerOrders = (orders || []).filter((order) => order.customerId === customer.id || order.customerEmail === customer.email || order.customer === customer.name);
    const customerQuotes = (quotations || []).filter((quote) => quote.customerId === customer.id || quote.customer?.email === customer.email || quote.customer?.name === customer.name || quote.customer?.contact === customer.email);
    return {
      Date: reportDateLabel(customer),
      Customer: customer.name || 'Customer',
      Email: customer.email || 'Not set',
      Orders: customerOrders.length,
      Quotations: customerQuotes.length,
      'Total Spent': money.format(customerOrders.reduce((sum, order) => sum + Number(order.total || 0), 0)),
      _date: reportDate(customer),
      _customer: `${customer.name || ''} ${customer.email || ''} ${customer.phone || ''} ${customer.contact || ''} ${customer.id || ''}`,
      _status: '',
    };
  }).filter((row) => dateMatchesFilter(row._date, filters) && matchesText(row._customer, filters.customer) && matchesStatus(row._status)).map(stripReportMeta);

  const quoteRows = (quotations || []).map((quote) => ({
    Date: reportDateLabel(quote),
    'Quote ID': quote.id,
    Customer: quote.customer?.name || quote.customer?.email || 'Customer',
    Items: (quote.items || []).map((item) => item.description).join('; '),
    Subtotal: money.format(quote.subtotal || 0),
    VAT: money.format(quote.vatTotal || 0),
    'Delivery Fee': money.format(quote.deliveryFee || quote.delivery?.fee || 0),
    Total: money.format(quote.totalWithVat || 0),
    Status: quote.status || 'Not set',
    _date: reportDate(quote),
    _customer: `${quote.customer?.name || ''} ${quote.customer?.email || ''} ${quote.customer?.contact || ''} ${quote.customerId || ''}`,
    _product: (quote.items || []).map((item) => item.description).join(' '),
    _status: quote.status,
  })).filter((row) => dateMatchesFilter(row._date, filters) && matchesText(row._customer, filters.customer) && matchesText(row._product, filters.product) && matchesStatus(row._status)).map(stripReportMeta);

  const stock = (products || []).map((raw) => {
    const product = normalizeProduct(raw);
    return {
      Product: product.name,
      Department: productDepartment(product),
      Family: productFamily(product) || 'No family',
      Category: product.category || 'Not set',
      Stock: product.stock || 0,
      Unit: product.unit || 'Unit',
      Price: canShowPrice(product) ? money.format(product.price) : 'Call for price',
      'Image Status': normalizeImageUrl(product.image) && normalizeImageUrl(product.image) !== '/ophra-logo.png' ? 'Has image' : 'Missing image',
      Warning: Number(product.stock || 0) <= 0 ? 'Out of stock' : Number(product.stock || 0) <= LOW_STOCK_LIMIT ? 'Low stock' : 'OK',
      _date: reportDate(product),
      _product: `${product.name} ${product.category}`,
      _department: productDepartment(product),
      _status: `${product.tag || ''} ${Number(product.stock || 0) <= 0 ? 'Out of stock' : Number(product.stock || 0) <= LOW_STOCK_LIMIT ? 'Low stock' : 'OK'}`,
    };
  }).filter((row) => dateMatchesFilter(row._date, filters, true) && matchesText(row._product, filters.product) && matchesStatus(row._status) && departmentMatches(row._department, filters.department)).map(stripReportMeta);

  const deliveryOrders = (orders || []).filter((order) => order.delivery?.requested).map((order) => ({
    Date: reportDateLabel(order), Type: 'Order', Customer: order.customer || 'Customer', Reference: order.receiptNo || order.id, Site: order.delivery?.site || 'Not set', Distance: `${order.delivery?.distanceKm || 0} km`, Fee: money.format(order.deliveryFee || order.delivery?.fee || 0), 'Expected Time': order.delivery?.expectedDeliveryTime || 'To be confirmed', Status: order.status || 'Not set', _date: reportDate(order), _customer: `${order.customer || ''} ${order.customerEmail || ''} ${order.customerId || ''}`, _status: order.status,
  }));
  const deliveryQuotes = (quotations || []).filter((quote) => quote.delivery?.requested).map((quote) => ({
    Date: reportDateLabel(quote), Type: 'Quotation', Customer: quote.customer?.name || 'Customer', Reference: quote.id, Site: quote.delivery?.site || 'Not set', Distance: `${quote.delivery?.distanceKm || 0} km`, Fee: money.format(quote.deliveryFee || quote.delivery?.fee || 0), 'Expected Time': quote.delivery?.expectedDeliveryTime || quote.expectedDeliveryTime || 'To be confirmed', Status: quote.status || 'Not set', _date: reportDate(quote), _customer: `${quote.customer?.name || ''} ${quote.customer?.email || ''} ${quote.customer?.contact || ''} ${quote.customerId || ''}`, _status: quote.status,
  }));
  const delivery = [...deliveryOrders, ...deliveryQuotes].filter((row) => dateMatchesFilter(row._date, filters) && matchesText(row._customer, filters.customer) && matchesStatus(row._status)).map(stripReportMeta);

  return { Sales: sales, Customers: customerRows, Quotations: quoteRows, Stock: stock, Delivery: delivery };
}

function ReportTable({ title, rows }) {
  const columns = rows[0] ? Object.keys(rows[0]) : [];
  return (
    <section className="rounded-xl bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-black">{title}</h2><span className="rounded-full bg-brand-pale px-4 py-2 text-sm font-black text-brand-navy">{rows.length} rows</span></div>
      {!rows.length ? <EmptyState title="No report records" text="Try changing the filters or date range." /> : <div className="mt-5 overflow-auto rounded-xl border border-slate-200"><table className="w-full min-w-[720px] text-left text-sm lg:min-w-[900px]"><thead className="bg-slate-50 text-slate-500"><tr>{columns.map((column) => <th key={column} className="p-3">{column}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index} className="border-t border-slate-200">{columns.map((column) => <td key={column} className="p-3 align-top">{row[column]}</td>)}</tr>)}</tbody></table></div>}
    </section>
  );
}

function reportDate(record) {
  const value = record?.createdAtIso || record?.createdAt || record?.approvedAt;
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function reportDateLabel(record) {
  return record?.createdAt || record?.approvedAt || (record?.createdAtIso ? new Date(record.createdAtIso).toLocaleDateString('en-GB') : 'Not set');
}

function reportPeriodRange(filters) {
  const now = new Date();
  if (filters.period === 'All Time') return { start: null, end: null };
  if (filters.period === 'Custom') return { start: dateInputStart(filters.startDate), end: dateInputEnd(filters.endDate) };
  if (filters.period === 'Annual') return { start: new Date(now.getFullYear(), 0, 1), end: new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999) };
  if (filters.period === 'Quarterly') {
    const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
    return { start: new Date(now.getFullYear(), quarterStartMonth, 1), end: new Date(now.getFullYear(), quarterStartMonth + 3, 0, 23, 59, 59, 999) };
  }
  return { start: new Date(now.getFullYear(), now.getMonth(), now.getDate()), end: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999) };
}

function dateInputStart(value) {
  return value ? new Date(`${value}T00:00:00`) : null;
}

function dateInputEnd(value) {
  return value ? new Date(`${value}T23:59:59.999`) : null;
}

function dateMatchesFilter(date, filters, includeUndated = false) {
  if (filters.period === 'All Time') return true;
  if (!date) return includeUndated;
  const { start, end } = reportPeriodRange(filters);
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
}

function departmentMatches(value, filter) {
  return filter === ALL_DEPARTMENTS || normalizeDepartment(value) === filter;
}

function stripReportMeta(row) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith('_')));
}

function csvValue(value) {
  const text = String(value ?? '').replace(/\r?\n/g, ' ');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(filename, rows) {
  if (!rows.length) return;
  const columns = Object.keys(rows[0]);
  const csv = [columns.map(csvValue).join(','), ...rows.map((row) => columns.map((column) => csvValue(row[column])).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}


function downloadReportPdf(filename, title, rows, filters) {
  if (!rows.length) return;
  const columns = Object.keys(rows[0]);
  const pageWidth = 842;
  const pageHeight = 595;
  const margin = 28;
  const usableWidth = pageWidth - margin * 2;
  const rowHeight = 13;
  const weights = columns.map((column) => Math.min(24, Math.max(8, column.length, ...rows.slice(0, 40).map((row) => String(row[column] ?? '').length))));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0) || 1;
  const widths = weights.map((weight) => usableWidth * (weight / totalWeight));
  const starts = widths.reduce((list, width, index) => [...list, (list[index] || margin) + width], [margin]).slice(0, -1);
  const pages = [];
  let commands = [];
  let y = pageHeight - margin;

  function addText(text, x, lineY, size = 8) {
    commands.push(`BT /F1 ${size} Tf ${x.toFixed(1)} ${lineY.toFixed(1)} Td (${pdfEscape(text)}) Tj ET`);
  }

  function finishPage() {
    pages.push(commands.join('\n'));
    commands = [];
    y = pageHeight - margin;
  }

  function addHeader() {
    addText(BRAND_NAME, margin, y, 15);
    y -= 18;
    addText(`${title} - ${reportDateSuffix(filters)}`, margin, y, 10);
    y -= 20;
    columns.forEach((column, index) => addText(fitPdfText(column, widths[index]), starts[index], y, 7));
    y -= rowHeight;
  }

  addHeader();
  rows.forEach((row) => {
    if (y < margin + rowHeight) {
      finishPage();
      addHeader();
    }
    columns.forEach((column, index) => addText(fitPdfText(row[column], widths[index]), starts[index], y, 7));
    y -= rowHeight;
  });
  finishPage();

  const pdf = buildSimplePdf(pages, pageWidth, pageHeight);
  const blob = new Blob([pdf], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function fitPdfText(value, width) {
  const maxChars = Math.max(6, Math.floor(width / 4.1));
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > maxChars ? `${text.slice(0, Math.max(3, maxChars - 3))}...` : text;
}

function pdfEscape(value) {
  return String(value ?? '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function buildSimplePdf(pageStreams, pageWidth, pageHeight) {
  const objects = [];
  const fontId = 3;
  const pageIds = pageStreams.map((_, index) => 4 + index * 2);
  const contentIds = pageStreams.map((_, index) => 5 + index * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  objects[fontId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>';
  pageStreams.forEach((stream, index) => {
    const pageId = pageIds[index];
    const contentId = contentIds[index];
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let id = 1; id < objects.length; id += 1) {
    if (!objects[id]) continue;
    offsets[id] = pdf.length;
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) {
    pdf += `${String(offsets[id] || 0).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return pdf;
}

function reportDateSuffix(filters) {
  const { start, end } = reportPeriodRange(filters);
  const format = (date) => date ? date.toISOString().slice(0, 10) : 'all';
  return `${filters.period.toLowerCase()}-${format(start)}-to-${format(end)}`;
}

function adminMonitoringData({ products, productGroups, orders, quotations, customOrders, customers, transportSettings }) {
  const cleanProducts = Array.isArray(products) ? products.map(normalizeProduct) : [];
  const cleanOrders = Array.isArray(orders) ? orders : [];
  const cleanQuotes = Array.isArray(quotations) ? quotations : [];
  const cleanRequests = Array.isArray(customOrders) ? customOrders : [];
  const cleanCustomers = Array.isArray(customers) ? customers : [];
  const familyIds = new Set((Array.isArray(productGroups) ? productGroups : []).map((group) => group.id));
  const status = (value) => String(value || '').toLowerCase();
  const orderValue = (order) => Number(order?.total || 0);
  const quoteValue = (quote) => Number(quote?.totalWithVat || 0);
  const isPending = (value) => status(value).includes('pending');
  const isCompleted = (value) => status(value).includes('complete') || status(value).includes('delivered');
  const isCancelled = (value) => status(value).includes('cancel') || status(value).includes('decline');
  const isApproved = (value) => status(value).includes('approved');
  const isPaid = (order) => status(order?.paymentStatus).includes('paid') || isCompleted(order?.status);
  const outOfStock = cleanProducts.filter((product) => Number(product.stock || 0) <= 0);
  const lowStock = cleanProducts.filter((product) => Number(product.stock || 0) > 0 && Number(product.stock || 0) <= LOW_STOCK_LIMIT);
  const withoutPrice = cleanProducts.filter((product) => !canShowPrice(product));
  const withoutImage = cleanProducts.filter((product) => !normalizeImageUrl(product.image) || normalizeImageUrl(product.image) === '/ophra-logo.png');
  const withoutFamily = cleanProducts.filter((product) => !product.groupId || !familyIds.has(product.groupId));
  const withoutDescription = cleanProducts.filter((product) => !String(product.description || '').trim());
  const hardwareProducts = cleanProducts.filter((product) => normalizeDepartment(product.department) === 'Hardware Tools');
  const foodProducts = cleanProducts.filter((product) => normalizeDepartment(product.department) === 'Food Products');
  const paidOrders = cleanOrders.filter(isPaid);
  const pendingOrders = cleanOrders.filter((order) => isPending(order.status));
  const completedOrders = cleanOrders.filter((order) => isCompleted(order.status));
  const cancelledOrders = cleanOrders.filter((order) => isCancelled(order.status));
  const productSales = new Map();
  paidOrders.forEach((order) => (order.items || []).forEach((item) => {
    const key = item.productId || item.name;
    const current = productSales.get(key) || { name: item.name || 'Product', quantity: 0, value: 0 };
    current.quantity += Number(item.quantity || 0);
    current.value += Number(item.price || 0) * Number(item.quantity || 0);
    productSales.set(key, current);
  }));
  const topSellingProducts = [...productSales.values()].sort((a, b) => b.quantity - a.quantity || b.value - a.value).slice(0, 6);
  const pendingQuotes = cleanQuotes.filter((quote) => isPending(quote.status));
  const approvedQuotes = cleanQuotes.filter((quote) => isApproved(quote.status));
  const declinedQuotes = cleanQuotes.filter((quote) => isCancelled(quote.status));
  const pendingCustomRequests = cleanRequests.filter((request) => isPending(request.status));
  const customerOrderCounts = new Map();
  cleanOrders.forEach((order) => {
    const key = order.customerEmail || order.customerId || order.customer;
    if (key) customerOrderCounts.set(key, (customerOrderCounts.get(key) || 0) + 1);
  });
  const customersWithOrders = cleanCustomers.filter((customer) => customerOrderCounts.has(customer.email) || customerOrderCounts.has(customer.id));
  const customersWithQuotes = cleanCustomers.filter((customer) => cleanQuotes.some((quote) => quote.customerId === customer.id || quote.customer?.email === customer.email || quote.customer?.contact === customer.email));
  const repeatCustomers = cleanCustomers.filter((customer) => (customerOrderCounts.get(customer.email) || customerOrderCounts.get(customer.id) || 0) > 1);
  const deliveredOrders = cleanOrders.filter((order) => order.delivery?.requested);
  const deliveredQuotes = cleanQuotes.filter((quote) => quote.delivery?.requested);
  const deliveryFeeTotal = deliveredOrders.reduce((sum, order) => sum + Number(order.deliveryFee || order.delivery?.fee || 0), 0) + deliveredQuotes.reduce((sum, quote) => sum + Number(quote.deliveryFee || quote.delivery?.fee || 0), 0);
  const officeReady = Boolean(transportSettings?.officeAddress || (transportSettings?.officeLat && transportSettings?.officeLng));
  const pricingReady = Number(transportSettings?.baseFee || 0) > 0 || Number(transportSettings?.pricePerKm || 0) > 0 || Number(transportSettings?.minimumFee || 0) > 0;
  return {
    stock: { total: cleanProducts.length, hardware: hardwareProducts.length, food: foodProducts.length, outOfStock, lowStock, lowStockLimit: LOW_STOCK_LIMIT },
    sales: { totalOrders: cleanOrders.length, paidOrders, pendingOrders, completedOrders, cancelledOrders, totalSalesValue: paidOrders.reduce((sum, order) => sum + orderValue(order), 0), pendingValue: pendingOrders.reduce((sum, order) => sum + orderValue(order), 0), topSellingProducts, recentOrders: cleanOrders.slice(0, 6) },
    quotations: { total: cleanQuotes.length, pendingQuotes, approvedQuotes, declinedQuotes, totalValue: cleanQuotes.reduce((sum, quote) => sum + quoteValue(quote), 0), approvedValue: approvedQuotes.reduce((sum, quote) => sum + quoteValue(quote), 0), pendingCustomRequests, recentQuotes: cleanQuotes.slice(0, 6) },
    customers: { total: cleanCustomers.length, withOrders: customersWithOrders, withQuotes: customersWithQuotes, repeatCustomers, recentCustomers: cleanCustomers.slice(0, 6) },
    quality: { withoutPrice, withoutImage, withoutFamily, withoutDescription, attentionProducts: uniqueBy([...withoutPrice, ...withoutImage, ...withoutFamily, ...withoutDescription], 'id').slice(0, 8) },
    transport: { enabled: Boolean(transportSettings?.enabled), officeReady, pricingReady, expectedDeliveryTime: expectedDeliveryTime(transportSettings), deliveryRequests: deliveredOrders.length + deliveredQuotes.length, deliveryFeeTotal, deliveryItems: [...deliveredOrders.map((order) => ({ id: order.id, type: 'Order', customer: order.customer, status: order.status, fee: order.deliveryFee || order.delivery?.fee || 0, site: order.delivery?.site })), ...deliveredQuotes.map((quote) => ({ id: quote.id, type: 'Quotation', customer: quote.customer?.name || 'Customer', status: quote.status, fee: quote.deliveryFee || quote.delivery?.fee || 0, site: quote.delivery?.site }))].slice(0, 6) },
  };
}

function uniqueBy(items, field) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item?.[field] || item?.name;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function AdminDashboard({ monitoring, editProduct, openView }) {
  const { stock, sales, quotations, customers, quality, transport } = monitoring;
  const stockAttention = [...stock.outOfStock, ...stock.lowStock].slice(0, 6);
  const productIssueLabel = (product) => {
    const issues = [];
    if (!canShowPrice(product)) issues.push('No price');
    if (!normalizeImageUrl(product.image) || normalizeImageUrl(product.image) === '/ophra-logo.png') issues.push('No image');
    if (!product.groupId) issues.push('No family');
    if (!String(product.description || '').trim()) issues.push('No description');
    return issues.join(', ') || 'Check product';
  };
  return (
    <section className="mt-6 grid gap-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MonitorMetric icon={PackageOpen} label="Products" value={stock.total} note={`${stock.hardware} hardware / ${stock.food} food`} />
        <MonitorMetric icon={ShoppingCart} label="Paid sales value" value={money.format(sales.totalSalesValue)} note={`${sales.paidOrders.length} paid orders`} />
        <MonitorMetric icon={ClipboardList} label="Pending quotations" value={quotations.pendingQuotes.length} note={`${money.format(quotations.totalValue)} total quote value`} />
        <MonitorMetric icon={Truck} label="Delivery requests" value={transport.deliveryRequests} note={`${money.format(transport.deliveryFeeTotal)} delivery fees`} />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <MonitorPanel title="1. Stock" actionLabel="Open products" onAction={() => openView('PRODUCTS')}>
          <div className="grid gap-3 sm:grid-cols-3"><InfoBox label="Out of stock" value={stock.outOfStock.length} /><InfoBox label="Low stock" value={`${stock.lowStock.length} items`} /><InfoBox label="Low stock rule" value={`${stock.lowStockLimit} or fewer`} /></div>
          <MonitorTable empty="Stock is healthy." rows={stockAttention} columns={["Product", "Stock", "Action"]} renderRow={(product) => <tr key={product.id} className="border-t border-slate-200"><td className="p-3 font-bold">{product.name}</td><td className="p-3">{product.stock} {product.unit}</td><td className="p-3"><button className="rounded-lg bg-brand-navy px-3 py-2 text-xs font-black text-white" onClick={() => editProduct(product)} type="button">Edit</button></td></tr>} />
        </MonitorPanel>
        <MonitorPanel title="2. Sales and Orders" actionLabel="Open orders" onAction={() => openView('ORDERS')}>
          <div className="grid gap-3 sm:grid-cols-4"><InfoBox label="Orders" value={sales.totalOrders} /><InfoBox label="Pending" value={sales.pendingOrders.length} /><InfoBox label="Completed" value={sales.completedOrders.length} /><InfoBox label="Cancelled" value={sales.cancelledOrders.length} /></div>
          <MonitorTable empty="No orders yet." rows={sales.recentOrders} columns={["Customer", "Status", "Total"]} renderRow={(order) => <tr key={order.id} className="border-t border-slate-200"><td className="p-3 font-bold">{order.customer || 'Customer'}</td><td className="p-3"><StatusPill status={order.status} /></td><td className="p-3 font-black text-brand-navy">{money.format(order.total || 0)}</td></tr>} />
          {sales.topSellingProducts.length > 0 && <div className="mt-4 rounded-xl bg-slate-50 p-3"><p className="font-black text-slate-950">Top selling products</p><div className="mt-2 grid gap-2">{sales.topSellingProducts.map((item) => <div key={item.name} className="flex justify-between gap-3 text-sm"><span>{item.name} x {item.quantity}</span><strong>{money.format(item.value)}</strong></div>)}</div></div>}
        </MonitorPanel>
        <MonitorPanel title="3. Quotations" actionLabel="Open quotations" onAction={() => openView('QUOTATIONS')}>
          <div className="grid gap-3 sm:grid-cols-4"><InfoBox label="Total" value={quotations.total} /><InfoBox label="Pending" value={quotations.pendingQuotes.length} /><InfoBox label="Approved" value={quotations.approvedQuotes.length} /><InfoBox label="Custom requests" value={quotations.pendingCustomRequests.length} /></div>
          <MonitorTable empty="No quotations yet." rows={quotations.recentQuotes} columns={["Customer", "Status", "Value"]} renderRow={(quote) => <tr key={quote.id} className="border-t border-slate-200"><td className="p-3 font-bold">{quote.customer?.name || 'Customer'}</td><td className="p-3"><StatusPill status={quote.status} /></td><td className="p-3 font-black text-brand-navy">{money.format(quote.totalWithVat || 0)}</td></tr>} />
        </MonitorPanel>
        <MonitorPanel title="4. Customers" actionLabel="Open orders" onAction={() => openView('ORDERS')}>
          <div className="grid gap-3 sm:grid-cols-4"><InfoBox label="Accounts" value={customers.total} /><InfoBox label="With orders" value={customers.withOrders.length} /><InfoBox label="With quotes" value={customers.withQuotes.length} /><InfoBox label="Repeat customers" value={customers.repeatCustomers.length} /></div>
          <MonitorTable empty="No customer accounts yet." rows={customers.recentCustomers} columns={["Customer", "Email", "Joined"]} renderRow={(customer) => <tr key={customer.id || customer.email} className="border-t border-slate-200"><td className="p-3 font-bold">{customer.name || 'Customer'}</td><td className="p-3">{customer.email || 'Not set'}</td><td className="p-3">{customer.createdAt || 'Not set'}</td></tr>} />
        </MonitorPanel>
        <MonitorPanel title="5. Product Quality Checks" actionLabel="Open products" onAction={() => openView('PRODUCTS')}>
          <div className="grid gap-3 sm:grid-cols-4"><InfoBox label="No price" value={quality.withoutPrice.length} /><InfoBox label="No image" value={quality.withoutImage.length} /><InfoBox label="No family" value={quality.withoutFamily.length} /><InfoBox label="No description" value={quality.withoutDescription.length} /></div>
          <MonitorTable empty="No product quality issues." rows={quality.attentionProducts} columns={["Product", "Issue", "Action"]} renderRow={(product) => <tr key={product.id} className="border-t border-slate-200"><td className="p-3 font-bold">{product.name}</td><td className="p-3">{productIssueLabel(product)}</td><td className="p-3"><button className="rounded-lg bg-brand-navy px-3 py-2 text-xs font-black text-white" onClick={() => editProduct(product)} type="button">Edit</button></td></tr>} />
        </MonitorPanel>
        <MonitorPanel title="6. Delivery and Transport" actionLabel="Open transport" onAction={() => openView('TRANSPORT')}>
          <div className="grid gap-3 sm:grid-cols-4"><InfoBox label="Status" value={transport.enabled ? 'Enabled' : 'Off'} /><InfoBox label="Office" value={transport.officeReady ? 'Ready' : 'Set office'} /><InfoBox label="Pricing" value={transport.pricingReady ? 'Ready' : 'Set rates'} /><InfoBox label="Expected time" value={transport.expectedDeliveryTime} /></div>
          <MonitorTable empty="No delivery requests yet." rows={transport.deliveryItems} columns={["Type", "Customer", "Fee"]} renderRow={(item) => <tr key={`${item.type}-${item.id}`} className="border-t border-slate-200"><td className="p-3 font-bold">{item.type}</td><td className="p-3">{item.customer || 'Customer'}<br /><span className="text-xs text-slate-500">{item.site || 'Site not set'}</span></td><td className="p-3 font-black text-brand-navy">{money.format(item.fee || 0)}</td></tr>} />
        </MonitorPanel>
      </div>
    </section>
  );
}

function MonitorMetric({ icon: Icon, label, value, note }) {
  return <div className="rounded-xl bg-white p-5 shadow-sm"><Icon className="text-brand-navy" size={22} /><p className="mt-5 text-3xl font-black">{value}</p><p className="text-sm font-bold text-slate-600">{label}</p><p className="mt-1 text-xs text-slate-500">{note}</p></div>;
}

function MonitorPanel({ title, children, actionLabel, onAction }) {
  return <section className="rounded-xl bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-black">{title}</h2>{actionLabel && <button className="rounded-lg bg-brand-pale px-4 py-2 text-sm font-black text-brand-navy" onClick={onAction} type="button">{actionLabel}</button>}</div><div className="mt-4 grid gap-4">{children}</div></section>;
}

function MonitorTable({ rows, columns, renderRow, empty }) {
  if (!rows.length) return <EmptyState title={empty} text="Nothing needs attention here right now." />;
  return <div className="overflow-auto rounded-xl border border-slate-200"><table className="w-full min-w-[480px] text-left text-sm md:min-w-[520px]"><thead className="bg-slate-50 text-slate-500"><tr>{columns.map((column) => <th key={column} className="p-3">{column}</th>)}</tr></thead><tbody>{rows.map(renderRow)}</tbody></table></div>;
}

function StatusPill({ status }) {
  const cleanStatus = String(status || 'Not set');
  const lower = cleanStatus.toLowerCase();
  const tone = lower.includes('approved') || lower.includes('complete') || lower.includes('paid') || lower.includes('accepted') ? 'bg-emerald-50 text-emerald-700' : lower.includes('decline') || lower.includes('cancel') ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700';
  return <span className={`inline-flex rounded-full px-3 py-1 text-xs font-black ${tone}`}>{cleanStatus}</span>;
}

function AdminInput({ label, value, onChange, type = 'text', required = false }) {
  return <label className="grid gap-1 text-sm font-bold text-slate-600">{label}<input className="h-11 rounded-lg border border-slate-200 px-3 text-base font-normal text-slate-950 outline-none focus:border-brand-navy" value={value} onChange={(event) => onChange(event.target.value)} type={type} required={required} /></label>;
}

function AdminSelect({ label, value, onChange, options, required = false }) {
  return <label className="grid gap-1 text-sm font-bold text-slate-600">{label}<select className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-base font-normal text-slate-950 outline-none focus:border-brand-navy" value={value} onChange={(event) => onChange(event.target.value)} required={required}>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>;
}

function CatalogGroupSelect({ label, value, onChange, groups }) {
  const sortedGroups = [...groups].sort((a, b) => groupLabel(a, groups).localeCompare(groupLabel(b, groups)));
  return (
    <label className="grid gap-1 text-sm font-bold text-slate-600">
      {label}
      <select className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-base font-normal text-slate-950 outline-none focus:border-brand-navy" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Top level / no parent</option>
        {sortedGroups.map((group) => <option key={group.id} value={group.id}>{groupLabel(group, groups)}</option>)}
      </select>
    </label>
  );
}

function ProductOptionTextarea({ label, value, onChange, placeholder }) {
  return (
    <label className="grid gap-1 text-sm font-bold text-slate-600">
      {label}
      <textarea className="min-h-24 rounded-lg border border-slate-200 px-3 py-2 text-base font-normal text-slate-950 outline-none focus:border-brand-navy" value={listToOptionText(value)} onChange={(event) => onChange(optionTextToList(event.target.value))} placeholder={placeholder} />
    </label>
  );
}

function FamilyProductsEditor({ familyName, products = [], updateProduct, addProduct, removeProduct }) {
  const items = Array.isArray(products) ? products : [];
  return (
    <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between gap-3">
        <div><h3 className="font-black text-slate-950">Products / varieties under this family</h3><p className="text-xs font-normal text-slate-500">Add sellable options customers should see after clicking {familyName || 'this family'}.</p></div>
        <button className="rounded-lg bg-brand-navy px-4 py-2 text-sm font-black text-white" onClick={addProduct} type="button">Add</button>
      </div>
      {items.length === 0 ? <p className="rounded-lg bg-white p-3 text-sm font-normal text-slate-500">No products added here yet. You can still add them from the Products page later.</p> : items.map((item, index) => (
        <div key={item.id || index} className="grid gap-3 rounded-xl bg-white p-3 shadow-sm">
          <div className="grid gap-3 sm:grid-cols-[110px_1fr]">
            <div className="grid gap-2">
              <div className="grid h-24 w-24 place-items-center rounded-lg bg-slate-50 p-2">
                <img className="max-h-full max-w-full object-contain" src={normalizeImageUrl(item.image) || '/ophra-logo.png'} alt={item.name || 'Family product'} />
              </div>
              <CloudinaryUploadButton onUploaded={(imageUrl) => updateProduct(index, 'image', imageUrl)} />
              <AdminInput label="Image URL" value={item.image || ''} onChange={(value) => updateProduct(index, 'image', normalizeImageUrl(value))} />
            </div>
            <div className="grid gap-2">
              <AdminInput label="Product / variety name" value={item.name || ''} onChange={(value) => updateProduct(index, 'name', value)} />
              <AdminInput label="Local name" value={item.localName || ''} onChange={(value) => updateProduct(index, 'localName', value)} />
              <AdminInput label="Category" value={item.category || familyName || ''} onChange={(value) => updateProduct(index, 'category', value)} />
              <div className="grid gap-2 sm:grid-cols-3">
                <AdminInput label="Unit" value={item.unit || 'Piece'} onChange={(value) => updateProduct(index, 'unit', value)} />
                <AdminInput label="Price (optional)" value={item.price || ''} onChange={(value) => updateProduct(index, 'price', value)} type="number" />
                <AdminInput label="Stock" value={item.stock || 0} onChange={(value) => updateProduct(index, 'stock', value)} type="number" />
              </div>
              <AdminInput label="Tag" value={item.tag || 'Available'} onChange={(value) => updateProduct(index, 'tag', value)} />
              <label className="grid gap-1 text-sm font-bold text-slate-600">Description<textarea className="min-h-20 rounded-lg border border-slate-200 px-3 py-2 text-base font-normal text-slate-950 outline-none focus:border-brand-navy" value={item.description || ''} onChange={(event) => updateProduct(index, 'description', event.target.value)} /></label>
            </div>
          </div>
          <button className="justify-self-start rounded-lg bg-rose-50 px-4 py-2 text-sm font-black text-rose-700" onClick={() => removeProduct(index)} type="button">Remove product</button>
        </div>
      ))}
    </div>
  );
}

function ProductVarietiesEditor({ varieties = [], updateVariety, addVariety, removeVariety }) {
  const items = Array.isArray(varieties) ? varieties : [];
  return (
    <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between gap-3">
        <div><h3 className="font-black text-slate-950">Varieties / brands</h3><p className="text-xs font-normal text-slate-500">Add options like Hex Bolt, Allen Bolt, Twiga Cement, Rhino Cement.</p></div>
        <button className="rounded-lg bg-brand-navy px-4 py-2 text-sm font-black text-white" onClick={addVariety} type="button">Add</button>
      </div>
      {items.length === 0 ? <p className="rounded-lg bg-white p-3 text-sm font-normal text-slate-500">No varieties added yet.</p> : items.map((item, index) => {
        const variety = typeof item === 'string' ? { name: item, description: '', image: '' } : item;
        return (
          <div key={index} className="grid gap-3 rounded-xl bg-white p-3 shadow-sm">
            <div className="grid gap-3 sm:grid-cols-[110px_1fr]">
              <div className="grid gap-2">
                <div className="grid h-24 w-24 place-items-center rounded-lg bg-slate-50 p-2">
                  <img className="max-h-full max-w-full object-contain" src={normalizeImageUrl(variety.image) || '/ophra-logo.png'} alt={variety.name || 'Variety'} />
                </div>
                <CloudinaryUploadButton onUploaded={(imageUrl) => updateVariety(index, 'image', imageUrl)} />
                <AdminInput label="Image URL" value={variety.image || ''} onChange={(value) => updateVariety(index, 'image', normalizeImageUrl(value))} />
              </div>
              <div className="grid gap-2">
                <AdminInput label="Name" value={variety.name || ''} onChange={(value) => updateVariety(index, 'name', value)} />
                <label className="grid gap-1 text-sm font-bold text-slate-600">Maelezo<textarea className="min-h-20 rounded-lg border border-slate-200 px-3 py-2 text-base font-normal text-slate-950 outline-none focus:border-brand-navy" value={variety.description || ''} onChange={(event) => updateVariety(index, 'description', event.target.value)} /></label>
              </div>
            </div>
            <button className="justify-self-start rounded-lg bg-rose-50 px-4 py-2 text-sm font-black text-rose-700" onClick={() => removeVariety(index)} type="button">Remove variety</button>
          </div>
        );
      })}
    </div>
  );
}

function ProductImageUrlInput({ image, onChange, onRemove, label = 'Product image' }) {
  const cleanImage = normalizeImageUrl(image);
  const hasCustomImage = Boolean(cleanImage && cleanImage !== '/ophra-logo.png');
  return (
    <div className="grid gap-2 text-sm font-bold text-slate-600">
      <span>{label}</span>
      <div className="grid gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3">
        <div className="grid min-h-40 place-items-center rounded-lg bg-white p-3">
          <img className="max-h-40 max-w-full object-contain" src={cleanImage || '/ophra-logo.png'} alt="Product preview" />
        </div>
        <CloudinaryUploadButton onUploaded={onChange} />
        <AdminInput label="Image URL" value={cleanImage} onChange={(value) => onChange(normalizeImageUrl(value))} />
        <p className="text-xs font-normal text-slate-500">Upload a file to Cloudinary or paste an image link. The database stores only the final URL, not the image file.</p>
        {hasCustomImage && <button className="h-11 justify-self-start rounded-xl bg-slate-200 px-5 font-black text-slate-700" onClick={onRemove} type="button">Remove URL</button>}
      </div>
    </div>
  );
}

function CloudinaryUploadButton({ onUploaded }) {
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const ready = Boolean(CLOUDINARY_CLOUD_NAME && CLOUDINARY_UPLOAD_PRESET);

  async function handleUpload(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    setStatus('Uploading image...');
    try {
      const imageUrl = await uploadImageToCloudinary(file);
      onUploaded(imageUrl);
      setStatus('Image uploaded. URL saved in the form.');
    } catch (error) {
      setStatus(error.message || 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <label className={`grid gap-1 rounded-lg border border-slate-200 bg-white p-3 text-sm ${ready ? 'cursor-pointer' : 'opacity-70'}`}>
      <span className="font-black text-brand-navy">{busy ? 'Uploading...' : 'Upload image to Cloudinary'}</span>
      <input className="text-sm font-normal text-slate-600" type="file" accept="image/*" onChange={handleUpload} disabled={!ready || busy} />
      <span className="text-xs font-normal text-slate-500">{ready ? status || 'Choose an image file. Cloudinary will return a URL automatically.' : 'Add Cloudinary cloud name and unsigned upload preset in the environment first.'}</span>
    </label>
  );
}

function TransportSettingsView({ settings, setField, saveSettings }) {
  const sampleDistance = 10;
  const sampleFee = calculateDeliveryFee(sampleDistance, settings);
  const officePoint = settings.officeLat && settings.officeLng ? `${settings.officeLat}, ${settings.officeLng}` : settings.officeAddress || 'Not set';

  return (
    <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(320px,420px)_1fr]">
      <form className="rounded-xl bg-white p-5 shadow-sm" onSubmit={saveSettings}>
        <h2 className="text-xl font-black">Transport settings</h2>
        <p className="mt-2 text-sm text-slate-500">These metrics are used in the cart when a customer chooses delivery.</p>
        <div className="mt-5 grid gap-3">
          <AdminInput label="Office name" value={settings.officeName} onChange={(value) => setField('officeName', value)} />
          <AdminInput label="Office address" value={settings.officeAddress} onChange={(value) => setField('officeAddress', value)} />
          <div className="grid gap-3 sm:grid-cols-2">
            <AdminInput label="Office latitude" value={settings.officeLat} onChange={(value) => setField('officeLat', value)} />
            <AdminInput label="Office longitude" value={settings.officeLng} onChange={(value) => setField('officeLng', value)} />
          </div>
          <AdminInput label="Expected delivery time" value={settings.expectedDeliveryTime} onChange={(value) => setField('expectedDeliveryTime', value)} />
          <div className="grid gap-3 sm:grid-cols-3">
            <AdminInput label="Base fee" value={settings.baseFee} onChange={(value) => setField('baseFee', value)} type="number" />
            <AdminInput label="Price per km" value={settings.pricePerKm} onChange={(value) => setField('pricePerKm', value)} type="number" />
            <AdminInput label="Minimum fee" value={settings.minimumFee} onChange={(value) => setField('minimumFee', value)} type="number" />
          </div>
        </div>
        <button className="mt-5 h-11 rounded-xl bg-brand-navy px-6 font-black text-white" type="submit">Save transport</button>
      </form>

      <div className="rounded-xl bg-white p-5 shadow-sm">
        <h2 className="text-xl font-black">Delivery calculation</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <InfoBox label="Office point" value={officePoint} />
          <InfoBox label="10 km example" value={money.format(sampleFee)} />
          <InfoBox label="Base fee" value={money.format(settings.baseFee)} />
          <InfoBox label="Per kilometer" value={`${money.format(settings.pricePerKm)} / km`} />
          <InfoBox label="Expected delivery" value={expectedDeliveryTime(settings)} />
        </div>
        <div className="mt-5 rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">
          Customers choose delivery from a compact Google map in the cart. When they use their current location or enter coordinates, the app estimates distance from the office point and applies your transport rate automatically.
        </div>
      </div>
    </section>
  );
}

function AdminList({ title, empty, items, renderItem }) {
  return (
    <section className="mt-6 rounded-xl bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-black">{title}</h2><span className="rounded-full bg-brand-pale px-4 py-2 text-sm font-black text-brand-navy">{items.length}</span></div>
      <div className="mt-5 grid gap-3">{items.length === 0 ? <EmptyState title={empty} text="New customer activity will appear here." /> : items.map(renderItem)}</div>
    </section>
  );
}

function CustomOrderRow({ order, updateCustomOrder }) {
  return (
    <article className="rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h3 className="text-lg font-black">{order.name}</h3><p className="text-sm text-slate-500">{order.createdAt} - {order.status}</p></div>
        <div className="flex gap-2"><button className="rounded-lg bg-emerald-50 px-4 py-2 font-black text-emerald-700" onClick={() => updateCustomOrder(order.id, 'Accepted')} type="button">Accept</button><button className="rounded-lg bg-rose-50 px-4 py-2 font-black text-rose-700" onClick={() => updateCustomOrder(order.id, 'Declined')} type="button">Decline</button></div>
      </div>
      <p className="mt-3 text-slate-600">{order.description}</p>
      <div className="mt-3 grid gap-2 text-sm text-slate-500 md:grid-cols-3"><span>Quantity: {order.quantity}</span><span>Location: {order.location || 'Not set'}</span><span>Contact: {order.phone || order.email || 'Not set'}</span></div>
    </article>
  );
}

function QuotationRow({ quote, updateQuotation }) {
  return (
    <article className="rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h3 className="text-lg font-black">{quote.customer?.name || 'Customer'}</h3><p className="text-sm text-slate-500">{quote.createdAt} - {quote.status}</p></div>
        <div className="flex gap-2"><button className="rounded-lg bg-emerald-50 px-4 py-2 font-black text-emerald-700" onClick={() => updateQuotation(quote.id, 'Approved')} type="button">Approve</button><button className="rounded-lg bg-rose-50 px-4 py-2 font-black text-rose-700" onClick={() => updateQuotation(quote.id, 'Declined')} type="button">Decline</button></div>
      </div>
      <div className="mt-4 overflow-auto rounded-xl border border-slate-200">
        <table className="w-full min-w-[640px] text-left text-sm md:min-w-[720px]">
          <thead className="bg-slate-50 text-slate-500"><tr><th className="p-3">#</th><th className="p-3">Description</th><th className="p-3">Quantity</th><th className="p-3">Price</th><th className="p-3">Amount</th><th className="p-3">Amount + VAT 18%</th></tr></thead>
          <tbody>{(quote.items || []).map((item, index) => <tr key={`${quote.id}-${index}`} className="border-t border-slate-200"><td className="p-3">{index + 1}</td><td className="p-3">{item.description}</td><td className="p-3">{item.quantity}</td><td className="p-3">{money.format(item.price)}</td><td className="p-3">{money.format(item.amount)}</td><td className="p-3 font-black">{money.format(item.amountWithVat)}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="mt-4 grid gap-2 text-sm text-slate-600 md:grid-cols-2"><span>Customer contact: {quote.customer?.contact || 'Not set'}</span><span>Bank account: {quote.bankAccount || 'Not set'}</span><span>TIN: {quote.customer?.tin || 'Optional'}</span><span>VRN: {quote.customer?.vrn || 'Not set'}</span></div>
      {quote.delivery?.requested && <DeliverySummary delivery={quote.delivery} />}
      <p className="mt-4 text-right text-xl font-black text-brand-navy">Total: {money.format(quote.totalWithVat || 0)}</p>
      <p className="mt-2 text-right text-sm text-slate-500">Thank you for choosing us.</p>
    </article>
  );
}

function DeliverySummary({ delivery }) {
  return (
    <div className="mt-4 grid gap-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-600 md:grid-cols-2">
      <span>Delivery site: <strong className="text-slate-950">{delivery.site || 'Not set'}</strong></span>
      <span>Distance: <strong className="text-slate-950">{delivery.distanceKm || 0} km</strong></span>
      <span>Transport fee: <strong className="text-brand-navy">{money.format(delivery.fee || 0)}</strong></span>
      <span>Expected delivery: <strong className="text-slate-950">{delivery.expectedDeliveryTime || 'To be confirmed'}</strong></span>
      {delivery.directionsUrl && <a className="font-black text-brand-navy" href={delivery.directionsUrl} target="_blank" rel="noreferrer">Open route</a>}
    </div>
  );
}

function OrderRow({ order }) {
  return (
    <article className="rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="text-lg font-black">{order.customer}</h3><p className="text-sm text-slate-500">{order.createdAt} - {order.status}</p></div><strong className="text-brand-navy">{money.format(order.total || 0)}</strong></div>
      <div className="mt-3 grid gap-2">{(order.items || []).map((item) => <div key={item.cartKey || item.productId} className="flex justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm"><span>{item.name}{item.localName ? ` - ${item.localName}` : ''} x {item.quantity}</span><span>{money.format(item.price * item.quantity)}</span></div>)}</div>
      {order.delivery?.requested && <DeliverySummary delivery={order.delivery} />}
    </article>
  );
}

export default App;












































