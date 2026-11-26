export interface Period {
  /** ISO dates YYYY-MM-DD, inclusive */
  start: string;
  end: string;
  status: 'OPEN' | 'CLOSED';
}

export function isPeriodOpen(date: string, periods: Period[]): boolean {
  const d = date.slice(0, 10);
  return periods.some((p) => p.status === 'OPEN' && d >= p.start && d <= p.end);
}
