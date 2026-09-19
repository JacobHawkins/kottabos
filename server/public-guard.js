import express from 'express';

// Shared limits suit a family behind one NAT (or Render proxy). Forwarded IP
// headers are untrusted; only the direct socket peer keys these small budgets.
export function createPublicGuard({ allowedOrigin = '', limits = {} } = {}) {
  const budgets = { create: 12, match: 240, lookup: 240, upgrade: 240, ...limits };
  const buckets = new Map();
  const parse = express.json({ limit: '4kb', strict: true });
  const origin = allowedOrigin ? new URL(allowedOrigin).origin : '';
  function allowed(request) {
    const supplied = request.headers.origin;
    if (!supplied) return true;
    return supplied === (origin || `http://${request.headers.host}`);
  }
  function consume(peer, category) {
    const now = Date.now();
    for (const [key, bucket] of buckets) if (now >= bucket.until) buckets.delete(key);
    const key = `${peer}:${category}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      if (buckets.size >= 2048) return false;
      bucket = { count: 0, until: now + 60_000 };
      buckets.set(key, bucket);
    }
    return ++bucket.count <= budgets[category];
  }
  const reject = (response, status, message) => {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
      ...(status === 429 ? { 'Retry-After': '60' } : {}) });
    response.end(JSON.stringify({ code: status, error: message }));
  };
  return {
    // Colyseus routes precede Express. Wrap the bound Node request listeners in
    // its listen callback, before accepting requests, to cover matchmaking too.
    install(httpServer) {
      const handlers = httpServer.listeners('request');
      httpServer.removeAllListeners('request');
      httpServer.on('request', (request, response) => {
        const path = request.url.split('?')[0];
        if (!allowed(request)) return reject(response, 403, 'Use the game invitation origin.');
        delete request.headers['x-forwarded-proto'];
        const category = path.startsWith('/matchmake/create/') ? 'create'
          : path.startsWith('/matchmake/') || path === '/api/leave' ? 'match'
            : path.startsWith('/api/parties/') ? 'lookup' : null;
        if (path.startsWith('/matchmake/')) {
          // Pinned Colyseus uses HTTP 522 for locked/unavailable rooms. Managed
          // proxies can replace that with a gateway HTML page. Keep its JSON
          // protocol code/message, but send standard HTTP Conflict instead.
          const writeHead = response.writeHead;
          response.writeHead = function (status, ...args) {
            return writeHead.call(this, status === 522 ? 409 : status, ...args);
          };
        }
        if (category && !consume(request.socket.remoteAddress, category)) return reject(response, 429, 'Too many requests. Wait a minute and try again.');
        if (path.startsWith('/matchmake/') && !/^\/matchmake\/(create\/party|joinById\/[A-Z]{6}|reconnect\/[A-Z]{6})$/.test(path)) return reject(response, 404, 'Unknown party request.');
        const dispatch = () => { for (const handler of handlers) handler.call(httpServer, request, response); };
        if (request.method !== 'POST') return dispatch();
        if (!String(request.headers['content-type']).startsWith('application/json')) return reject(response, 415, 'Use JSON.');
        parse(request, response, error => {
          if (error) return reject(response, error.type === 'entity.too.large' ? 413 : 400, 'Invalid request body.');
          dispatch();
        });
      });
    },
    verifyClient(info, done) {
      if (!allowed(info.req)) return done(false, 403, 'Origin rejected');
      if (!consume(info.req.socket.remoteAddress, 'upgrade')) return done(false, 429, 'Try again later');
      done(true);
    },
  };
}
