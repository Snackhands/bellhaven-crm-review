import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { Agent, createServer, get } from 'node:http';
import { connect, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('SIGTERM releases the database with idle browser connections still open', { timeout: 10_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bellhaven-shutdown-'));
  const statePath = join(directory, 'state.sqlite');
  const reservation = createServer().listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const address = reservation.address(); assert.ok(address && typeof address !== 'string');
  await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    env: { ...process.env, PORT: String(address.port), STATE_DB: statePath, CAPTURE_DIR: join(directory, 'empty-capture'), CRM_TOKEN: '', LIVE_WRITES_ENABLED: 'false', CRM_API_BASE: 'https://synthetic.invalid/api', WEBSITE_URL: 'https://synthetic.invalid' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const agent = new Agent({ keepAlive: true });
  const sockets: Socket[] = [];
  let timer: NodeJS.Timeout | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Local server startup timed out.')), 3000);
      child.once('error', reject);
      child.once('exit', () => { clearTimeout(timeout); reject(new Error('Local server exited before startup.')); });
      child.stdout.on('data', (chunk: Buffer) => { if (chunk.toString().includes('Bellhaven review is ready')) { clearTimeout(timeout); resolve(); } });
    });
    for (const partialRequest of [false, true]) {
      const socket = connect(address.port, '127.0.0.1');
      socket.on('error', () => {});
      sockets.push(socket); await once(socket, 'connect');
      if (partialRequest) socket.write('GET / HTTP/1.1\r\n');
    }
    await new Promise<void>((resolve, reject) => {
      const request = get({ hostname: '127.0.0.1', port: address.port, path: '/api/health', agent }, response => {
        assert.equal(response.statusCode, 200); response.resume(); response.once('end', resolve);
      });
      request.once('error', reject);
    });
    const exit = once(child, 'exit');
    child.kill('SIGTERM');
    const result = await Promise.race([
      exit,
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Shutdown stalled on idle browser connections.')), 2000); }),
    ]);
    assert.equal(result[0], 0); assert.equal(result[1], null);
    assert.equal(existsSync(`${statePath}.lock`), false);
  } finally {
    if (timer) clearTimeout(timer);
    for (const socket of sockets) socket.destroy();
    agent.destroy();
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await once(child, 'exit'); }
    rmSync(directory, { recursive: true });
  }
});
