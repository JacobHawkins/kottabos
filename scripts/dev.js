import { createServer as createViteServer } from 'vite';
import { createAppServer } from '../server/app.js';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.PORT || 2567);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid local port.');
const server = await createAppServer({
  port,
  host: '127.0.0.1',
  reconnectionSeconds: Number(process.env.RECONNECT_SECONDS || 120),
  countdownMs: Number(process.env.COUNTDOWN_MS || 3000),
});
// One origin/port and no upgrade-handler competition with Colyseus. Refresh the
// page after client edits; restart npm start after server/shared rule edits.
const vite = await createViteServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false, ws: false, forwardConsole: false },
  appType: 'custom',
});
// Serve ordinary HTML/CSS without injecting Vite's hot-reload browser client.
// Vite 8.3 still injects that client in SPA mode even with hmr/ws disabled.
server.app.get('/', (request, response) => response.sendFile(fileURLToPath(new URL('../index.html', import.meta.url))));
server.app.use(vite.middlewares);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await vite.close();
  await server.close();
}
process.on('SIGINT', () => stop().then(() => process.exit(0)));
process.on('SIGTERM', () => stop().then(() => process.exit(0)));
try {
  await server.listen();
  console.info(`\nKottabos is ready: http://127.0.0.1:${port}\nOpen the same URL in Chrome and Edge. Press Ctrl+C to stop.\n`);
} catch (error) {
  console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use. Stop the other server or set PORT.` : error.message);
  await stop();
  process.exitCode = 1;
}
