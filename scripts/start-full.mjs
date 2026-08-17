process.env.OPHRA_SERVE_WEB = process.env.OPHRA_SERVE_WEB || 'true';
await import('../apps/api/server.mjs');
