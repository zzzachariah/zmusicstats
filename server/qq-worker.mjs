import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { once } from 'node:events';

// No package code is copied or modified. Use the package's exported Koa application.
process.env.NODE_ENV = 'test';
const requireGateway = createRequire(new URL('../work/qq-gateway/package.json', import.meta.url));
const port = Number(process.env.PORT || 3201);
const allowedPaths = new Set([
  '/login/channels', '/login/qr/key', '/login/qr/create', '/login/qr/check', '/login/qr/cancel',
  '/login/status', '/login/refresh', '/logout', '/user/listening-rank', '/user/listening-report', '/song/genre',
]);
let server;

try {
  const { default: app, server: upstreamServer } = requireGateway('@yakult-green-tea/qq-music-api');
  if (upstreamServer) {
    upstreamServer.close();
    throw new Error('Unexpected upstream listener');
  }
  const callback = app.callback();
  server = createServer((req, res) => {
    const expectedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    const host = req.headers.host;
    const origin = req.headers.origin;
    if (!expectedHosts.includes(host) || (origin && !expectedHosts.some(value => origin === `http://${value}`))) {
      res.writeHead(403, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ code: 403, message: 'Local gateway access only' }));
      return;
    }
    const path = new URL(req.url || '/', `http://127.0.0.1:${port}`).pathname;
    if (path === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true, service: 'zmusicstats-qq-local', version: '3.3.8', host: '127.0.0.1' }));
      return;
    }
    if (!allowedPaths.has(path)) {
      res.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ code: 404, message: 'Route is not part of the local report gateway' }));
      return;
    }
    callback(req, res);
  });
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  process.send?.({ type: 'ready' });
} catch {
  process.send?.({ type: 'startup-error' });
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 50);
}

function stop() {
  if (server) server.close(() => process.exit(0));
  else process.exit(0);
  // MQTT clients must not keep the child alive after the parent stops.
  setTimeout(() => process.exit(0), 1500).unref();
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
process.once('disconnect', stop);
