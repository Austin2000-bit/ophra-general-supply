# Deployment Guide

OPHRA is provider-neutral. It can run as split frontend/backend services or as one Node container that serves both the API and the built frontend.

## Services

- `apps/web`: Static React frontend.
- `apps/api`: Node backend API.
- Neon Postgres: Recommended database.
- Cloudinary: Product image hosting.

## Required Environment

Frontend:

```env
VITE_API_URL=https://your-api-host
VITE_OPHRA_PHONE=+255XXXXXXXXX
VITE_CLOUDINARY_CLOUD_NAME=your_cloud_name
VITE_CLOUDINARY_UPLOAD_PRESET=your_unsigned_upload_preset
VITE_CLOUDINARY_UPLOAD_FOLDER=ophra-products
VITE_ADMIN_PASSWORD_SALT=generated_salt
VITE_ADMIN_PASSWORD_HASH=generated_hash
VITE_ADMIN_INACTIVITY_TIMEOUT_MS=900000
VITE_ADMIN_HARD_SESSION_MS=28800000
VITE_CUSTOMER_INACTIVITY_TIMEOUT_MS=1800000
VITE_CUSTOMER_HARD_SESSION_MS=86400000
```

For one-domain/container deployments:

```env
VITE_API_URL=same-origin
```

Backend:

```env
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
PORT=8080
CORS_ORIGIN=https://your-frontend-host
OPHRA_DATA_FILE=/data/ophra-store.json
ADMIN_PASSWORD_SALT=generated_salt
ADMIN_PASSWORD_HASH=generated_hash
ADMIN_SESSION_SECRET=generated_secret
ADMIN_SESSION_TTL_MS=28800000
ADMIN_SESSION_INACTIVITY_MS=900000
OPHRA_MAX_JSON_BYTES=5242880
```

Optional single-container mode:

```env
OPHRA_SERVE_WEB=true
OPHRA_WEB_DIST=/app/apps/web/dist
```

`OPHRA_DATA_FILE` is only used when `DATABASE_URL` is missing. Production should use Neon or another managed Postgres database.

## Neon Database

The API automatically creates:

```sql
CREATE TABLE IF NOT EXISTS ophra_store (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

The active app data is stored in row id `main`.

## Cloudinary

Create an unsigned image upload preset and restrict it to image files. The frontend uploads files directly to Cloudinary and saves only the returned `secure_url`.

Recommended folder:

```text
ophra-products
```

## AWS Options

### AWS Amplify + App Runner

Frontend:

- Build command: `npm run build:web`
- Output directory: `apps/web/dist`
- Set all `VITE_*` variables in Amplify.

Backend:

- Start command: `npm run start:api`
- Set backend variables including `DATABASE_URL`, `CORS_ORIGIN`, and backend admin auth variables.
- Set `CORS_ORIGIN` to the Amplify frontend URL.

### S3 + CloudFront + ECS/Fargate

- Build frontend with `npm run build:web`.
- Upload `apps/web/dist` to S3 behind CloudFront.
- Run API as a Node service or container on ECS/Fargate.
- Store backend secrets in AWS Systems Manager Parameter Store or Secrets Manager.

### Single Container

```bash
docker build -t ophra .
docker run -p 8080:8080 --env-file .env ophra
```

Set:

```env
OPHRA_SERVE_WEB=true
VITE_API_URL=same-origin
```

Health check:

```text
/health
```

## Build And Start Commands

```bash
npm install
npm run dev:api
npm run dev:web
npm run build:web
npm run start:api
npm run hash:admin
```

## Production Checklist

- Keep GitHub repository private.
- Confirm `.env` is not committed.
- Set `DATABASE_URL` on the backend host.
- Set `VITE_API_URL` on the frontend host.
- Set Cloudinary variables on the frontend host.
- Set frontend admin password salt/hash.
- Set backend `ADMIN_PASSWORD_SALT`, `ADMIN_PASSWORD_HASH`, and `ADMIN_SESSION_SECRET`.
- Set OPHRA phone number with `VITE_OPHRA_PHONE`.
- Set `CORS_ORIGIN` to the exact frontend domain, not `*`.
- Use HTTPS in production.
- Test `/health`.
- Test admin login.
- Upload a product image and confirm only a URL is stored.
- Create a test order and quotation.
- Download reports as CSV and PDF.

## Backup Notes

Neon can be backed up from the dashboard or with `pg_dump`. Cloudinary images are separate assets and should be backed up or transferred through Cloudinary tools if the client later moves accounts.

## Payment Security Notes

Before integrating AzamPay, Azam Lipa Link, or any other payment provider:

- Never trust payment status or totals submitted by the browser.
- Create payment requests from server-calculated order totals.
- Mark an order as paid only after provider verification or signed callback/webhook confirmation.
- Store provider transaction references on the order record.
- Keep payment API keys in backend environment variables only.
- Use HTTPS only in production.
