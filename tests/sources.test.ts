import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { mock } from 'node:test';
import { collectSnapshot, loadCapturedSnapshot, readAccounts } from '../server/sources/index.ts';
import type { Account, Counter } from '../shared/contracts.ts';

function account(id: string): Account {
  return { account_id: id, name: `Example ${id}`, parent_id: '', billing_street: '1 Main St', billing_city: 'Example', billing_state: 'OH', billing_zip: '43000', care_type: 'Assisted Living', status: 'Active', phone: '', lifetime_revenue: 0, outstanding_ar: 0, chow_current_account: '', duplicate_of_account: '', note: '', extra_preserved: 'original' };
}

function detail(name: string): string {
  return `<h1>${name}</h1><dl class="detail"><dt>Address</dt><dd>12 N. Main St<br>Lake Example, OH 43000-1234</dd><dt>Care Offerings</dt><dd><span class="badge">Assisted Living</span><span class="badge">Memory Support</span></dd><dt>Phone</dt><dd>(555) 123-4567</dd></dl>`;
}

type Handler = (request: IncomingMessage, response: ServerResponse) => void;
async function fixtureServer(handler: Handler): Promise<{ base: string; close: () => Promise<void> }> {
  const server = createServer(handler);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture server did not bind.');
  return { base: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

function sitePages(): Record<string, string> {
  return {
    '/': '<a href="/communities/homepage-only">New arrival</a><a href="https://outside.invalid/communities/no">External</a>',
    '/communities': '<div class="wrap">Page 1 of 2 · 2 communities listed<a href="/communities/the-orchard">The Orchard</a><a href="/communities?page=2">Next</a></div>',
    '/communities?page=2': '<div class="wrap">Page 2 of 2 · 2 communities listed<a href="/communities/another">Another</a><a href="/communities?page=1">Previous</a></div>',
    '/communities/homepage-only': detail('Newest Home'),
    '/communities/the-orchard': detail('The Orchard'),
    '/communities/another': detail('Another Home'),
  };
}

test('discovery follows pagination and homepage-only links, preserves all care badges and full addresses', async () => {
  const requests: string[] = [];
  const pages = sitePages();
  const server = await fixtureServer((request, response) => {
    assert.equal(request.method, 'GET');
    requests.push(request.url ?? '');
    if (request.url?.startsWith('/api/v1/accounts')) {
      assert.equal(request.headers.authorization, 'Bearer synthetic-secret');
      response.end(JSON.stringify({ data: [account('one')], page: 1, page_size: 50, total: 1 }));
    } else if (request.url && pages[request.url]) response.end(pages[request.url]);
    else { response.statusCode = 404; response.end('missing'); }
  });
  const directory = await mkdtemp(join(tmpdir(), 'sources-'));
  try {
    const progress: number[] = [];
    const snapshot = await collectSnapshot({ websiteUrl: server.base, apiBase: server.base + '/api/v1', token: 'synthetic-secret', outputDir: directory, onProgress: p => progress.push(p.website.completed) });
    assert.equal(snapshot.coverage.websiteComplete, true);
    assert.equal(snapshot.coverage.crmComplete, true);
    assert.equal(snapshot.locations.length, 3);
    assert.equal(snapshot.locations.find(location => location.name === 'The Orchard')?.street, '12 N. Main St');
    assert.ok(snapshot.locations[0]);
    assert.equal(snapshot.locations[0].zip, '43000-1234');
    assert.deepEqual(snapshot.locations[0].careOfferings, ['Assisted Living', 'Memory Support']);
    assert.ok(snapshot.locations.every(location => location.sourceUrl.startsWith(server.base) && Number.isFinite(Date.parse(location.fetchedAt))));
    assert.equal(new Set(requests).size, requests.length);
    assert.ok(!requests.some(url => url.includes('outside')));
    assert.ok(snapshot.accounts[0]);
    assert.equal(snapshot.accounts[0].extra_preserved, 'original');
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'snapshot.json'), 'utf8')), snapshot);
    assert.equal(progress.at(-1), 6);
  } finally { await server.close(); await rm(directory, { recursive: true, force: true }); }
});

test('a failed discovered page makes coverage incomplete without dropping successful details', async () => {
  const pages = sitePages(); delete pages['/communities?page=2'];
  const server = await fixtureServer((request, response) => {
    if (request.url?.startsWith('/api/v1/accounts')) response.end(JSON.stringify({ data: [], page: 1, page_size: 50, total: 0 }));
    else if (request.url && pages[request.url]) response.end(pages[request.url]);
    else { response.statusCode = 503; response.end('do not echo synthetic-secret'); }
  });
  const directory = await mkdtemp(join(tmpdir(), 'sources-'));
  try {
    const snapshot = await collectSnapshot({ websiteUrl: server.base, apiBase: server.base + '/api/v1', token: 'synthetic-secret', outputDir: directory });
    assert.equal(snapshot.coverage.websiteComplete, false);
    assert.equal(snapshot.coverage.crmComplete, true);
    assert.equal(snapshot.locations.length, 2);
    assert.match(snapshot.coverage.errors.join(' '), /pagination is incomplete/);
    assert.ok(!JSON.stringify(snapshot.coverage.errors).includes('synthetic-secret'));
  } finally { await server.close(); await rm(directory, { recursive: true, force: true }); }
});

