"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateCoupon = evaluateCoupon;
const express_1 = require("express");
const prisma_1 = require("../config/prisma");
const auth_1 = require("../middleware/auth");
const validate_1 = require("../middleware/validate");
const commerce_1 = require("../validators/commerce");
const http_1 = require("../utils/http");
const sanitize_1 = require("../utils/sanitize");
const audit_1 = require("../utils/audit");
const r = (0, express_1.Router)();
function evaluateCoupon(coupon, subtotal) {
    const now = new Date();
    if (!coupon || coupon.status !== 'active')
        throw new http_1.ApiError(400, 'This coupon code is not valid');
    if (coupon.startDate && coupon.startDate > now)
        throw new http_1.ApiError(400, 'This coupon is not active yet');
    if (coupon.endDate && coupon.endDate < now)
        throw new http_1.ApiError(400, 'This coupon has expired');
    if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit)
        throw new http_1.ApiError(400, 'This coupon has reached its usage limit');
    if (coupon.minimumOrder && subtotal < Number(coupon.minimumOrder))
        throw new http_1.ApiError(400, `This coupon requires a minimum order of $${Number(coupon.minimumOrder).toFixed(2)}`);
    let discount = coupon.type === 'percentage' ? (subtotal * Number(coupon.value)) / 100 : Number(coupon.value);
    if (coupon.maximumDiscount)
        discount = Math.min(discount, Number(coupon.maximumDiscount));
    discount = Math.min((0, http_1.money)(discount), subtotal);
    return { discount, code: coupon.code, type: coupon.type, value: Number(coupon.value) };
}
r.post('/validate', auth_1.optionalAuth, (0, validate_1.validateBody)(commerce_1.couponValidateSchema), (0, http_1.asyncHandler)(async (req, res) => {
    const { code, subtotal } = req.body;
    const coupon = await prisma_1.prisma.coupon.findUnique({ where: { code } });
    const result = evaluateCoupon(coupon, subtotal);
    return (0, http_1.ok)(res, { ...result, subtotal, total: (0, http_1.money)(subtotal - result.discount) }, undefined, 'Coupon applied');
}));
r.get('/stats', auth_1.authenticate, auth_1.adminOrStaff, (0, http_1.asyncHandler)(async (_req, res) => {
    const [total, active, inactive, redemptions, discountAgg] = await Promise.all([
        prisma_1.prisma.coupon.count(), prisma_1.prisma.coupon.count({ where: { status: 'active' } }),
        prisma_1.prisma.coupon.count({ where: { status: 'inactive' } }), prisma_1.prisma.couponUsage.count(),
        prisma_1.prisma.couponUsage.aggregate({ _sum: { discountAmount: true } }),
    ]);
    return (0, http_1.ok)(res, { total, active, inactive, redemptions, totalDiscount: (0, http_1.money)(Number(discountAgg._sum.discountAmount ?? 0)) });
}));
r.get('/', auth_1.authenticate, auth_1.adminOrStaff, (0, http_1.asyncHandler)(async (req, res) => {
    const { page, limit, skip } = (0, http_1.getPagination)(req.query);
    const search = String(req.query.search || '');
    const status = req.query.status ? String(req.query.status) : undefined;
    const where = {
        ...(search ? { OR: [{ code: { contains: search, mode: 'insensitive' } }, { description: { contains: search, mode: 'insensitive' } }] } : {}),
        ...(status ? { status } : {}),
    };
    const [items, total] = await Promise.all([
        prisma_1.prisma.coupon.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' }, include: { _count: { select: { usages: true } } } }),
        prisma_1.prisma.coupon.count({ where }),
    ]);
    return (0, http_1.ok)(res, items, (0, http_1.getMeta)(page, limit, total));
}));
r.get('/:id', auth_1.authenticate, auth_1.adminOrStaff, (0, http_1.asyncHandler)(async (req, res) => {
    const coupon = await prisma_1.prisma.coupon.findUnique({
        where: { id: Number(req.params.id) },
        include: {
            usages: {
                orderBy: { createdAt: 'desc' }, take: 50,
                include: { user: { select: { id: true, name: true, email: true } }, order: { select: { id: true, orderNumber: true, grandTotal: true } } },
            },
        },
    });
    if (!coupon)
        throw new http_1.ApiError(404, 'Coupon not found');
    return (0, http_1.ok)(res, coupon);
}));
r.post('/', auth_1.authenticate, auth_1.adminOrStaff, (0, validate_1.validateBody)(commerce_1.couponSchema), (0, http_1.asyncHandler)(async (req, res) => {
    const data = req.body;
    const coupon = await prisma_1.prisma.coupon.create({
        data: {
            code: data.code, description: (0, sanitize_1.sanitizeText)(data.description), type: data.type, value: data.value,
            minimumOrder: data.minimumOrder ?? null, maximumDiscount: data.maximumDiscount ?? null,
            usageLimit: data.usageLimit ?? null, startDate: data.startDate ? new Date(data.startDate) : null,
            endDate: data.endDate ? new Date(data.endDate) : null, status: data.status ?? 'active',
        },
    });
    await (0, audit_1.recordActivity)({ userId: req.user.id, action: 'coupon.created', entity: 'Coupon', entityId: coupon.id, details: `Created coupon ${coupon.code}`, ip: req.ip });
    return (0, http_1.created)(res, coupon, 'Coupon created');
}));
r.put('/:id', auth_1.authenticate, auth_1.adminOrStaff, (0, validate_1.validateBody)(commerce_1.couponSchema.partial()), (0, http_1.asyncHandler)(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma_1.prisma.coupon.findUnique({ where: { id } });
    if (!existing)
        throw new http_1.ApiError(404, 'Coupon not found');
    const data = req.body;
    const coupon = await prisma_1.prisma.coupon.update({
        where: { id },
        data: {
            ...(data.code !== undefined ? { code: data.code } : {}),
            ...(data.description !== undefined ? { description: (0, sanitize_1.sanitizeText)(data.description) } : {}),
            ...(data.type !== undefined ? { type: data.type } : {}),
            ...(data.value !== undefined ? { value: data.value } : {}),
            ...(data.minimumOrder !== undefined ? { minimumOrder: data.minimumOrder } : {}),
            ...(data.maximumDiscount !== undefined ? { maximumDiscount: data.maximumDiscount } : {}),
            ...(data.usageLimit !== undefined ? { usageLimit: data.usageLimit } : {}),
            ...(data.startDate !== undefined ? { startDate: data.startDate ? new Date(data.startDate) : null } : {}),
            ...(data.endDate !== undefined ? { endDate: data.endDate ? new Date(data.endDate) : null } : {}),
            ...(data.status !== undefined ? { status: data.status } : {}),
        },
    });
    await (0, audit_1.recordActivity)({ userId: req.user.id, action: 'coupon.updated', entity: 'Coupon', entityId: id, details: `Updated coupon ${coupon.code}`, ip: req.ip });
    return (0, http_1.ok)(res, coupon, undefined, 'Coupon updated');
}));
r.delete('/:id', auth_1.authenticate, auth_1.adminOrStaff, (0, http_1.asyncHandler)(async (req, res) => {
    const id = Number(req.params.id);
    const coupon = await prisma_1.prisma.coupon.findUnique({ where: { id } });
    if (!coupon)
        throw new http_1.ApiError(404, 'Coupon not found');
    await prisma_1.prisma.coupon.delete({ where: { id } });
    await (0, audit_1.recordActivity)({ userId: req.user.id, action: 'coupon.deleted', entity: 'Coupon', entityId: id, details: `Deleted coupon ${coupon.code}`, ip: req.ip });
    return (0, http_1.ok)(res, null, undefined, 'Coupon deleted');
}));
exports.default = r;
