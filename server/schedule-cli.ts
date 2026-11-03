import { pathToFileURL } from 'node:url';
import { runtimeConfig, createRuntime } from './runtime.js';
import { tickSchedules } from './schedules.js';

export async function runScheduleTick(config = runtimeConfig()): Promise<void> {
  let response: Response | null = null;
  try {
    response = await fetch(`http://127.0.0.1:${config.port}/api/health`, { signal: AbortSignal.timeout(1000) });
  } catch { /* The standalone tick acquires the normal database process lock. */ }
  if (response?.ok) {
    const tick = await fetch(`http://127.0.0.1:${config.port}/api/schedules/tick`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(5000),
    });
    if (!tick.ok) throw new Error(`Local schedule tick returned HTTP ${tick.status}.`);
    process.stdout.write('Enabled schedules checked in the local review app. No CRM writes were approved.\n');
    return;
  }
  const runtime = createRuntime(config);
  try {
    const previousRunId = runtime.service.state().run?.id;
    tickSchedules(runtime.service);
    await runtime.service.waitForRun();
    const run = runtime.service.state().run;
    process.stdout.write('Enabled schedules checked. No CRM writes were approved.\n');
    if (run?.id !== previousRunId && run?.status === 'failed') process.exitCode = 1;
  } finally { runtime.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runScheduleTick();
