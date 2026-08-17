# OPHRA GENERAL SUPPLY

OPHRA is a React storefront and admin system with a Node API backend. It can run locally with browser-only fallback data, or connect to a hosted API by setting one frontend environment variable.

## Documentation

Start here when handing the project to another developer:

- `docs/developer-guide.md`: architecture, data model, admin features, reports, API endpoints, and maintenance notes.
- `docs/deployment.md`: hosting options, required environment variables, Neon, Cloudinary, and AWS deployment notes.
- `.env.example`: complete list of backend and frontend environment variables.

## Project layout

- `apps/web`: React + Vite + Tailwind storefront, customer account page, and admin panel.
- `apps/api`: Node HTTP API for products, orders, custom requests, quotations, customers, and settings.
- `packages/shared`: Shared quotation/catalog rules.
- `Dockerfile`: Optional one-container deployment that serves both the API and the built frontend.

## Local development

Install dependencies:

```bash
npm install
```

Run the backend:

```bash
npm run dev:api
```

Run the frontend in another terminal:

```bash
npm run dev:web
```

Frontend pages:

```text
http://localhost:5173/
http://localhost:5173/admin
http://localhost:5173/account
```

If port `5173` is already busy, Vite may use a nearby port such as `5174`.

To connect the frontend to the local backend, copy `apps/web/.env.example` to `apps/web/.env` and keep:

```text
VITE_API_URL=http://localhost:8080
```

If `VITE_API_URL` is not set, the frontend still works with local browser storage for demos.

## Production modes

### Split services

Use this when the frontend is on Vercel, AWS Amplify, Netlify, or S3 + CloudFront, and the API is on AWS App Runner, ECS, Elastic Beanstalk, Render, Railway, or a VPS.

Frontend build command:

```bash
npm run build:web
```

Frontend output directory:

```text
apps/web/dist
```

Backend start command:

```bash
npm run start:api
```

Set frontend env:

```text
VITE_API_URL=https://your-api-domain.example
```

For one-domain deployments where the backend serves the built frontend, set `VITE_API_URL=same-origin` at build time.

Set backend env as needed:

```text
DATABASE_URL=postgresql://...
PORT=8080
CORS_ORIGIN=https://your-frontend-domain.example
OPHRA_DATA_FILE=/data/ophra-store.json
```

### One container

Use this for AWS App Runner, ECS/Fargate, Elastic Beanstalk Docker, Fly.io, Render Docker, or a VPS.

```bash
docker build -t ophra .
docker run -p 8080:8080 -v ophra-data:/app/data ophra
```

The API health check will be available at:

```text
/health
```

The same container serves the built frontend when `OPHRA_SERVE_WEB=true`.

## Cloudinary image uploads

Create an unsigned upload preset in Cloudinary, then set these frontend variables in `apps/web/.env` and in your hosting provider:

```env
VITE_CLOUDINARY_CLOUD_NAME=your_cloud_name
VITE_CLOUDINARY_UPLOAD_PRESET=your_unsigned_upload_preset
VITE_CLOUDINARY_UPLOAD_FOLDER=ophra-products
```

Admin uploads go to Cloudinary first. OPHRA stores only the returned image URL in the database.

## Neon database

Create a Neon Postgres project and copy the pooled connection string. Set it as `DATABASE_URL` for the API:

```env
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
```

When `DATABASE_URL` is set, the API stores OPHRA data in Neon. When it is not set, it falls back to the local JSON file for demos.

Current Neon storage uses one JSONB record in the `ophra_store` table. See `docs/developer-guide.md` for the full data model.

## Admin login

Generate a salted admin password hash:

```bash
npm run hash:admin
```

Add the printed `VITE_*` values to `apps/web/.env` and to your frontend hosting environment:

```env
VITE_ADMIN_PASSWORD_SALT=printed_salt
VITE_ADMIN_PASSWORD_HASH=printed_hash
```

Add the printed backend values to the API hosting environment too:

```env
ADMIN_PASSWORD_SALT=printed_salt
ADMIN_PASSWORD_HASH=printed_hash
ADMIN_SESSION_SECRET=printed_secret
```

After changing these values, restart the dev server or rebuild the frontend. The `/admin` page shows only the admin login screen until the correct password is entered. When the API is configured, admin API writes also require the backend admin session cookie.

## Important safety notes

- Never commit `.env` files. They contain Neon, Cloudinary, and admin secrets.
- Store product images in Cloudinary and save only the returned URL in the database.
- Keep the GitHub repository private unless the client approves making it public.
- For production, set environment variables in the hosting provider rather than in source control.
- Set `CORS_ORIGIN` to the real frontend domain, not `*`.
- Treat browser-submitted payment totals as untrusted; payment confirmation must come from the payment provider/server side.
