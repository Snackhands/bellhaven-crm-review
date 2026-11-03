import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { load } from 'cheerio';
import { z } from 'zod';
import type { Account, CollectOptions, Counter, Location, Snapshot } from '../../shared/contracts.ts';

const PAGE_SIZE = 50;
const MAX_PAGES = 500;
const MAX_WEBSITE_PAGES = 1_000;
const REQUEST_TIMEOUT_MS = 20_000;
const text = (value: string): string => value.replace(/\s+/g, ' ').trim();
const timestamp = (): string => new Date().toISOString();

type Page = { url: string; body: string; fetchedAt: string };
type AccountPage = { data: Account[]; page: number; page_size: number; total: number };
type PageReader = (url: string) => Promise<Page>;
type CapturedEntry = { url: string; file: string; capturedAt: string };
type CaptureManifest = { requests: CapturedEntry[]; completedAt: string };

function parseJson(body: string, label: string): unknown {
  try { return JSON.parse(body); } catch { throw new Error(`${label} contains invalid JSON.`); }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const financialField = z.union([z.number().finite(), z.string(), z.null()]);
const accountSchema = z.object({
  account_id: z.string().min(1), name: z.string(), parent_id: z.string(), parent_name: z.string().optional(),
  billing_street: z.string(), billing_city: z.string(), billing_state: z.string(), billing_zip: z.string(),
  care_type: z.string(), status: z.string(), phone: z.string(),
  lifetime_revenue: financialField, outstanding_ar: financialField,
  chow_current_account: z.string(), duplicate_of_account: z.string(), note: z.string(),
  updated_at: z.string().optional(), created_by_candidate: z.boolean().optional(),
}).passthrough();

function parseAccounts(value: unknown): Account[] {
  const result = z.array(accountSchema).safeParse(value);
  if (!result.success) throw new Error('CRM contains invalid accounts, missing IDs, or malformed financial fields.');
  return result.data;
}

function parseAccountPage(value: unknown, expectedPage: number): AccountPage {
  if (!isRecord(value) || value.page !== expectedPage ||
      typeof value.page_size !== 'number' || !Number.isSafeInteger(value.page_size) || value.page_size <= 0 ||
      typeof value.total !== 'number' || !Number.isSafeInteger(value.total) || value.total < 0) {
    throw new Error('CRM returned an invalid pagination envelope.');
  }
  const data = parseAccounts(value.data);
  if (data.length > value.page_size) throw new Error('CRM page exceeds its declared page size.');
  return { data, page: expectedPage, page_size: value.page_size, total: value.total };
}

function uniqueAccounts(accounts: Account[]): void {
  if (new Set(accounts.map(row => row.account_id)).size !== accounts.length) {
    throw new Error('CRM pagination contains duplicate account IDs.');
  }
}

function checkedUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Source URL is invalid.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Source URL must be HTTP(S), without credentials, query, or fragment.');
  }
  return url;
}

async function fetchPage(url: string, token?: string): Promise<Page> {
  try {
    const response = await fetch(url, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.text();
    return { url, body, fetchedAt: timestamp() };
  } catch (error) {
    const reason = error instanceof Error && /^HTTP \d+$/.test(error.message) ? error.message : 'request failed or timed out';
    // Never echo provider bodies, credentials, or a caller-supplied URL in errors.
    throw new Error(`Source ${reason}.`);
  }
}

export async function readAccounts(options: {
  apiBase: string; token: string; onProgress?: (counter: Counter) => void;
}): Promise<Account[]> {
  const base = checkedUrl(options.apiBase);
  base.pathname = base.pathname.replace(/\/$/, '') + '/accounts';
  const accounts: Account[] = [];
  let expectedTotal: number | undefined;
  let pageSize = PAGE_SIZE;
  let pageCount = 1;
  options.onProgress?.({ completed: 0, total: null });
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
    base.search = new URLSearchParams({ page: String(pageNumber), page_size: String(pageSize) }).toString();
    const response = await fetchPage(base.href, options.token);
    const page = parseAccountPage(parseJson(response.body, 'CRM response'), pageNumber);
    if (expectedTotal === undefined) {
      expectedTotal = page.total;
      pageSize = page.page_size;
      pageCount = Math.max(1, Math.ceil(page.total / pageSize));
      if (pageCount > MAX_PAGES) throw new Error('CRM pagination exceeds the safety limit.');
    } else if (page.total !== expectedTotal || page.page_size !== pageSize) {
      throw new Error('CRM pagination changed during collection. Run a fresh scan.');
    }
    const expectedLength = Math.max(0, Math.min(pageSize, expectedTotal - accounts.length));
    if (page.data.length !== expectedLength) throw new Error('CRM page is incomplete.');
    accounts.push(...page.data);
    uniqueAccounts(accounts);
    options.onProgress?.({ completed: accounts.length, total: expectedTotal });
  }
  return accounts;
}

