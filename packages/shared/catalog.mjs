export const products = [];

export function getPriceRange(product, quantity) {
  if (!product) return { min: 0, max: 0, label: 'unavailable' };
  const price = Number(product.price || 0);
  if (quantity >= 300) return { min: Math.round(price * 0.86), max: Math.round(price * 1.03), label: 'large project' };
  if (quantity >= 80) return { min: Math.round(price * 0.9), max: Math.round(price * 1.06), label: 'house build' };
  return { min: Math.round(price * 0.96), max: Math.round(price * 1.12), label: 'small repair' };
}

export function validateOffer({ productId, quantity, offer }, catalog = products) {
  const product = catalog.find((item) => item.id === productId);
  if (!product) return { accepted: false, reason: 'Product not found' };
  const requestedQuantity = Math.max(1, Number(quantity) || 1);
  const offeredPrice = Math.max(0, Number(offer) || 0);
  const range = getPriceRange(product, requestedQuantity);
  if (requestedQuantity > Number(product.stock || 0)) return { accepted: false, reason: 'Insufficient stock', product, range };
  if (offeredPrice < range.min || offeredPrice > range.max) return { accepted: false, reason: 'Offer outside accepted price range', product, range };
  return { accepted: true, reason: 'Offer accepted', product, range, total: requestedQuantity * offeredPrice };
}
