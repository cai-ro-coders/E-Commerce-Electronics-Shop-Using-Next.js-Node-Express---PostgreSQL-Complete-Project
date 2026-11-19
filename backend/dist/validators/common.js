"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.passwordSchema = exports.emailSchema = exports.statusSchema = exports.optionalText = exports.nullableString = exports.paginationQuery = exports.optionalBooleanish = exports.booleanish = exports.idParam = void 0;
const zod_1 = require("zod");
exports.idParam = zod_1.z.object({ id: zod_1.z.coerce.number().int().positive() });
exports.booleanish = zod_1.z.preprocess((v) => {
    if (typeof v === 'string')
        return ['true', '1', 'yes', 'on'].includes(v.toLowerCase());
    return v;
}, zod_1.z.boolean());
exports.optionalBooleanish = zod_1.z.preprocess((v) => {
    if (v === undefined || v === null || v === '')
        return undefined;
    if (typeof v === 'string')
        return ['true', '1', 'yes', 'on'].includes(v.toLowerCase());
    return v;
}, zod_1.z.boolean().optional());
exports.paginationQuery = zod_1.z.object({
    page: zod_1.z.coerce.number().int().min(1).optional().default(1),
    limit: zod_1.z.coerce.number().int().min(1).max(2000).optional().default(10),
    search: zod_1.z.string().trim().max(200).optional().default(''),
    sortBy: zod_1.z.string().trim().max(60).optional(),
    sortDir: zod_1.z.enum(['asc', 'desc']).optional().default('desc'),
});
exports.nullableString = zod_1.z.union([zod_1.z.string().trim().max(5000), zod_1.z.null()]).optional();
exports.optionalText = zod_1.z.union([zod_1.z.string().trim().max(20000), zod_1.z.null()]).optional();
exports.statusSchema = zod_1.z.enum(['active', 'inactive']);
exports.emailSchema = zod_1.z.string().trim().toLowerCase().email('Enter a valid email address').max(160);
exports.passwordSchema = zod_1.z.string().min(8, 'Password must be at least 8 characters').max(100);
