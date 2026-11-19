"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../config/prisma");
const auth_1 = require("../middleware/auth");
const validate_1 = require("../middleware/validate");
const http_1 = require("../utils/http");
const sanitize_1 = require("../utils/sanitize");
const audit_1 = require("../utils/audit");
const zod_1 = require("zod");
const r = (0, express_1.Router)();
const settingSchema = zod_1.z.object({
    key: zod_1.z.string().trim().min(1).max(120).regex(/^[a-z0-9_]+$/i, 'Use letters, numbers and underscores only'),
    group: zod_1.z.string().trim().max(60).optional().default('general'),
    value: zod_1.z.string().max(5000).optional().nullable(),
});
const bulkSchema = zod_1.z.object({
    settings: zod_1.z.array(settingSchema).min(1).max(100),
});
const PUBLIC_KEYS = [
    'site_name', 'site_tagline', 'site_logo', 'support_email', 'support_phone', 'currency',
    'tax_rate', 'shipping_fee', 'free_shipping_threshold', 'theme', 'accent_color',
    'enable_dark_mode', 'maintenance_mode', 'company_name', 'company_address', 'company_phone',
    'language', 'timezone', 'cod_enabled', 'stripe_publishable_key', 'paypal_client_id',
];
r.get('/public', (0, http_1.asyncHandler)(async (_req, res) => {
    const rows = await prisma_1.prisma.setting.findMany({
        where: { key: { in: [...PUBLIC_KEYS, 'stripe_secret_key', 'paypal_client_secret'] } },
    });
    const values = Object.fromEntries(rows.map((s) => [s.key, (s.value ?? '').trim()]));
    const ready = (publicKey, secretKey) => Boolean(publicKey && secretKey && !publicKey.includes('ElectroShopDemo') && !secretKey.includes('ElectroShopDemo'));
    const data = Object.fromEntries(rows.filter((s) => PUBLIC_KEYS.includes(s.key)).map((s) => [s.key, s.value]));
    return (0, http_1.ok)(res, {
        ...data,
        stripe_configured: ready(values.stripe_publishable_key, values.stripe_secret_key),
        paypal_configured: ready(values.paypal_client_id, values.paypal_client_secret),
    });
}));
r.get('/backup', auth_1.authenticate, (0, auth_1.authorize)('admin'), (0, http_1.asyncHandler)(async (req, res) => {
    const [settings, categories, brands, products, coupons, customers] = await Promise.all([
        prisma_1.prisma.setting.findMany(),
        prisma_1.prisma.category.findMany(),
        prisma_1.prisma.brand.findMany(),
        prisma_1.prisma.product.findMany({ include: { images: true, specifications: true } }),
        prisma_1.prisma.coupon.findMany(),
        prisma_1.prisma.user.findMany({
            where: { role: 'customer' },
            select: { id: true, name: true, email: true, phone: true, status: true, createdAt: true },
        }),
    ]);
    const backup = {
        meta: { app: 'ElectroShop', created_at: new Date().toISOString(), generated_by: req.user.email, version: '1.0.0' },
        settings, categories, brands, products, coupons, customers,
    };
    res.setHeader('Content-Disposition', `attachment; filename="electroshop-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    return res.json(backup);
}));
r.get('/stats', auth_1.authenticate, (0, auth_1.authorize)('admin', 'staff'), (0, http_1.asyncHandler)(async (_req, res) => {
    const rows = await prisma_1.prisma.setting.findMany();
    const groups = rows.reduce((acc, s) => {
        const g = s.group ?? 'general';
        acc[g] = (acc[g] ?? 0) + 1;
        return acc;
    }, {});
    return (0, http_1.ok)(res, { total: rows.length, groups });
}));
r.get('/', auth_1.authenticate, (0, auth_1.authorize)('admin', 'staff'), (0, http_1.asyncHandler)(async (req, res) => {
    const { page, limit, skip } = (0, http_1.getPagination)(req.query, 200);
    const search = String(req.query.search || '');
    const group = req.query.group ? String(req.query.group) : undefined;
    const where = {
        ...(group ? { group } : {}),
        ...(search ? { OR: [{ key: { contains: search, mode: 'insensitive' } }, { value: { contains: search, mode: 'insensitive' } }] } : {}),
    };
    const [items, total] = await Promise.all([
        prisma_1.prisma.setting.findMany({ where, skip, take: limit, orderBy: [{ group: 'asc' }, { key: 'asc' }] }),
        prisma_1.prisma.setting.count({ where }),
    ]);
    // Secret values are only returned to administrators; staff see a masked placeholder.
    const sensitive = /(secret|private_key|password)/i;
    const safeItems = req.user?.role === 'admin'
        ? items
        : items.map((setting) => (sensitive.test(setting.key) && setting.value ? { ...setting, value: '••••••••' } : setting));
    const grouped = safeItems.reduce((acc, s) => {
        const g = s.group ?? 'general';
        (acc[g] ?? (acc[g] = [])).push(s);
        return acc;
    }, {});
    return (0, http_1.ok)(res, safeItems, { ...(0, http_1.getMeta)(page, limit, total), groups: grouped });
}));
r.put('/bulk', auth_1.authenticate, (0, auth_1.authorize)('admin'), (0, validate_1.validateBody)(bulkSchema), (0, http_1.asyncHandler)(async (req, res) => {
    const updates = req.body.settings;
    const results = await prisma_1.prisma.$transaction(updates.map((s) => prisma_1.prisma.setting.upsert({
        where: { key: s.key },
        update: { value: s.value !== null ? (0, sanitize_1.sanitizeText)(s.value) : null, group: s.group ?? 'general' },
        create: { key: s.key, value: s.value !== null ? (0, sanitize_1.sanitizeText)(s.value) : null, group: s.group ?? 'general' },
    })));
    await (0, audit_1.recordActivity)({ userId: req.user.id, action: 'settings.updated', entity: 'Setting', details: `Bulk updated ${results.length} settings`, ip: req.ip });
    return (0, http_1.ok)(res, results, undefined, 'Settings saved');
}));
r.post('/', auth_1.authenticate, (0, auth_1.authorize)('admin'), (0, validate_1.validateBody)(settingSchema), (0, http_1.asyncHandler)(async (req, res) => {
    const data = req.body;
    const setting = await prisma_1.prisma.setting.upsert({
        where: { key: data.key },
        update: { value: data.value !== null ? (0, sanitize_1.sanitizeText)(data.value) : null, group: data.group ?? 'general' },
        create: { key: data.key, group: data.group ?? 'general', value: data.value !== null ? (0, sanitize_1.sanitizeText)(data.value) : null },
    });
    await (0, audit_1.recordActivity)({ userId: req.user.id, action: 'setting.created', entity: 'Setting', entityId: setting.id, details: `Set ${setting.key}`, ip: req.ip });
    return (0, http_1.created)(res, setting, 'Setting saved');
}));
r.put('/:id', auth_1.authenticate, (0, auth_1.authorize)('admin'), (0, validate_1.validateBody)(settingSchema.partial()), (0, http_1.asyncHandler)(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma_1.prisma.setting.findUnique({ where: { id } });
    if (!existing)
        throw new http_1.ApiError(404, 'Setting not found');
    const setting = await prisma_1.prisma.setting.update({
        where: { id },
        data: {
            ...(req.body.key !== undefined ? { key: req.body.key } : {}),
            ...(req.body.group !== undefined ? { group: req.body.group } : {}),
            ...(req.body.value !== undefined ? { value: req.body.value !== null ? (0, sanitize_1.sanitizeText)(req.body.value) : null } : {}),
        },
    });
    await (0, audit_1.recordActivity)({ userId: req.user.id, action: 'setting.updated', entity: 'Setting', entityId: id, details: `Updated ${setting.key}`, ip: req.ip });
    return (0, http_1.ok)(res, setting, undefined, 'Setting updated');
}));
r.delete('/:id', auth_1.authenticate, (0, auth_1.authorize)('admin'), (0, http_1.asyncHandler)(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma_1.prisma.setting.findUnique({ where: { id } });
    if (!existing)
        throw new http_1.ApiError(404, 'Setting not found');
    await prisma_1.prisma.setting.delete({ where: { id } });
    await (0, audit_1.recordActivity)({ userId: req.user.id, action: 'setting.deleted', entity: 'Setting', entityId: id, details: `Deleted ${existing.key}`, ip: req.ip });
    return (0, http_1.ok)(res, null, undefined, 'Setting deleted');
}));
exports.default = r;
