# OPHRA Developer Guide

This is the technical handover guide for OPHRA GENERAL SUPPLY.

## Overview

OPHRA is a general supply storefront and admin system. It supports hardware tools and food products now, and can be extended to more departments later.

Main capabilities:

- Public storefront with clickable product families and product varieties.
- Customer account login/signup.
- Cart, direct orders, quotations, proforma invoices, VAT, delivery fees, and expected delivery time.
- Admin product and product-family management.
- Cloudinary image uploads with only image URLs stored in the database.
- Neon Postgres storage through the Node API.
- Admin dashboard monitoring.
- Reports with filters and CSV/PDF downloads.
- Backend-protected admin API routes.

## Repository Layout

```text
apps/
  api/
    server.mjs          Node HTTP API, Neon/file storage, admin session security
  web/
    src/
      App.jsx           Main React app: storefront, account, admin, reports
      index.css         Tailwind/app styling
      main.jsx          React entry point
      lib/
        api.js          Frontend API wrapper
        store.js        Browser localStorage fallback helpers
packages/
  shared/
    catalog.mjs         Shared quotation/catalog validation rules
docs/
  deployment.md         Hosting and environment guide
```

The active app is under `apps/web` and `apps/api`. Older root-level files such as `admin.html`, `admin.js`, `app.js`, `index.html`, and `styles.css` are legacy artifacts.

## Runtime Modes

### API Mode

When `VITE_API_URL` is set, the frontend talks to the Node API.

The API stores data in:

- Neon Postgres when `DATABASE_URL` or `NEON_DATABASE_URL` is set.
- Local JSON file when no database URL is set.

Neon uses one JSONB store row:

```sql
CREATE TABLE IF NOT EXISTS ophra_store (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

The active row id is `main`.

### Local Demo Mode

When `VITE_API_URL` is empty, the frontend falls back to browser `localStorage`. This is useful for demos only, not production.

Important local keys:

```text
ophraProducts
ophraProductGroups
ophraOrdersAdmin
ophraQuotations
ophraCustomRequests
ophraCustomers
ophraCart
ophraCustomerSession
ophraAdminSession
ophraTransportSettings
ophraSupplierProfile
```

## Data Model

### Products

Products are sellable items.

Important fields:

```text
id, name, localName, department, category, groupId, unit, price, stock,
image, description, tag, examples, grades, sizes, createdAt, createdAtIso
```

Price is optional. Empty/zero price appears as `Call for price`.

Images must be normal URLs. The API strips `data:` and `blob:` image values.

### Product Families

Product families are clickable catalog groups. They support hierarchy.

```text
Hardware Tools
  Cement
    Twiga Cement
    Dangote Cement
  Bolts
    Hex Bolts
Food Products
  Rice
  Cooking Oil
