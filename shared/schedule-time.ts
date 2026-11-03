const formatters = new Map<string, Intl.DateTimeFormat>();

export function localParts(at: Date, timezone: string): { date: string; time: string } {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    formatters.set(timezone, formatter);
  }
  const parts = formatter.formatToParts(at);
  const part = (type: string): string => parts.find(item => item.type === type)?.value ?? '';
  return { date: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}` };
}
// Resolve offsets around the calendar date, then verify each candidate. Gaps have
// no candidate; a fold selects the earlier instant, even after that instant passed.
export function occurrenceAt(date: string, time: string, timezone: string): Date | undefined {
  const wall = Date.parse(`${date}T${time}:00Z`);
  const offsets = new Set<number>();
  for (let hours = -48; hours <= 48; hours += 6) {
    const instant = wall + hours * 3_600_000;
    const local = localParts(new Date(instant), timezone);
    offsets.add(Date.parse(`${local.date}T${local.time}:00Z`) - instant);
  }
  const candidates = [...offsets].map(offset => new Date(wall - offset)).filter(candidate => {
    const local = localParts(candidate, timezone);
    return local.date === date && local.time === time;
  });
  return candidates.sort((left, right) => left.getTime() - right.getTime())[0];
}
