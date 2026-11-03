import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Account, SourceMode } from '../shared/contracts.js';
import type { AccountFields } from './domain.js';
import { accountSchema } from './schema.js';
import type { Store } from './store.js';

export interface CrmAdapter {
  list(): Promise<Account[]>;
  get(id: string): Promise<Account>;
  create(fields: AccountFields): Promise<Account>;
  patch(id: string, fields: Record<string, unknown>): Promise<Account>;
}
export class LocalAdapter implements CrmAdapter {
  constructor(private readonly store: Store, private readonly source: SourceMode) {}
  async list(): Promise<Account[]> { return this.store.accounts(this.source); }
  async get(id: string): Promise<Account> { const account = this.store.account(this.source, id); if (!account) throw new Error('Account no longer exists.'); return account; }
  async create(fields: AccountFields): Promise<Account> {
    const account = accountSchema.parse({ ...fields, account_id: `local-${randomUUID()}`, created_by_candidate: true });
    this.store.writeLocalAccount(this.source, account); return account;
  }
  async patch(id: string, fields: Record<string, unknown>): Promise<Account> {
    const account = accountSchema.parse({ ...await this.get(id), ...fields });
    this.store.writeLocalAccount(this.source, account); return account;
  }
}
export class LiveAdapter implements CrmAdapter {
  constructor(private readonly options: { apiBase: string; token: string; writesEnabled: boolean; readAccounts: () => Promise<Account[]>; fetcher?: typeof fetch }) {}
  private async request(path: string, method = 'GET', fields?: Record<string, unknown>): Promise<Account> {
    if (method !== 'GET' && !this.options.writesEnabled) throw new Error('Live writes are disabled. Set LIVE_WRITES_ENABLED=true yourself before using approval.');
    const response = await (this.options.fetcher ?? fetch)(`${this.options.apiBase.replace(/\/$/, '')}${path}`, {
      method, headers: { Authorization: `Bearer ${this.options.token}`, ...(fields ? { 'Content-Type': 'application/json' } : {}) },
      ...(fields ? { body: JSON.stringify(fields) } : {}), signal: AbortSignal.timeout(20_000), redirect: 'error',
    });
    if (!response.ok) throw new Error(`CRM ${method} returned HTTP ${response.status}.`);
    const raw: unknown = await response.json();
    const direct = accountSchema.safeParse(raw);
    if (direct.success) return direct.data;
    return z.object({ data: accountSchema }).parse(raw).data;
  }
  list(): Promise<Account[]> { return this.options.readAccounts(); }
  get(id: string): Promise<Account> { return this.request(`/accounts/${encodeURIComponent(id)}`); }
  create(fields: AccountFields): Promise<Account> { return this.request('/accounts', 'POST', fields); }
  patch(id: string, fields: Record<string, unknown>): Promise<Account> { return this.request(`/accounts/${encodeURIComponent(id)}`, 'PATCH', fields); }
}
