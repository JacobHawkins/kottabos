import express from 'express';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createAppServer } from './app.js';

export async function createProductionServer(options = {}) {
  const publicRoot = fileURLToPath(new URL('../dist/', import.meta.url));
  await access(`${publicRoot}/index.html`).catch(() => { throw new Error('Build the browser assets first: npm run build'); });
  const server = await createAppServer(options);
  server.app.use((request, response, next) => {
    const pageOrigin = options.allowedOrigin || `http://${request.headers.host}`;
    const socketOrigin = new URL(pageOrigin).origin.replace(/^http/, 'ws');
    response.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ${socketOrigin}; frame-ancestors 'none'; base-uri 'none'; form-action 'self'` });
    next();
  });
  server.app.get('/', (request, response) => response.set('Cache-Control', 'no-cache').sendFile(`${publicRoot}/index.html`));
  server.app.use('/assets', express.static(`${publicRoot}/assets`, { immutable: true, maxAge: '1y', dotfiles: 'deny', index: false }));
  server.app.get('/robots.txt', (request, response) => response.type('text').send('User-agent: *\nDisallow: /\n'));
  server.app.use((request, response) => response.status(404).json({ error: 'Not found' }));
  server.app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    response.status(500).json({ error: 'Request unavailable' });
  });
  return server;
}
