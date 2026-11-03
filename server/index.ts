import { createApp } from './app.js';
import { createRuntime, runtimeConfig } from './runtime.js';
import { tickSchedules } from './schedules.js';
import type { Socket } from 'node:net';

const config = runtimeConfig();
const runtime = createRuntime(config);
const server = createApp(runtime.service, { port: config.port }).listen(config.port, '127.0.0.1', () => {
  process.stdout.write(`Bellhaven review is ready at http://localhost:${config.port}\n`);
});
const awaitingRequest = new Set<Socket>();
server.on('connection', socket => {
  awaitingRequest.add(socket);
  socket.once('close', () => awaitingRequest.delete(socket));
});
server.on('request', request => awaitingRequest.delete(request.socket));
const timer = setInterval(() => tickSchedules(runtime.service), 15_000);
timer.unref();
let closing = false;
function close(): void {
  if (closing) return;
  closing = true; clearInterval(timer);
  server.close(() => {
    void runtime.service.waitForRun().finally(() => { runtime.close(); process.exit(0); });
  });
  for (const socket of awaitingRequest) socket.destroy();
}
process.on('SIGINT', close); process.on('SIGTERM', close);
