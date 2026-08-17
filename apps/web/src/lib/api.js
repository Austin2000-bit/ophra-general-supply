const rawApiUrl = import.meta.env.VITE_API_URL || '';
const API_BASE = rawApiUrl === 'same-origin' ? '' : rawApiUrl.replace(/\/$/, '');

const paths = {
  products: '/products',
  productGroups: '/product-groups',
  orders: '/orders',
  customRequests: '/custom-requests',
  quotations: '/quotations',
  customers: '/customers',
};

export const hasApi = Boolean(rawApiUrl);

async function request(path, options = {}) {
  if (!rawApiUrl) throw new Error('API is not configured');
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(body?.error || body?.reason || 'API request failed');
  return body;
}


export async function adminLogin(password) {
  return request('/admin/login', { method: 'POST', body: JSON.stringify({ password }) });
}

export async function adminLogout() {
  return request('/admin/logout', { method: 'POST', body: JSON.stringify({}) });
}

export async function adminSession() {
  return request('/admin/session');
}

export async function getCollection(collection) {
  const body = await request(paths[collection]);
  return Array.isArray(body?.[collection]) ? body[collection] : [];
}

export async function replaceCollection(collection, records) {
  const body = await request(paths[collection], {
    method: 'PUT',
    body: JSON.stringify({ [collection]: records }),
  });
  return Array.isArray(body?.[collection]) ? body[collection] : records;
}

export async function createRecord(collection, record) {
  const body = await request(paths[collection], {
    method: 'POST',
    body: JSON.stringify(record),
  });
  return body?.[singular(collection)] || body?.[collection] || record;
}

export async function updateRecord(collection, id, patch) {
  const body = await request(`${paths[collection]}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return body?.[singular(collection)] || patch;
}

export async function deleteRecord(collection, id) {
  return request(`${paths[collection]}/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function getSettings() {
  return request('/settings');
}

export async function saveSettings(settings) {
  return request('/settings', { method: 'PUT', body: JSON.stringify(settings) });
}

export async function getStore() {
  return request('/store');
}

function singular(collection) {
  if (collection === 'customRequests') return 'customRequest';
  if (collection === 'quotations') return 'quotation';
  return collection.endsWith('s') ? collection.slice(0, -1) : collection;
}