```

Important fields:

```text
id, name, department, parentId, image, description, sortOrder
```

For normal hardware and food products, use generic family names like `Rice`, `Paint`, `Hammer`, or `Cooking Oil`. For bolts/screws, nested families are useful.

### Orders

Orders are created from the storefront cart.

Important fields:

```text
id, receiptNo, customerId, customerEmail, customer, status, paymentStatus,
items, createdAt, createdAtIso, itemsTotal, delivery, deliveryFee, total
```

Security note: the API recalculates direct order totals from server-side product prices and reduces stock on the server. Browser-submitted totals are not trusted.

### Quotations

High-value requests become quotations. Approved quotations can print proforma invoices.

Important fields:

```text
id, status, createdAt, createdAtIso, approvedAt, supplier, customer,
delivery, deliveryFee, expectedDeliveryTime, items, subtotal, vatRate,
vatTotal, totalWithVat, bankAccount
```

### Customers

Customer account fields:

```text
id, name, email, passwordHash, passwordSalt, createdAt, createdAtIso
```

### Transport Settings

```text
enabled, officeName, officeAddress, officeLat, officeLng,
baseFee, pricePerKm, minimumFee, expectedDeliveryTime
```

## Frontend Routes

```text
/          Storefront
/shop/...  Storefront filtered/detail URLs
/account   Customer account page
/admin     Admin login and admin panel
```

## Admin Areas

Admin navigation:

- ADMIN DASHBOARD
- REPORTS
- PRODUCTS
- PRODUCT FAMILIES
- CUSTOM ORDERS
- QUOTATIONS
- TRANSPORT
- ORDERS

Dashboard monitors stock, sales/orders, quotations, customers, product quality, and delivery.

Reports include Sales, Customers, Quotations, Stock, and Delivery. Filters include All Time, Daily, Quarterly, Annual, Custom dates, customer search, product search, status search, and department. Reports download as CSV and PDF.

## API Security

Backend admin auth uses:

```env
ADMIN_PASSWORD_SALT=
ADMIN_PASSWORD_HASH=
ADMIN_SESSION_SECRET=
ADMIN_SESSION_TTL_MS=28800000
OPHRA_MAX_JSON_BYTES=5242880
```

Frontend admin gate uses:

```env
VITE_ADMIN_PASSWORD_SALT=
VITE_ADMIN_PASSWORD_HASH=
```

When `VITE_API_URL` is set, the admin login also calls `/admin/login`. The backend creates an HttpOnly admin session cookie. Admin API routes require that cookie.

Protected API actions include:

- Full store reads/writes.
- Product/product-family create, edit, delete, and full replacement.
- Order, quotation, custom request, and customer list reads.
- Quotation/custom request status updates.
- Settings updates.
- Deletes.

Public API actions include:

- Product and product-family browsing.
- Public settings needed by the storefront.
- Creating orders, quotations, custom requests, and customer records.

## API Endpoints

```text
GET  /health
POST /admin/login
POST /admin/logout
GET  /admin/session
GET  /store                 admin only
PUT  /store                 admin only
GET  /settings              public limited, full for admin
PUT  /settings              admin only
GET  /products              public
PUT  /products              admin only
POST /products              admin only
PATCH /products/:id         admin only
DELETE /products/:id        admin only
GET  /product-groups        public
PUT  /product-groups        admin only
POST /product-groups        admin only
PATCH /product-groups/:id   admin only
DELETE /product-groups/:id  admin only
GET  /orders                admin only
POST /orders                public, server recalculates totals
GET  /custom-requests       admin only
POST /custom-requests       public
PATCH /custom-requests/:id  admin only
GET  /quotations            admin only
POST /quotations            public
PATCH /quotations/:id       admin only
GET  /customers             admin only
POST /customers             public
```

## Image Uploads

Cloudinary flow:

```text
Admin selects image
Frontend uploads to Cloudinary
Cloudinary returns secure_url
OPHRA stores only secure_url
```

Frontend variables:

```env
VITE_CLOUDINARY_CLOUD_NAME=
VITE_CLOUDINARY_UPLOAD_PRESET=
VITE_CLOUDINARY_UPLOAD_FOLDER=ophra-products
```

Do not store image files, base64 images, `data:` URLs, or `blob:` URLs in Neon.

## Common Commands

```bash
npm install
npm run dev:api
npm run dev:web
npm run build:web
npm run start:api
npm run hash:admin
```

## Common Changes

Add a department: update `DEPARTMENTS` in `apps/web/src/App.jsx`, then check storefront filters, admin forms, reports, and any seeded/demo data.

Change low-stock limit: update `LOW_STOCK_LIMIT` in `apps/web/src/App.jsx`.

Add a report: update `AdminReports` and `buildReportRows` in `apps/web/src/App.jsx`.

## Payment Security Notes

Before integrating AzamPay, Azam Lipa Link, or another provider:

- Never trust browser-submitted totals or payment status.
- Create payment requests from server-calculated order totals.
- Keep payment API keys only in backend environment variables.
- Mark an order as paid only after provider-side verification, signed callback, or webhook confirmation.
- Store provider transaction references on the order.
- Use HTTPS in production.
- Validate callback signatures exactly as required by the payment provider.

## Future Improvements

- Move customer authentication server-side.
- Add role-based admin users.
- Add stock movement history.
- Add admin order status/payment status controls.
- Add server-side report generation for very large datasets.
- Add automated tests for product normalization, reports, and quotation totals.
- Split `App.jsx` into smaller modules as the app grows.
