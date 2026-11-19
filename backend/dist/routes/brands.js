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
r.get('/stats', auth_1.authenticate, auth_1.adminOrStaff, (0, http_1.asyncHandler)(async (_req, res) => {
    const [total, active, inactive, withProducts] = await Promise.all([
        prisma_1.prisma.brand.count(), prisma_1.prisma.brand.count({ where: { status: 'active' } }),
        prisma_1.prisma.brand.count({ where: { status: 'inactive' } }),
        prisma_1.prisma.brand.count({ where: { products: { some: {} } } }),
    ]);
    return (0, http_1.ok)(res, { total, active, inactive, withProducts });
}));
r.get('/', auth_1.optionalAuth, (0, http_1.asyncHandler)(async (req, res) => {
    const { page, limit, skip } = (0, http_1.getPagination)(req.query, 50);
    const search = String(req.query.search || '');
    const status = req.query.status ? String(req.query.status) : undefined;
    const isStaff = !!req.user && ['admin', 'staff'].includes(req.user.role);
    const where = {
        ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { description: { contains: search, mode: 'insensitive' } }] } : {}),
        ...(status && isStaff ? { status } : !isStaff ? { status: 'active' } : {}),
    };
    const [items, total] = await Promise.all([
        prisma_1.prisma.brand.findMany({
            where, skip, take: limit, orderBy: { name: 'asc' },
            include: { _count: { select: { products: true } } },
        }),
        prisma_1.prisma.brand.count({ where }),
    ]);
    return (0, http_1.ok)(res, items, (0, http_1.getMeta)(page, limit, total));
}));
r.get('/:idOrSlug', auth_1.optionalAuth, (0, http_1.asyncHandler)(async (req, res) => {
    const value = req.params.idOrSlug;
    const brand = await prisma_1.prisma.brand.findFirst({
        where: /^\d+$/.test(value) ? { id: Number(value) } : { slug: value },
        include: {
            _count: { select: { products: true } },
            products: {
                where: { status: 'active' }, take: 8, orderBy: { createdAt: 'desc' },
                include: { images: { take: 2, orderBy: { sortOrder: 'asc' } }, category: { select: { name: true } } },
            },
        },
    });
    if (!brand)
        throw new http_1.ApiError(404, 'Brand not found');
    return (0, http_1.ok)(res, brand);
}));
r.post('/', auth_1.authenticate, auth_1.adminOrStaff, (0, validate_1.validateBody)(catalog_1.brandSchema), (0, http_1.asyncHandler)(async (req, res) => {
    const data = req.body;
    let slug = (0, http_1.slugify)(data.slug || data.name);
    if (await prisma_1.prisma.brand.findUnique({ where: { slug } }))
        slug = `${slug}-${Date.now().toString().slice(-4)}`;
    const brand = await prisma_1.prisma.brand.create({
        data: {
            name: (0, sanitize_1.sanitizeText)(data.name), slug, logo: data.logo ?? null,
            description: (0, sanitize_1.sanitizeText)(data.description), status: data.status ?? 'active',
        },
    });
    await (0, audit_1.recordActivity)({ userId: req.user.id, action: 'brand.created', entity: 'Brand', entityId: brand.id, details: `Created brand ${brand.name}`, ip: req.ip });
    return (0, http_1.created)(res, brand, 'Brand created');
}));
r.put('/:id', auth_1.authenticate, auth_1.adminOrStaff, (0, validate_1.validateBody)(catalog_1.brandSchema.partial()), (0, http_1.asyncHandler)(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma_1.prisma.brand.findUnique({ where: { id } });
    if (!existing)
        throw new http_1.ApiError(404, 'Brand not found');
    const data = req.body;
    const brand = await prisma_1.prisma.brand.update({
        where: { id },
        data: {
            ...(data.name !== undefined ? { name: (0, sanitize_1.sanitizeText)(data.name) } : {}),
            ...(data.slug !== undefined ? { slug: (0, http_1.slugify)(data.slug) } : {}),
            ...(data.logo !== undefined ? { logo: data.logo } : {}),
            ...(data.description !== undefined ? { description: (0, sanitize_1.sanitizeText)(data.description) } : {}),
            ...(data.status !== undefined ? { status: data.status } : {}),
        },
    });
    await (0, audit_1.recordActivity)({ userId: req.user.id, action: 'brand.updated', entity: 'Brand', entityId: id, details: `Updated brand ${brand.name}`, ip: req.ip });
    return (0, http_1.ok)(res, brand, undefined, 'Brand updated');
}));
r.delete('/:id', auth_1.authenticate, auth_1.adminOrStaff, (0, http_1.asyncHandler)(async (req, res) => {
    const id = Number(req.params.id);
    const brand = await prisma_1.prisma.brand.findUnique({ where: { id }, include: { _count: { select: { products: true } } } });
    if (!brand)
        throw new http_1.ApiError(404, 'Brand not found');
    if (brand._count.products > 0)
        throw new http_1.ApiError(409, `This brand has ${brand._count.products} product(s). Reassign them before deleting.`);
    await prisma_1.prisma.brand.delete({ where: { id } });
    await (0, audit_1.recordActivity)({ userId: req.user.id, action: 'brand.deleted', entity: 'Brand', entityId: id, details: `Deleted brand ${brand.name}`, ip: req.ip });
    return (0, http_1.ok)(res, null, undefined, 'Brand deleted');
}));
exports.default = r;
