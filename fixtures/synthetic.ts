import type { Account, Location, Snapshot } from '../shared/contracts.js';

export function account(overrides: Partial<Account> = {}): Account {
  return { account_id: 'facility-a', name: 'Bellhaven at Birch Grove', parent_id: 'parent-bellhaven',
    billing_street: '100 Maple Street', billing_city: 'Sampletown', billing_state: 'OH', billing_zip: '43000',
    care_type: 'Assisted Living', status: 'Active', phone: '(555) 555-0100', lifetime_revenue: 0, outstanding_ar: 0,
    chow_current_account: '', duplicate_of_account: '', note: '', updated_at: '2026-01-01T00:00:00Z', ...overrides };
}
export function location(overrides: Partial<Location> = {}): Location {
  return { id: 'birch-grove', name: 'Bellhaven at Birch Grove', street: '100 Maple Street', city: 'Sampletown', state: 'OH', zip: '43000',
    careOfferings: ['Assisted Living'], phone: '(555) 555-0100', sourceUrl: 'https://synthetic.invalid/communities/birch-grove', fetchedAt: '2026-01-01T00:00:00Z', ...overrides };
}
export function snapshot(accounts: Account[] = [account()], locations: Location[] = [location()]): Snapshot {
  return { id: 'synthetic-snapshot', capturedAt: '2026-01-01T00:00:00Z',
    accounts: [account({ account_id: 'parent-bellhaven', name: 'Bellhaven Senior Living (Parent Account)', parent_id: '', billing_street: '', billing_city: '', billing_state: '', billing_zip: '', care_type: '', phone: '' }), ...accounts], locations,
    coverage: { websiteComplete: true, crmComplete: true, urls: ['https://synthetic.invalid/communities', ...locations.map(item => item.sourceUrl)], errors: [] } };
}
