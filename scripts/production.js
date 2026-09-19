import { createProductionServer } from '../server/production.js';

const port = Number(process.env.PORT || 2567);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
const allowedOrigin = process.env.PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL || '';
if (process.env.RENDER && !allowedOrigin) throw new Error('Render public origin is required.');
const server = await createProductionServer({
  port, host: process.env.HOST || '0.0.0.0', allowedOrigin,
  maxRooms: Number(process.env.MAX_ROOMS || 4),
  reconnectionSeconds: Number(process.env.RECONNECT_SECONDS || 120),
  countdownMs: Number(process.env.COUNTDOWN_MS || 3000),
  roundDurationMs: Number(process.env.ROUND_DURATION_MS || 45000),
});
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(1), 10_000);
  deadline.unref();
  await server.close();
  clearTimeout(deadline);
}
process.on('SIGINT', () => stop().then(() => process.exit(0)));
process.on('SIGTERM', () => stop().then(() => process.exit(0)));
try {
  await server.listen();
  console.info(`Kottabos production server listening on port ${port}. Parties live only in this process.`);
} catch (error) {
  console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use.` : 'Production server could not start. Check configuration.');
  await stop();
  process.exitCode = 1;
}
