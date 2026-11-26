/** UAE business date (UTC+4) as a UTC-midnight Date for @db.Date columns. */
export function businessDate(now = new Date()): Date {
  const iso = new Date(now.getTime() + 4 * 3600_000).toISOString().slice(0, 10);
  return new Date(`${iso}T00:00:00.000Z`);
}

export const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}
