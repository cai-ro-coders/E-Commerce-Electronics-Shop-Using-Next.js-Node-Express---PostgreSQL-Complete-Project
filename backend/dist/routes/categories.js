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
        prisma_1.prisma.category.count(), prisma_1.prisma.category.count({ where: { status: 'active' } }),
        prisma_1.prisma.category.count({ where: { status: 'inactive' } }),
        prisma_1.prisma.category.count({ where: { products: { some: {} } } }),
    ]);
    return (0, http_1.ok)(res, { total, active, inactive, withProducts, empty: total - withProducts });
}));
r.get('/', auth_1.optionalAuth, (0, http_1.asyncHandler)(async (req, res) => {
    const { page, limit, skip } = (0, http_1.getPagination)(req.query, 50);
    const search = String(req.query.search || '');
    const status = req.query.status ? String(req.query.status) : undefined;
    const isStaff = !!req.user && ['admin', 'staff'].includes(req.user.role);
    const where = {
        ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { description: { contains: search, mode: 'insensitive' } }] } : {}),
        ...(status && isStaff ? { status } : !isStaff ? { status: 'active' } : {}),
        ...(req.query.parentId ? { parentId: req.query.parentId === 'null' ? null : Number(req.query.parentId) } : {}),
    };
    const [items, total] = await Promise.all([
        prisma_1.prisma.category.findMany({
            where, skip, take: limit, orderBy: [{ parentId: 'asc' }, { name: 'asc' }],
            include: {
                parent: { select: { id: true, name: true } },
                _count: { select: { products: true, children: true } },
            },
        }),
        prisma_1.prisma.category.count({ where }),
    ]);
    return (0, http_1.ok)(res, items, (0, http_1.getMeta)(page, limit, total));
}));
r.get('/:idOrSlug', auth_1.optionalAuth, (0, http_1.asyncHandler)(async (req, res) => {
    const value = req.params.idOrSlug;
    const category = await prisma_1.prisma.category.findFirst({
        where: /^\d+$/.test(value) ? { id: Number(value) } : { slug: value },
        include: {
            parent: true,
            children: { include: { _count: { select: { products: true } } } },
            _count: { select: { products: true } },
            products: {
                where: { status: 'active' }, take: 8, orderBy: { createdAt: 'desc' },
                include: { images: { take: 2, orderBy: { sortOrder: 'asc' } }, brand: { select: { name: true } } },
            },
        },
    });
    if (!category)
        throw new http_1.ApiError(404, 'Category not found');
    return (0, http_1.ok)(res, category);
}));
r.post('/', auth_1.authenticate, auth_1.adminOrStaff, (0, validate_1.validateBody)(catalog_1.categorySchema), (0, http_1.asyncHandler)(async (req, res) => {
    const data = req.body;
    let slug = (0, http_1.slugify)(data.slug || data.name);
    if (await prisma_1.prisma.category.findUnique({ where: { slug } }))
        slug = `${slug}-${Date.now().toString().slice(-4)}`;
    if (data.parentId) {
        const parent = await prisma_1.prisma.category.findUnique({ where: { id: data.parentId } });
        if (!parent)
            throw new http_1.ApiError(400, 'Parent category not found');
    }
    const category = await prisma_1.prisma.category.create({
        data: {
            name: (0, sanitize_1.sanitizeText)(data.name), slug, parentId: data.parentId ?? null,
            image: data.image ?? null, description: (0, sanitize_1.sanitizeText)(data.description), status: data.status ?? 'active',
        },
    });
    await (0, audit_1.recordActivity)({ userId: req.user.id, action: 'category.created', entity: 'Category', entityId: category.id, details: `Created category ${category.name}`, ip: req.ip });
    return (0, http_1.created)(res, category, 'Category created');
}));
r.put('/:id', auth_1.authenticate, auth_1.adminOrStaff, (0, validate_1.validateBody)(catalog_1.categorySchema.partial()), (0, http_1.asyncHandler)(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma_1.prisma.category.findUnique({ where: { id } });
    if (!existing)
        throw new http_1.ApiError(404, 'Category not found');
    const data = req.body;
    if (data.parentId === id)
        throw new http_1.ApiError(400, 'A category cannot be its own parent');
    if (data.parentId) {
        const parent = await prisma_1.prisma.category.findUnique({ where: { id: data.parentId } });
        if (!parent)
            throw new http_1.ApiError(400, 'Parent category not found');
    }
    const category = await prisma_1.prisma.category.update({
        where: { id },
        data: {
            ...(data.name !== undefined ? { name: (0, sanitize_1.sanitizeText)(data.name) } : {}),
            ...(data.slug !== undefined ? { slug: (0, http_1.slugify)(data.slug) } : {}),
            ...(data.parentId !== undefined ? { parentId: data.parentId } : {}),
            ...(data.image !== undefined ? { image: data.image } : {}),
            ...(data.description !== undefined ? { description: (0, sanitize_1.sanitizeText)(data.description) } : {}),
            ...(data.status !== undefined ? { status: data.status } : {}),
        },
    });
    await (0, audit_1.recordActivity)({ userId: req.user.id, action: 'category.updated', entity: 'Category', entityId: id, details: `Updated category ${category.name}`, ip: req.ip });
    return (0, http_1.ok)(res, category, undefined, 'Category updated');
}));
r.delete('/:id', auth_1.authenticate, auth_1.adminOrStaff, (0, http_1.asyncHandler)(async (req, res) => {
    const id = Number(req.params.id);
    const category = await prisma_1.prisma.category.findUnique({ where: { id }, include: { _count: { select: { products: true, children: true } } } });
    if (!category)
        throw new http_1.ApiError(404, 'Category not found');
    if (category._count.products > 0)
        throw new http_1.ApiError(409, `This category contains ${category._count.products} product(s). Reassign them before deleting.`);
    if (category._count.children > 0)
        throw new http_1.ApiError(409, 'This category has subcategories. Move or delete them first.');
    await prisma_1.prisma.category.delete({ where: { id } });
    await (0, audit_1.recordActivity)({ userId: req.user.id, action: 'category.deleted', entity: 'Category', entityId: id, details: `Deleted category ${category.name}`, ip: req.ip });
    return (0, http_1.ok)(res, null, undefined, 'Category deleted');
}));
exports.default = r;