function relevantUrl(href: string, baseUrl: string, origin: string): string | null {
  let url: URL;
  try { url = new URL(href, baseUrl); } catch { return null; }
  if (url.origin !== origin || url.username || url.password) return null;
  const path = url.pathname.replace(/\/$/, '') || '/';
  if (!['/', '/about', '/communities'].includes(path) && !/^\/communities\/[^/]+$/.test(path)) return null;
  if ([...url.searchParams.keys()].some(key => key !== 'page') ||
      (url.searchParams.has('page') && (path !== '/communities' || !/^[1-9]\d*$/.test(url.searchParams.get('page') ?? '')))) return null;
  if (url.searchParams.get('page') === '1') url.search = '';
  url.pathname = path;
  url.hash = '';
  return url.href;
}

function parseLocation(page: Page): Location {
  const $ = load(page.body);
  const name = text($('h1').first().text());
  const fields = new Map<string, ReturnType<typeof $>>();
  $('dl.detail dt').each((_index, element) => {
    const term = $(element);
    fields.set(text(term.text()).toLowerCase(), term.next('dd'));
  });
  const address = fields.get('address');
  const addressLines = address?.html()?.split(/<br\s*\/?\s*>/i).map(part => text(load(part).text())).filter(Boolean) ?? [];
  const street = addressLines.slice(0, -1).join(', ');
  const locality = addressLines.at(-1)?.match(/^(.+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  const [, city, state, zip] = locality ?? [];
  const careOfferings = [...new Set(fields.get('care offerings')?.find('.badge').map((_index, element) => text($(element).text())).get().filter(Boolean) ?? [])];
  if (!name || !street || !city || !state || !zip || !careOfferings.length) throw new Error('Community detail is missing a valid name, full address, or care offerings.');
  return {
    id: new URL(page.url).pathname.split('/').at(-1) ?? '', name, street,
    city, state, zip, careOfferings,
    phone: text(fields.get('phone')?.text() ?? ''), sourceUrl: page.url, fetchedAt: page.fetchedAt,
  };
}

async function crawlWebsite(options: {
  websiteUrl: string; read: PageReader; onProgress?: (counter: Counter) => void;
}): Promise<{ locations: Location[]; urls: string[]; errors: string[] }> {
  const base = checkedUrl(options.websiteUrl);
  const queue = [new URL('/', base).href, new URL('/communities', base).href];
  const discovered = new Set(queue);
  const urls: string[] = [];
  const errors: string[] = [];
  const locations: Location[] = [];
  let completed = 0;
  let directoryCount = 0;
  let directoryExpected: number | undefined;
  let detailLinks = 0;
  let listedExpected: number | undefined;
  const directoryLocationUrls = new Set<string>();
  for (const url of queue) {
    try {
      const page = await options.read(url);
      urls.push(url);
      const $ = load(page.body);
      const isDirectory = new URL(url).pathname === '/communities';
      if (isDirectory) {
        directoryCount++;
        const declared = text($('.wrap').text()).match(/Page\s+\d+\s+of\s+(\d+)/i);
        if (declared) {
          const count = Number(declared[1]);
          if (!Number.isSafeInteger(count) || count < 1 || count > MAX_WEBSITE_PAGES) throw new Error('Invalid directory page count.');
          if (directoryExpected !== undefined && directoryExpected !== count) throw new Error('Directory page count changed during collection.');
          directoryExpected = count;
        }
      }
      if (new URL(url).pathname.startsWith('/communities/')) locations.push(parseLocation(page));
      $('a[href]').each((_index, element) => {
        const link = relevantUrl($(element).attr('href') ?? '', url, base.origin);
        if (!link) return;
        if (new URL(link).pathname.startsWith('/communities/')) {
          if (isDirectory) directoryLocationUrls.add(link);
          detailLinks++;
        }
        if (!discovered.has(link)) {
          if (discovered.size >= MAX_WEBSITE_PAGES) throw new Error('Website discovery exceeds the safety limit.');
          discovered.add(link); queue.push(link);
        }
      });
      if (isDirectory) {
        const listed = text($('.wrap').text()).match(/(\d+)\s+communities\s+listed/i);
        if (listed) {
          const count = Number(listed[1]);
          if (!Number.isSafeInteger(count) || count < 0 || (listedExpected !== undefined && listedExpected !== count)) throw new Error('Directory location count is inconsistent.');
          listedExpected = count;
        }
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Page could not be read.';
      errors.push(`${new URL(url).pathname}${new URL(url).search}: ${detail}`);
    }
    completed++;
    options.onProgress?.({ completed, total: queue.length });
  }
  if (!directoryCount) errors.push('No community directory page was collected.');
  if (directoryExpected !== undefined && directoryCount !== directoryExpected) errors.push('Community directory pagination is incomplete.');
  if (listedExpected !== undefined && directoryLocationUrls.size !== listedExpected) errors.push('Directory location links do not match its declared count.');
  if (!detailLinks || !locations.length) errors.push('No valid community details were discovered.');
  return { locations, urls, errors };
}

async function saveSnapshot(snapshot: Snapshot, outputDir: string): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, 'snapshot.json'), JSON.stringify(snapshot, null, 2) + '\n', { mode: 0o600 });
}

