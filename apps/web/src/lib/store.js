export const STORE_VERSION = 'ophra-v3';

export const defaultProducts = [];

const SEEDED_PRODUCT_IDS = new Set([
  'cement-50kg', 'bolts-general', 'rebar-12mm', 'blocks-6-inch', 'river-sand', 'treated-timber',
  'roofing-sheets', 'electrical-cable', 'plumbing-pipes', 'portland-cement', 'tmt-steel', 'concrete-blocks',
]);

function legacyKey(key) {
  return key.startsWith('ophra') ? 'shareDc' + key.slice('ophra'.length) : key;
}

export function readStore(key, fallback) {
  try {
    const value = localStorage.getItem(key) ?? localStorage.getItem(legacyKey(key));
    if (value === null) return fallback;
    const parsed = JSON.parse(value);
    if (localStorage.getItem(key) === null && localStorage.getItem(legacyKey(key)) !== null) writeStore(key, parsed);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeStore(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function ensureProducts() {
  const products = readStore('ophraProducts', []);
  if (!Array.isArray(products)) {
    writeStore('ophraProducts', []);
    localStorage.setItem('ophraStoreVersion', STORE_VERSION);
    return [];
  }

  if (localStorage.getItem('ophraStoreVersion') !== STORE_VERSION) {
    const realProducts = products.filter((product) => !SEEDED_PRODUCT_IDS.has(product.id));
    writeStore('ophraProducts', realProducts);
    localStorage.setItem('ophraStoreVersion', STORE_VERSION);
    return realProducts;
  }

  localStorage.setItem('ophraStoreVersion', STORE_VERSION);
  return products;
}

export function slug(value) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || `product-${Date.now()}`;
}

const numberFormat = new Intl.NumberFormat('en-TZ', { maximumFractionDigits: 0 });

export const money = {
  format(value) {
    return `TSh ${numberFormat.format(Number(value || 0))}`;
  },
};


