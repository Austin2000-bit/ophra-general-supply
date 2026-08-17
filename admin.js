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

const productTable = document.querySelector("#productTable");
const productForm = document.querySelector("#productForm");
const adminRequests = document.querySelector("#adminRequests");
const requestTotal = document.querySelector("#requestTotal");

function slug(value) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || `product-${Date.now()}`;
}

function renderStats() {
  products = ensureProducts();
  document.querySelector("#statProducts").textContent = products.length;
  document.querySelector("#statStock").textContent = products.reduce((sum, item) => sum + Number(item.stock || 0), 0).toLocaleString();
  document.querySelector("#statSold").textContent = products.reduce((sum, item) => sum + Number(item.sold || 0), 0).toLocaleString();
  document.querySelector("#statRevenue").textContent = formatter.format(products.reduce((sum, item) => sum + Number(item.revenue || 0), 0));
}

function renderProducts() {
  products = ensureProducts();
  productTable.innerHTML = products.map((product) => `
    <tr>
      <td><strong>${product.name}</strong><br /><small>${product.unit}</small></td>
      <td>${product.category}</td>
      <td><input type="number" min="1" value="${product.price}" data-price="${product.id}" /></td>
      <td><input type="number" min="0" value="${product.stock}" data-stock="${product.id}" /></td>
      <td>${Number(product.sold || 0).toLocaleString()}</td>
      <td>${formatter.format(Number(product.revenue || 0))}</td>
      <td><button class="save-button" type="button" data-save="${product.id}">Save</button></td>
    </tr>
  `).join("");

  document.querySelectorAll("[data-save]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.save;
      const product = products.find((item) => item.id === id);
      product.price = Number(document.querySelector(`[data-price="${id}"]`).value) || product.price;
      product.stock = Math.max(0, Number(document.querySelector(`[data-stock="${id}"]`).value) || 0);
      writeStore("ophraProducts", products);
      renderStats();
      renderProducts();
    });
  });
}

function renderRequests() {
  const requests = readStore("ophraCustomRequests", []);
  requestTotal.textContent = `${requests.length} request${requests.length === 1 ? "" : "s"}`;
  adminRequests.innerHTML = requests.length
    ? requests.map((request) => `
      <article class="admin-request-card">
        <strong>${request.name}</strong>
        <p>${request.description}</p>
        <span>${request.quantity || 1} requested · ${request.location || "Location not provided"}</span>
        <div class="contact-row">
          ${request.email ? `<a href="mailto:${request.email}">${request.email}</a>` : ""}
          ${request.phone ? `<a href="tel:${request.phone}">${request.phone}</a>` : ""}
        </div>
      </article>
    `).join("")
    : `<article class="admin-request-card"><strong>No requests yet</strong><p>Client custom requests will appear here after submission.</p></article>`;
}

function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadInventory() {
  products = ensureProducts();
  downloadCsv("ophra-inventory.csv", [
    ["Product", "Category", "Price", "Stock left", "Unit", "Sold", "Sales value"],
    ...products.map((item) => [item.name, item.category, item.price, item.stock, item.unit, item.sold || 0, item.revenue || 0]),
  ]);
}

function downloadSales() {
  const orders = readStore("ophraOrders", []);
  downloadCsv("ophra-sales.csv", [
    ["Order ID", "Date", "Product", "Quantity", "Unit price", "Line total"],
    ...orders.flatMap((order) => order.items.map((item) => [order.id, order.createdAt, item.name, item.quantity, item.price, item.quantity * item.price])),
  ]);
}

function downloadRequests() {
  const requests = readStore("ophraCustomRequests", []);
  downloadCsv("ophra-custom-requests.csv", [
    ["Request ID", "Date", "Product", "Description", "Quantity", "Location", "Email", "Phone", "Image"],
    ...requests.map((item) => [item.id, item.createdAt, item.name, item.description, item.quantity, item.location, item.email, item.phone, item.image]),
  ]);
}

productForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const product = {
    id: slug(document.querySelector("#productName").value),
    name: document.querySelector("#productName").value.trim(),
    category: document.querySelector("#productCategory").value.trim(),
    unit: document.querySelector("#productUnit").value.trim(),
    price: Number(document.querySelector("#productPrice").value) || 1,
    stock: Math.max(0, Number(document.querySelector("#productStock").value) || 0),
    sold: 0,
    revenue: 0,
    image: document.querySelector("#productImage").value.trim() || "",
    description: document.querySelector("#productDescription").value.trim(),
    tag: "New",
  };
  products = [product, ...ensureProducts().filter((item) => item.id !== product.id)];
  writeStore("ophraProducts", products);
  productForm.reset();
  renderStats();
  renderProducts();
});

document.querySelector("#downloadInventory").addEventListener("click", downloadInventory);
document.querySelector("#downloadSales").addEventListener("click", downloadSales);
document.querySelector("#downloadRequests").addEventListener("click", downloadRequests);

renderStats();
renderProducts();
renderRequests();
