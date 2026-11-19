"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.escapeCsv = escapeCsv;
exports.toCsv = toCsv;
exports.sendCsv = sendCsv;
function escapeCsv(value) {
    if (value === null || value === undefined)
        return '';
    const str = String(value);
    if (/[",\n\r]/.test(str))
        return `"${str.replace(/"/g, '""')}"`;
    return str;
}
function toCsv(rows, headers) {
    if (!rows.length)
        return (headers ?? []).join(',');
    const cols = headers ?? Object.keys(rows[0]);
    const head = cols.map(escapeCsv).join(',');
    const body = rows.map((row) => cols.map((c) => escapeCsv(row[c])).join(',')).join('\n');
    return `${head}\n${body}`;
}
function sendCsv(res, filename, csv) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(`\uFEFF${csv}`);
}
