"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notFound = exports.forbidden = exports.unauthorized = exports.badRequest = exports.ApiError = void 0;
exports.asyncHandler = asyncHandler;
exports.ok = ok;
exports.created = created;
exports.getPagination = getPagination;
exports.getMeta = getMeta;
exports.toNumber = toNumber;
exports.toBoolean = toBoolean;
exports.slugify = slugify;
exports.parseDate = parseDate;
exports.dateRange = dateRange;
exports.addDays = addDays;
exports.startOfDay = startOfDay;
exports.money = money;
exports.sortOrder = sortOrder;
class ApiError extends Error {
    constructor(status, message, errors, code) {
        super(message);
        this.status = status;
        this.errors = errors;
        this.code = code;
    }
}
exports.ApiError = ApiError;
const badRequest = (message, errors) => new ApiError(400, message, errors);
exports.badRequest = badRequest;
const unauthorized = (message = 'Authentication required') => new ApiError(401, message);
exports.unauthorized = unauthorized;
const forbidden = (message = 'You do not have permission to perform this action') => new ApiError(403, message);
exports.forbidden = forbidden;
const notFound = (message = 'Resource not found') => new ApiError(404, message);
exports.notFound = notFound;
function asyncHandler(fn) {
    return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
function ok(res, data, meta, message) {
    return res.json({ success: true, ...(message ? { message } : {}), data, ...(meta ? { meta } : {}) });
}
function created(res, data, message = 'Created successfully') {
    return res.status(201).json({ success: true, message, data });
}
function getPagination(query, defaultLimit = 10) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(2000, Math.max(1, Number(query.limit) || defaultLimit));
    const skip = (page - 1) * limit;
    return { page, limit, skip };
}
function getMeta(page, limit, total) {
    return { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}
function toNumber(value, fallback) {
    if (value === undefined || value === null || value === '')
        return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}
function toBoolean(value) {
    if (value === undefined || value === null || value === '')
        return undefined;
    if (typeof value === 'boolean')
        return value;
    return ['true', '1', 'yes', 'on'].includes(String(value).toLowerCase());
}
function slugify(value) {
    return value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
}
function parseDate(value) {
    if (!value)
        return undefined;
    const d = new Date(String(value));
    return Number.isNaN(d.getTime()) ? undefined : d;
}
function dateRange(from, to) {
    const start = parseDate(from);
    const end = parseDate(to);
    if (end)
        end.setHours(23, 59, 59, 999);
    return { start, end };
}
function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
}
function startOfDay(date = new Date()) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}
function money(value) {
    return Number(value.toFixed(2));
}
function sortOrder(value) {
    return String(value).toLowerCase() === 'asc' ? 'asc' : 'desc';
}
