FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

FROM deps AS build
ENV VITE_API_URL=same-origin
COPY . .
RUN npm run build:web

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV OPHRA_SERVE_WEB=true
ENV OPHRA_WEB_DIST=/app/apps/web/dist
ENV OPHRA_DATA_FILE=/app/data/ophra-store.json
COPY package*.json ./
COPY apps/api apps/api
COPY packages/shared packages/shared
COPY scripts scripts
COPY --from=build /app/apps/web/dist apps/web/dist
RUN npm ci --omit=dev --ignore-scripts && mkdir -p /app/data
EXPOSE 8080
CMD ["node", "scripts/start-full.mjs"]
