export function madridDate(now = new Date()) { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now); const value = (type: string) => parts.find((part) => part.type === type)?.value; return `${value('year')}-${value('month')}-${value('day')}`; }
export function taskDate(dueAt: Date | null) { return dueAt?.toISOString().slice(0, 10) ?? null; }
/** Bounds for event timestamps, unlike dueAt which is a UTC business date. */
export function madridDayBounds(day = madridDate()) {
  const midnight = new Date(`${day}T00:00:00.000Z`).getTime();
  const localMidnight = (instant: number) => {
    const hour = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', hourCycle: 'h23' }).format(new Date(instant));
    return new Date(instant - Number(hour) * 3_600_000);
  };
  return { start: localMidnight(midnight), end: localMidnight(midnight + 86_400_000) };
}