test('readAccounts follows the returned page size and reads every account exactly once', async () => {
  const requests: string[] = [];
  const progress: Counter[] = [];
  const server = await fixtureServer((request, response) => {
    requests.push(request.url ?? '');
    const page = Number(new URL(request.url ?? '/', 'http://localhost').searchParams.get('page'));
    response.end(JSON.stringify({ data: page === 1 ? [account('one'), account('two')] : [account('three')], page, page_size: 2, total: 3 }));
  });
  try {
    const rows = await readAccounts({ apiBase: server.base + '/api/v1/', token: 'local-only', onProgress: p => progress.push(p) });
    assert.deepEqual(rows.map(row => row.account_id), ['one', 'two', 'three']);
    assert.deepEqual(requests, ['/api/v1/accounts?page=1&page_size=50', '/api/v1/accounts?page=2&page_size=2']);
    assert.deepEqual(progress, [{ completed: 0, total: null }, { completed: 2, total: 3 }, { completed: 3, total: 3 }]);
  } finally { await server.close(); }
});

test('invalid envelopes, duplicate IDs, partial rows and HTTP errors stop CRM collection', async t => {
  const cases: Array<{ name: string; body: unknown; status?: number }> = [
    { name: 'string total', body: { data: [], page: 1, page_size: 50, total: '0' } },
    { name: 'bad ID', body: { data: [{ ...account('one'), account_id: '' }], page: 1, page_size: 50, total: 1 } },
    { name: 'duplicates', body: { data: [account('one'), account('one')], page: 1, page_size: 50, total: 2 } },
    { name: 'partial page', body: { data: [account('one')], page: 1, page_size: 50, total: 2 } },
    { name: 'bad financial field', body: { data: [{ ...account('one'), outstanding_ar: {} }], page: 1, page_size: 50, total: 1 } },
    { name: 'HTTP failure', body: 'super-secret-token', status: 401 },
  ];
  for (const item of cases) await t.test(item.name, async () => {
    const server = await fixtureServer((_request, response) => { response.statusCode = item.status ?? 200; response.end(JSON.stringify(item.body)); });
    try {
      await assert.rejects(readAccounts({ apiBase: server.base + '/api/v1', token: 'super-secret-token' }), error => error instanceof Error && !error.message.includes('super-secret-token'));
    } finally { await server.close(); }
  });
});

test('offline capture validates raw pagination and preserves source timestamps', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sources-capture-'));
  const base = 'https://example.invalid';
  const capturedAt = '2026-01-02T03:04:05.000Z';
  const pages = sitePages();
  const entries: Array<{ url: string; file: string; capturedAt: string }> = [];
  try {
    let index = 0;
    for (const [path, body] of Object.entries(pages)) {
      const file = `page-${index++}.html`; await writeFile(join(directory, file), body);
      entries.push({ url: base + path, file, capturedAt });
    }
    const rows = [account('one')];
    await writeFile(join(directory, 'accounts.json'), JSON.stringify(rows));
    await writeFile(join(directory, 'accounts-page-1.json'), JSON.stringify({ data: rows, page: 1, page_size: 50, total: 1 }));
    entries.push({ url: base + '/api/v1/accounts?page=1&page_size=50', file: 'accounts-page-1.json', capturedAt });
    await writeFile(join(directory, 'manifest.json'), JSON.stringify({ requests: entries, completedAt: capturedAt }));
    const snapshot = await loadCapturedSnapshot(directory);
    assert.equal(snapshot.coverage.websiteComplete, true);
    assert.equal(snapshot.coverage.crmComplete, true);
    assert.equal(snapshot.capturedAt, capturedAt);
    assert.ok(snapshot.locations[0]);
    assert.equal(snapshot.locations[0].fetchedAt, capturedAt);
    assert.deepEqual(snapshot.accounts, rows);
    assert.equal((await loadCapturedSnapshot(directory)).id, snapshot.id);
    await rm(join(directory, 'page-2.html'));
    const incomplete = await loadCapturedSnapshot(directory);
    assert.equal(incomplete.coverage.websiteComplete, false);
    assert.equal(incomplete.coverage.crmComplete, true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});


test('request deadlines stop an unresponsive source without exposing credentials', async () => {
  const deadline = mock.method(AbortSignal, 'timeout', () => AbortSignal.abort(new DOMException('Timed out', 'TimeoutError')));
  const server = await fixtureServer((_request, _response) => {});
  try {
    await assert.rejects(readAccounts({ apiBase: server.base + '/api/v1', token: 'deadline-secret' }), error => error instanceof Error && /timed out/.test(error.message) && !error.message.includes('deadline-secret'));
  } finally { deadline.mock.restore(); await server.close(); }
});