export async function collectSnapshot(options: CollectOptions): Promise<Snapshot> {
  const progress: { website: Counter; crm: Counter; message: string } = { website: { completed: 0, total: null }, crm: { completed: 0, total: null }, message: 'Discovering communities.' };
  const publish = (): void => options.onProgress?.({ website: { ...progress.website }, crm: { ...progress.crm }, message: progress.message });
  const website = await crawlWebsite({ websiteUrl: options.websiteUrl, read: fetchPage, onProgress: counter => { progress.website = counter; publish(); } });
  progress.message = 'Reading CRM pages.';
  let accounts: Account[] = [];
  let crmComplete = false;
  const errors = [...website.errors];
  try {
    accounts = await readAccounts({ apiBase: options.apiBase, token: options.token, onProgress: counter => { progress.crm = counter; publish(); } });
    crmComplete = true;
  } catch (error) { errors.push(error instanceof Error ? error.message : 'CRM collection failed.'); }
  const snapshot: Snapshot = {
    id: randomUUID(), capturedAt: timestamp(), locations: website.locations, accounts,
    coverage: { websiteComplete: website.errors.length === 0, crmComplete, urls: website.urls, errors },
  };
  await saveSnapshot(snapshot, options.outputDir);
  progress.message = errors.length ? 'Collection incomplete. Review source errors.' : 'Collection complete.';
  publish();
  return snapshot;
}

