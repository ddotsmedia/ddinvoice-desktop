/** RFC 4180 CSV. Cells beginning with = + - @ or a tab are prefixed with an apostrophe to block spreadsheet formula injection. */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(headers: string[], rows: string[][]): string {
  const lines = [headers, ...rows].map((r) => r.map(csvCell).join(','));
  return `${lines.join('\r\n')}\r\n`;
}
