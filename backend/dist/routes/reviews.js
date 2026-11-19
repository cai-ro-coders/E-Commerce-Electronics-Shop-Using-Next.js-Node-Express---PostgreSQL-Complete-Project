"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../config/prisma");
const auth_1 = require("../middleware/auth");
const validate_1 = require("../middleware/validate");
const catalog_1 = require("../validators/catalog");
const http_1 = require("../utils/http");
const sanitize_1 = require("../utils/sanitize");
const audit_1 = require("../utils/audit");
const r = (0, express_1.Router)();
const reviewInclude = {
    user: { select: { id: true, name: true, email: true, avatar: true } },
    product: { select: { id: true, name: true, slug: true, sku: true, images: { take: 1, orderBy: { sortOrder: 'asc' } } } },
};
r.get('/stats', auth_1.authenticate, auth_1.adminOrStaff, (0, http_1.asyncHandler)(async (_req, res) => {
    const [total, pending, approved, rejected, avg, dist] = await Promise.all([
        prisma_1.prisma.review.count(), prisma_1.prisma.review.count({ where: { status: 'pending' } }),
        prisma_1.prisma.review.count({ where: { status: 'approved' } }), prisma_1.prisma.review.count({ where: { status: 'rejected' } }),
        prisma_1.prisma.review.aggregate({ _avg: { rating: true } }),
        prisma_1.prisma.review.groupBy({ by: ['rating'], _count: { _all: true } }),
    ]);
    const distribution = [5, 4, 3, 2, 1].map((star) => ({
        star, count: dist.find((d) => d.rating === star)?._count._all ?? 0,
    }));
    return (0, http_1.ok)(res, { total, pending, approved, rejected, averageRating: (0, http_1.money)(Number(avg._avg.rating ?? 0)), distribution });
}));
r.get('/', auth_1.optionalAuth, (0, validate_1.validateQuery)(catalog_1.reviewQuery), (0, http_1.asyncHandler)(async (req, res) => {
    const query = req.query;
    const { page, limit, skip } = (0, http_1.getPagination)(query);
    const isStaff = !!req.user && ['admin', 'staff'].includes(req.user.role);
    const where = {
        ...(query.productId ? { productId: query.productId } : {}),
        ...(query.rating ? { rating: query.rating } : {}),
        ...(query.status && isStaff ? { status: query.status } : !isStaff ? { status: 'approved' } : {}),
        ...(query.search ? { OR: [
                { title: { contains: query.search, mode: 'insensitive' } },
                { comment: { contains: query.search, mode: 'insensitive' } },
                { user: { name: { contains: query.search, mode: 'insensitive' } } },
                { product: { name: { contains: query.search, mode: 'insensitive' } } },
            ] } : {}),
    };
    const [items, total] = await Promise.all([
        prisma_1.prisma.review.findMany({ where, skip, take: limit, include: reviewInclude, orderBy: { createdAt: 'desc' } }),
        prisma_1.prisma.review.count({ where }),
    ]);
    return (0, http_1.ok)(res, items, (0, http_1.getMeta)(page, limit, total));
}));
r.post('/', auth_1.authenticate, (0, validate_1.validateBody)(catalog_1.reviewSchema), (0, http_1.asyncHandler)(async (req, res) => {
    const { productId, rating, title, comment } = req.body;
    const product = await prisma_1.prisma.product.findUnique({ where: { id: productId } });
    if (!product)
        throw new http_1.ApiError(404, 'Product not found');
    const existing = await prisma_1.prisma.review.findFirst({ where: { productId, userId: req.user.id } });
    if (existing)
        throw new http_1.ApiError(409, 'You have already reviewed this product');
    const review = await prisma_1.prisma.review.create({
        data: {
            productId, userId: req.user.id, rating,
            title: (0, sanitize_1.sanitizeText)(title), comment: (0, sanitize_1.sanitizeText)(comment), status: 'pending',
        },
        include: reviewInclude,
    });
    await (0, audit_1.notify)({ userId: null, title: 'New review awaiting moderation', message: `${review.user.name} left a ${rating}-star review on ${product.name}.`, type: 'review', link: '/admin/reviews' });
    await (0, audit_1.recordActivity)({ userId: req.user.id, action: 'review.created', entity: 'Review', entityId: review.id, details: `Reviewed ${product.name}`, ip: req.ip });
    return (0, http_1.created)(res, review, 'Thank you! Your review is awaiting moderation.');
}));
r.put('/:id', auth_1.authenticate, auth_1.adminOrStaff, (0, validate_1.validateBody)(catalog_1.reviewUpdateSchema), (0, http_1.asyncHandler)(async (req, res) => {
    const id = Number(req.params.id);
    const review = await prisma_1.prisma.review.update({
        where: { id },
        data: {
            ...(req.body.rating !== undefined ? { rating: req.body.rating } : {}),
            ...(req.body.title !== undefined ? { title: (0, sanitize_1.sanitizeText)(req.body.title) } : {}),
            ...(req.body.comment !== undefined ? { comment: (0, sanitize_1.sanitizeText)(req.body.comment) } : {}),
            ...(req.body.status !== undefined ? { status: req.body.status } : {}),
        },
        include: reviewInclude,
    });
    await (0, audit_1.recordActivity)({ userId: req.user.id, action: 'review.updated', entity: 'Review', entityId: id, details: `Updated review #${id}`, ip: req.ip });
    return (0, http_1.ok)(res, review, undefined, 'Review updated');
}));
r.patch('/:id/status', auth_1.authenticate, auth_1.adminOrStaff, (0, http_1.asyncHandler)(async (req, res) => {
    const status = String(req.body.status || '');
    if (!['pending', 'approved', 'rejected'].includes(status))
        throw new http_1.ApiError(400, 'Invalid review status');
    const id = Number(req.params.id);
    const review = await prisma_1.prisma.review.update({ where: { id }, data: { status }, include: reviewInclude });
    await (0, audit_1.recordActivity)({ userId: req.user.id, action: `review.${status}`, entity: 'Review', entityId: id, details: `Set review status to ${status}`, ip: req.ip });
    return (0, http_1.ok)(res, review, undefined, `Review ${status}`);
}));
r.delete('/:id', auth_1.authenticate, auth_1.adminOrStaff, (0, http_1.asyncHandler)(async (req, res) => {
    const id = Number(req.params.id);
    await prisma_1.prisma.review.delete({ where: { id } });
    await (0, audit_1.recordActivity)({ userId: req.user.id, action: 'review.deleted', entity: 'Review', entityId: id, details: `Deleted review #${id}`, ip: req.ip });
    return (0, http_1.ok)(res, null, undefined, 'Review deleted');
}));
exports.default = r;
