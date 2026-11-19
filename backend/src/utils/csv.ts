export function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function toCsv(rows: Array<Record<string, unknown>>, headers?: string[]): string {
  if (!rows.length) return (headers ?? []).join(',');
  const cols = headers ?? Object.keys(rows[0]);
  const head = cols.map(escapeCsv).join(',');
  const body = rows.map((row) => cols.map((c) => escapeCsv(row[c])).join(',')).join('\n');
  return `${head}\n${body}`;
}

export function sendCsv(res: any, filename: string, csv: string) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(`\uFEFF${csv}`);
}
