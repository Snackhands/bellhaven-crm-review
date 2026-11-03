import { z } from 'zod';

export const sourceSchema = z.enum(['demo', 'snapshot', 'live']);
export const accountSchema = z.object({
  account_id: z.string().min(1), name: z.string(), parent_id: z.string(), parent_name: z.string().optional(),
  billing_street: z.string(), billing_city: z.string(), billing_state: z.string(), billing_zip: z.string(),
  care_type: z.string(), status: z.string(), phone: z.string(),
  lifetime_revenue: z.union([z.number(), z.string(), z.null()]),
  outstanding_ar: z.union([z.number(), z.string(), z.null()]),
  chow_current_account: z.string(), duplicate_of_account: z.string(), note: z.string(),
  updated_at: z.string().optional(), created_by_candidate: z.boolean().optional(),
}).passthrough();
export const locationSchema = z.object({
  id: z.string(), name: z.string(), street: z.string(), city: z.string(), state: z.string(), zip: z.string(),
  careOfferings: z.array(z.string()), phone: z.string(), sourceUrl: z.string(), fetchedAt: z.string(),
});
export const snapshotSchema = z.object({
  id: z.string(), capturedAt: z.string(), locations: z.array(locationSchema), accounts: z.array(accountSchema),
  coverage: z.object({ websiteComplete: z.boolean(), crmComplete: z.boolean(), urls: z.array(z.string()), errors: z.array(z.string()) }),
});
const scheduleFields = z.object({
  name: z.string().trim().min(1).max(80), workflowId: z.literal('bellhaven'),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timezone: z.string().refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }, 'Use a valid IANA timezone'),
  source: z.enum(['snapshot', 'live']), enabled: z.boolean().default(false),
  cadence: z.enum(['once', 'hourly', 'daily', 'weekly', 'biweekly', 'monthly']).optional(),
  startDate: z.iso.date().optional(), endDate: z.iso.date().nullable().optional().transform(value => value ?? undefined),
}).strict();

export const schedulePatchSchema = scheduleFields.partial().extend({ enabled: z.boolean().optional() }).strict();
export const scheduleInputSchema = scheduleFields.superRefine((value, context) => {
  if (value.cadence && value.cadence !== 'daily' && !value.startDate) context.addIssue({ code: 'custom', path: ['startDate'], message: 'Choose a start date for this cadence.' });
  if (value.startDate && value.endDate && value.endDate < value.startDate) context.addIssue({ code: 'custom', path: ['endDate'], message: 'End date must be on or after the start date.' });
});