function parseManifest(raw: unknown): CaptureManifest {
  if (!isRecord(raw) || !Array.isArray(raw.requests) || typeof raw.completedAt !== 'string' || !Number.isFinite(Date.parse(raw.completedAt))) throw new Error('Capture manifest is invalid.');
  const requests = raw.requests.map((entry: unknown) => {
    if (!isRecord(entry) || typeof entry.url !== 'string' || typeof entry.file !== 'string' || typeof entry.capturedAt !== 'string' || !Number.isFinite(Date.parse(entry.capturedAt))) throw new Error('Capture page metadata is invalid.');
    return { url: entry.url, file: entry.file, capturedAt: entry.capturedAt };
  });
  return { requests, completedAt: raw.completedAt };
}

export async function loadCapturedSnapshot(captureDir: string): Promise<Snapshot> {
  const manifest = parseManifest(parseJson(await readFile(join(captureDir, 'manifest.json'), 'utf8'), 'Capture manifest'));
  const baseDir = resolve(captureDir) + sep;
  const readCapture = async (entry: CapturedEntry): Promise<string> => {
    const path = resolve(captureDir, entry.file);
    if (!path.startsWith(baseDir) || basename(path) !== entry.file) throw new Error('Capture filename is invalid.');
    return readFile(path, 'utf8');
  };
  const websiteEntry = manifest.requests.find(entry => new URL(entry.url).pathname === '/');
  if (!websiteEntry) throw new Error('Capture does not contain a homepage.');
  const website = await crawlWebsite({ websiteUrl: websiteEntry.url, read: async url => {
    const entry = manifest.requests.find(item => relevantUrl(item.url, websiteEntry.url, new URL(websiteEntry.url).origin) === url);
    if (!entry) throw new Error('Discovered page is absent from the capture.');
    return { url, body: await readCapture(entry), fetchedAt: entry.capturedAt };
  } });
  const errors = [...website.errors];
  let accounts: Account[] = [];
  let crmComplete = false;
  try {
    accounts = parseAccounts(parseJson(await readFile(join(captureDir, 'accounts.json'), 'utf8'), 'Captured accounts'));
    uniqueAccounts(accounts);
    const entries = manifest.requests.filter(entry => /\/api\/v1\/accounts$/.test(new URL(entry.url).pathname));
    const pages = new Map<number, AccountPage>();
    for (const entry of entries) {
      const pageNumber = Number(new URL(entry.url).searchParams.get('page'));
      const page = parseAccountPage(parseJson(await readCapture(entry), 'Captured CRM page'), pageNumber);
      if (pages.has(pageNumber)) throw new Error('Capture contains repeated CRM pages.');
      pages.set(pageNumber, page);
    }
    const first = pages.get(1);
    if (!first) throw new Error('Capture does not contain the first CRM page.');
    const expectedPages = Math.max(1, Math.ceil(first.total / first.page_size));
    if (expectedPages > MAX_PAGES || pages.size !== expectedPages || accounts.length !== first.total) throw new Error('Captured CRM pagination is incomplete.');
    const rows: Account[] = [];
    for (let number = 1; number <= expectedPages; number++) {
      const page = pages.get(number);
      if (!page || page.total !== first.total || page.page_size !== first.page_size) throw new Error('Captured CRM pagination is inconsistent.');
      if (page.data.length !== Math.max(0, Math.min(first.page_size, first.total - rows.length))) throw new Error('Captured CRM page is incomplete.');
      rows.push(...page.data);
    }
    uniqueAccounts(rows);
    if (JSON.stringify(rows) !== JSON.stringify(accounts)) throw new Error('Captured account array differs from raw CRM pages.');
    crmComplete = true;
  } catch (error) { errors.push(error instanceof Error ? error.message : 'Captured CRM accounts are invalid.'); accounts = []; }
  const snapshot: Snapshot = {
    id: createHash('sha256').update(JSON.stringify(manifest)).digest('hex').slice(0, 24), capturedAt: manifest.completedAt,
    locations: website.locations, accounts,
    coverage: { websiteComplete: website.errors.length === 0, crmComplete, urls: website.urls, errors },
  };
  await saveSnapshot(snapshot, captureDir);
  return snapshot;
}
