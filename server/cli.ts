import { runtimeConfig, createRuntime } from './runtime.js';
import { sourceSchema } from './schema.js';

if (process.argv[2] !== 'scan') throw new Error('Usage: npm run scan -- --source live|snapshot');
const sourceIndex = process.argv.indexOf('--source');
const source = sourceSchema.exclude(['demo']).parse(sourceIndex >= 0 ? process.argv[sourceIndex + 1] : 'live');
const config = runtimeConfig();
let response: Response | null = null;
try {
  response = await fetch(`http://127.0.0.1:${config.port}/api/health`, { signal: AbortSignal.timeout(1000) });
} catch { /* Run directly when the local server is not awake. */ }
if (response?.ok) {
  const run = await fetch(`http://127.0.0.1:${config.port}/api/runs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source }) });
  if (!run.ok) throw new Error(`Local scan request returned HTTP ${run.status}.`);
  process.stdout.write('Scan queued in the local review app. No CRM writes were approved.\n');
} else {
  const runtime = createRuntime(config);
  try {
    runtime.service.startRun(source); await runtime.service.waitForRun();
    const run = runtime.service.state().run;
    process.stdout.write(`${run?.status}: ${run?.message}\n`);
    if (run?.status === 'failed') process.exitCode = 1;
  } finally { runtime.close(); }
}
