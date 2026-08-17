const formatter = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  maximumFractionDigits: 0,
});

const defaultProducts = [];

function legacyKey(key) {
  return key.startsWith("ophra") ? "shareDc" + key.slice("ophra".length) : key;
}

function readStore(key, fallback) {
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

function writeStore(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function ensureProducts() {
  const existing = readStore("ophraProducts", []);
  return Array.isArray(existing) ? existing : [];
}

let products = ensureProducts();

const state = {
  category: "All",
  search: "",
  cart: [],
  requests: readStore("ophraCustomRequests", []),
};

const productGrid = document.querySelector("#productGrid");
const resultCount = document.querySelector("#resultCount");
const searchInput = document.querySelector("#searchInput");
const searchForm = document.querySelector("#searchForm");
const categoryFilter = document.querySelector("#categoryFilter");
const cartDrawer = document.querySelector("#cartDrawer");
const overlay = document.querySelector("#overlay");
const cartTrigger = document.querySelector("#cartTrigger");
const closeCart = document.querySelector("#closeCart");
const cartCount = document.querySelector("#cartCount");
const cartItems = document.querySelector("#cartItems");
const cartTotal = document.querySelector("#cartTotal");
const customForm = document.querySelector("#customForm");

function visibleProducts() {
  return products.filter((product) => {
    const query = state.search.toLowerCase();
    const matchesSearch = [product.name, product.category, product.description].some((value) =>
      value.toLowerCase().includes(query),
    );
    const matchesCategory = state.category === "All" || product.category === state.category;
    return matchesSearch && matchesCategory;
  });
}

function renderProducts() {
  products = ensureProducts();
  const productsToShow = visibleProducts();
  resultCount.textContent = `${productsToShow.length} product${productsToShow.length === 1 ? "" : "s"}`;
  productGrid.innerHTML = productsToShow
    .map(
      (product) => `
      <article class="product-card">
        <img src="${product.image}" alt="${product.name}" />
        <div class="product-body">
          <span class="tag ${product.tag.toLowerCase().includes("deal") || product.tag.toLowerCase().includes("delivery") ? "deal" : ""}">${product.tag}</span>
          <h3>${product.name}</h3>
          <p>${product.description}</p>
          <div class="price"><strong>${formatter.format(product.price)}</strong><span>/ ${product.unit}</span></div>
          <div class="meta">${product.stock.toLocaleString()} ${product.unit}s available</div>
          <button class="add-button" type="button" data-product="${product.id}" ${product.stock <= 0 ? "disabled" : ""}>${product.stock <= 0 ? "Out of stock" : "Add to cart"}</button>
        </div>
      </article>
    `,
    )
    .join("");

  document.querySelectorAll("[data-product]").forEach((button) => {
    button.addEventListener("click", () => addToCart(button.dataset.product));
  });
}

function addToCart(productId) {
  const product = products.find((item) => item.id === productId);
  if (!product || product.stock <= 0) return;
  const existing = state.cart.find((item) => item.productId === productId);
  if (existing) existing.quantity += 1;
  else state.cart.push({ productId, name: product.name, price: product.price, unit: product.unit, quantity: 1 });
  renderCart();
  openCart();
}

function completeCheckout() {
  if (!state.cart.length) return;
  products = ensureProducts();
  const shortage = state.cart.find((item) => {
    const product = products.find((entry) => entry.id === item.productId);
    return !product || product.stock < item.quantity;
  });

  if (shortage) {
    document.querySelector(".cart-note span").textContent = `${shortage.name} does not have enough stock left.`;
    return;
  }

  const order = {
    id: `order-${Date.now()}`,
    createdAt: new Date().toISOString(),
    items: structuredClone(state.cart),
    total: state.cart.reduce((sum, item) => sum + item.price * item.quantity, 0),
  };

  products = products.map((product) => {
    const cartItem = state.cart.find((item) => item.productId === product.id);
    if (!cartItem) return product;
    return {
      ...product,
      stock: product.stock - cartItem.quantity,
      sold: (product.sold || 0) + cartItem.quantity,
      revenue: (product.revenue || 0) + cartItem.quantity * cartItem.price,
    };
  });

  const orders = readStore("ophraOrders", []);
  orders.unshift(order);
  writeStore("ophraOrders", orders);
  writeStore("ophraProducts", products);
  state.cart = [];
  document.querySelector(".cart-note span").textContent = "Order recorded. Inventory and sales totals updated.";
  renderCart();
  renderProducts();
}

function renderCart() {
  cartCount.textContent = state.cart.length;
  cartTrigger.hidden = state.cart.length === 0;
  cartItems.innerHTML = state.cart.length
    ? state.cart
        .map(
          (item, index) => `
      <div>
        <span>${item.name}<br /><small>${item.quantity} ${item.unit}${item.quantity === 1 ? "" : "s"}</small></span>
        <strong>${formatter.format(item.price * item.quantity)}</strong>
        <button type="button" data-remove="${index}">Remove</button>
      </div>
    `,
        )
        .join("")
    : `<div><span>Your cart is empty.</span><strong>${formatter.format(0)}</strong></div>`;

  cartTotal.textContent = formatter.format(state.cart.reduce((sum, item) => sum + item.price * item.quantity, 0));
  document.querySelectorAll("[data-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      state.cart.splice(Number(button.dataset.remove), 1);
      renderCart();
    });
  });
}

function openCart() {
  cartDrawer.classList.add("open");
  overlay.classList.add("open");
}

function closeCartDrawer() {
  cartDrawer.classList.remove("open");
  overlay.classList.remove("open");
}

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  state.search = searchInput.value.trim();
  renderProducts();
});

searchInput.addEventListener("input", () => {
  state.search = searchInput.value.trim();
  renderProducts();
});

categoryFilter.addEventListener("change", () => {
  state.category = categoryFilter.value;
  renderProducts();
});

cartTrigger.addEventListener("click", openCart);
closeCart.addEventListener("click", closeCartDrawer);
overlay.addEventListener("click", closeCartDrawer);
document.querySelector("#completeCheckout")?.addEventListener("click", completeCheckout);

customForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const request = {
    id: `request-${Date.now()}`,
    createdAt: new Date().toISOString(),
    name: document.querySelector("#customName").value.trim(),
    description: document.querySelector("#customDescription").value.trim(),
    quantity: Number(document.querySelector("#customQuantity").value) || 1,
    location: document.querySelector("#customLocation").value.trim(),
    email: document.querySelector("#customEmail").value.trim(),
    phone: document.querySelector("#customPhone").value.trim(),
    image: document.querySelector("#customImage").value.trim(),
    status: "new",
  };
  state.requests.unshift(request);
  writeStore("ophraCustomRequests", state.requests);
  customForm.reset();
  document.querySelector("#customQuantity").value = 1;
});

renderProducts();
renderCart();
