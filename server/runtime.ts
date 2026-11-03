import 'dotenv/config';
import { mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync, closeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Store } from './store.js';
import { ReviewService } from './service.js';

export function runtimeConfig() {
  const port = Number(process.env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be an integer from 1024 to 65535.');
  const apiBase = process.env.CRM_API_BASE ?? 'https://analyst-assessment-production.up.railway.app/api/v1';
  const websiteUrl = process.env.WEBSITE_URL ?? 'https://analyst-assessment-production.up.railway.app';
  for (const value of [apiBase, websiteUrl]) if (new URL(value).protocol !== 'https:') throw new Error('CRM and website URLs must use HTTPS.');
  return { port, statePath: resolve(process.env.STATE_DB ?? 'data/review.sqlite'), captureDir: resolve(process.env.CAPTURE_DIR ?? 'data/capture'), apiBase, websiteUrl, token: process.env.CRM_TOKEN ?? '', liveWritesEnabled: process.env.LIVE_WRITES_ENABLED === 'true' };
}
export function acquireProcessLock(path: string): () => void {
  const lockPath = `${path}.lock`; mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 });
  try {
    const existing = Number(readFileSync(lockPath, 'utf8'));
    if (Number.isInteger(existing) && existing > 0) {
      try { process.kill(existing, 0); throw new Error('The app already owns this state database. Use the running app or stop it before opening this database.'); }
      catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error; }
    }
    unlinkSync(lockPath);
  } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
  const file = openSync(lockPath, 'wx', 0o600); writeFileSync(file, String(process.pid)); closeSync(file);
  return () => { try { unlinkSync(lockPath); } catch { /* The process already released this lock. */ } };
}
export function createRuntime(config = runtimeConfig()): { service: ReviewService; close: () => void } {
  const release = acquireProcessLock(config.statePath);
  try {
    const store = new Store(config.statePath);
    return { service: new ReviewService({ ...config, store }), close: () => { store.close(); release(); } };
  } catch (error) { release(); throw error; }
}
