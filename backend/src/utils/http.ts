export class ApiError extends Error {
  status: number;
  errors?: unknown;
  code?: string;

  constructor(status: number, message: string, errors?: unknown, code?: string) {
    super(message);
    this.status = status;
    this.errors = errors;
    this.code = code;
  }
}

export const badRequest = (message: string, errors?: unknown) => new ApiError(400, message, errors);
export const unauthorized = (message = 'Authentication required') => new ApiError(401, message);
export const forbidden = (message = 'You do not have permission to perform this action') => new ApiError(403, message);
export const notFound = (message = 'Resource not found') => new ApiError(404, message);

export function asyncHandler<T extends (...args: any[]) => Promise<any>>(fn: T) {
  return (req: any, res: any, next: any) => Promise.resolve(fn(req, res, next)).catch(next);
}

export function ok(res: any, data: unknown, meta?: Record<string, unknown>, message?: string) {
  return res.json({ success: true, ...(message ? { message } : {}), data, ...(meta ? { meta } : {}) });
}

export function created(res: any, data: unknown, message = 'Created successfully') {
  return res.status(201).json({ success: true, message, data });
}

export function getPagination(query: Record<string, unknown>, defaultLimit = 10) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(2000, Math.max(1, Number(query.limit) || defaultLimit));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

export function getMeta(page: number, limit: number, total: number) {
  return { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

export function toNumber(value: unknown, fallback?: number): number | undefined {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function toBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  return ['true', '1', 'yes', 'on'].includes(String(value).toLowerCase());
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export function parseDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function dateRange(from?: unknown, to?: unknown) {
  const start = parseDate(from);
  const end = parseDate(to);
  if (end) end.setHours(23, 59, 59, 999);
  return { start, end };
}

export function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function startOfDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function money(value: number) {
  return Number(value.toFixed(2));
}

export function sortOrder(value: unknown): 'asc' | 'desc' {
  return String(value).toLowerCase() === 'asc' ? 'asc' : 'desc';
}
