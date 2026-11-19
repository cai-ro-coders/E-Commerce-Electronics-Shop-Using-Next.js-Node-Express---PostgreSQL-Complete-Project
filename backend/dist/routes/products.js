"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const prisma_1 = require("../config/prisma");
const auth_1 = require("../middleware/auth");
const validate_1 = require("../middleware/validate");
const catalog_1 = require("../validators/catalog");
const http_1 = require("../utils/http");
const sanitize_1 = require("../utils/sanitize");
const audit_1 = require("../utils/audit");
const csv_1 = require("../utils/csv");
const upload_1 = require("../middleware/upload");
const r = (0, express_1.Router)();
const listInclude = {
    category: { select: { id: true, name: true, slug: true } },
    brand: { select: { id: true, name: true, slug: true } },
    images: { orderBy: { sortOrder: 'asc' }, take: 3 },
};
const detailInclude = {
    category: true,
    brand: true,
    images: { orderBy: { sortOrder: 'asc' } },
    specifications: { orderBy: { id: 'asc' } },
    reviews: {
        where: { status: 'approved' },
        include: { user: { select: { id: true, name: true, avatar: true } } },
        orderBy: { createdAt: 'desc' },
        take: 20,
    },
};
async function attachRatings(items) {
    if (!items.length)
        return items.map((i) => ({ ...i, rating: 0, reviewCount: 0 }));
    const reviews = await prisma_1.prisma.review.findMany({
        where: { productId: { in: items.map((i) => i.id) }, status: 'approved' },
        select: { productId: true, rating: true },
    });
    const map = new Map();
    for (const rev of reviews) {
        const curr = map.get(rev.productId) ?? { total: 0, count: 0 };
        curr.total += rev.rating;
        curr.count += 1;
        map.set(rev.productId, curr);
    }
    return items.map((item) => {
        const agg = map.get(item.id);
        return { ...item, rating: agg ? Number((agg.total / agg.count).toFixed(1)) : 0, reviewCount: agg?.count ?? 0 };
    });
}
async function resolveRef(value) {
    if (!value)
        return undefined;
    if (/^\d+$/.test(value))
        return Number(value);
    const [category, brand] = await Promise.all([
        prisma_1.prisma.category.findUnique({ where: { slug: value }, select: { id: true } }),
        prisma_1.prisma.brand.findUnique({ where: { slug: value }, select: { id: true } }),
    ]);
    return category?.id ?? brand?.id;
}
async function buildWhere(query, isStaff) {
    const where = {};
    const and = [];
    if (query.search) {
        and.push({
            OR: [
                { name: { contains: query.search, mode: 'insensitive' } },
                { sku: { contains: query.search, mode: 'insensitive' } },
                { shortDescription: { contains: query.search, mode: 'insensitive' } },
                { brand: { name: { contains: query.search, mode: 'insensitive' } } },
                { category: { name: { contains: query.search, mode: 'insensitive' } } },
            ],
        });
    }
    if (query.category) {
        if (/^\d+$/.test(query.category))
            and.push({ categoryId: Number(query.category) });
        else {
            const cat = await prisma_1.prisma.category.findUnique({ where: { slug: query.category }, select: { id: true } });
            if (!cat)
                return { id: -1 };
            and.push({ OR: [{ categoryId: cat.id }, { category: { parentId: cat.id } }] });
        }
    }
    if (query.brand) {
        if (/^\d+$/.test(query.brand))
            and.push({ brandId: Number(query.brand) });
        else {
            const brand = await prisma_1.prisma.brand.findUnique({ where: { slug: query.brand }, select: { id: true } });
            if (!brand)
                return { id: -1 };
            and.push({ brandId: brand.id });
        }
    }
    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
        and.push({ price: { ...(query.minPrice !== undefined ? { gte: query.minPrice } : {}), ...(query.maxPrice !== undefined ? { lte: query.maxPrice } : {}) } });
    }
    if (query.status)
        and.push({ status: query.status });
    else if (!isStaff)
        and.push({ status: 'active' });
    if (query.featured !== undefined)
        and.push({ featured: query.featured });
    if (query.onSale)
        and.push({ salePrice: { not: null } });
    if (query.lowStock) {
        const low = await prisma_1.prisma.$queryRaw `SELECT id FROM products WHERE stock_quantity <= minimum_stock`;
        and.push({ id: { in: low.map((l) => l.id) } });
    }
    if (and.length)
        where.AND = and;
    return where;
}
function orderByFor(sort, sortBy, sortDir) {
    if (sortBy)
        return { [sortBy]: sortDir ?? 'desc' };
    switch (sort) {
        case 'oldest': return { createdAt: 'asc' };
        case 'price_asc': return { price: 'asc' };
        case 'price_desc': return { price: 'desc' };
        case 'name_asc': return { name: 'asc' };
        case 'popular': return { views: 'desc' };
        default: return { createdAt: 'desc' };
    }
}
r.get('/stats', auth_1.authenticate, auth_1.adminOrStaff, (0, http_1.asyncHandler)(async (_req, res) => {
    const [products, total, active, draft, inactive, lowStock, categories, brands] = await Promise.all([
        prisma_1.prisma.product.findMany({ select: { stockQuantity: true, costPrice: true, price: true } }),
        prisma_1.prisma.product.count(),
        prisma_1.prisma.product.count({ where: { status: 'active' } }),
        prisma_1.prisma.product.count({ where: { status: 'draft' } }),
        prisma_1.prisma.product.count({ where: { status: 'inactive' } }),
        prisma_1.prisma.$queryRaw `SELECT COUNT(*)::bigint AS count FROM products WHERE stock_quantity <= minimum_stock`,
        prisma_1.prisma.category.count(),
        prisma_1.prisma.brand.count(),
    ]);
    const low = Number(lowStock[0]?.count ?? 0);
    const inventoryUnits = products.reduce((s, p) => s + p.stockQuantity, 0);
    const inventoryValue = products.reduce((s, p) => s + p.stockQuantity * Number(p.costPrice ?? Number(p.price) * 0.7), 0);
    const outOfStock = products.filter((p) => p.stockQuantity === 0).length;
    return (0, http_1.ok)(res, { totalProducts: total, active, draft, inactive, lowStock: low, outOfStock, inventoryUnits, inventoryValue: Number(inventoryValue.toFixed(2)), categories, brands });
}));
r.get('/export', auth_1.authenticate, auth_1.adminOrStaff, (0, http_1.asyncHandler)(async (req, res) => {
    const isStaff = true;
    const where = await buildWhere(req.query, isStaff);
    const items = await prisma_1.prisma.product.findMany({ where, include: listInclude, orderBy: { createdAt: 'desc' } });
    const rows = items.map((p) => ({
        id: p.id, sku: p.sku, name: p.name, category: p.category?.name ?? '', brand: p.brand?.name ?? '',
        price: Number(p.price), sale_price: p.salePrice ? Number(p.salePrice) : '', cost_price: p.costPrice ? Number(p.costPrice) : '',
        stock_quantity: p.stockQuantity, minimum_stock: p.minimumStock, status: p.status, featured: p.featured,
        created_at: p.createdAt.toISOString(),
    }));
    if (String(req.query.format) === 'json') {
        res.setHeader('Content-Disposition', 'attachment; filename="products.json"');
        return res.json(rows);
    }
    return (0, csv_1.sendCsv)(res, 'products.csv', (0, csv_1.toCsv)(rows));
}));
r.get('/', auth_1.optionalAuth, (0, validate_1.validateQuery)(catalog_1.productQuery), (0, http_1.asyncHandler)(async (req, res) => {
    const query = req.query;
    const isStaff = !!req.user && ['admin', 'staff'].includes(req.user.role);
    const { page, limit, skip } = (0, http_1.getPagination)(query);
    const where = await buildWhere(query, isStaff);
    const orderBy = orderByFor(query.sort, query.sortBy, query.sortDir);
    if (query.sort === 'rating') {
        const all = await prisma_1.prisma.product.findMany({ where, include: listInclude });
        const rated = await attachRatings(all);
        rated.sort((a, b) => b.rating - a.rating);
        const items = rated.slice(skip, skip + limit);
        return (0, http_1.ok)(res, items, (0, http_1.getMeta)(page, limit, rated.length));
    }
    const [items, total] = await Promise.all([
        prisma_1.prisma.product.findMany({ where, skip, take: limit, include: listInclude, orderBy }),
        prisma_1.prisma.product.count({ where }),
    ]);
    return (0, http_1.ok)(res, await attachRatings(items), (0, http_1.getMeta)(page, limit, total));
}));
r.get('/:idOrSlug', auth_1.optionalAuth, (0, http_1.asyncHandler)(async (req, res) => {
    const value = req.params.idOrSlug;
    const isStaff = !!req.user && ['admin', 'staff'].includes(req.user.role);
    const where = /^\d+$/.test(value) ? { id: Number(value) } : { slug: value };
    const product = await prisma_1.prisma.product.findFirst({ where, include: detailInclude });
    if (!product)
        throw new http_1.ApiError(404, 'Product not found');
    if (product.status !== 'active' && !isStaff)
        throw new http_1.ApiError(404, 'Product not found');
    const related = await prisma_1.prisma.product.findMany({
        where: { categoryId: product.categoryId, status: 'active', id: { not: product.id } },
        include: listInclude, take: 4, orderBy: { views: 'desc' },
    });
    prisma_1.prisma.product.update({ where: { id: product.id }, data: { views: { increment: 1 } } }).catch(() => undefined);
    const [rated] = await attachRatings([product]);
    return (0, http_1.ok)(res, { ...rated, related: await attachRatings(related) });
}));
r.post('/', auth_1.authenticate, auth_1.adminOrStaff, (0, validate_1.validateBody)(catalog_1.productSchema), (0, http_1.asyncHandler)(async (req, res) => {
    const data = req.body;
    if (data.salePrice != null && Number(data.salePrice) > Number(data.price))
        throw new http_1.ApiError(400, 'Sale price cannot be higher than the regular price');
    if (data.costPrice != null && Number(data.costPrice) > Number(data.price))
        throw new http_1.ApiError(400, 'Cost price cannot be higher than the selling price');
    let slug = (0, http_1.slugify)(data.slug || data.name);
    const existingSlug = await prisma_1.prisma.product.findUnique({ where: { slug } });
    if (existingSlug)
        slug = `${slug}-${Date.now().toString().slice(-5)}`;
    const sku = data.sku?.toUpperCase() || `ELEC-${Date.now().toString().slice(-8)}`;
    if (await prisma_1.prisma.product.findUnique({ where: { sku } }))
        throw new http_1.ApiError(409, 'A product with this SKU already exists');
    const images = (data.images ?? []).map((im, i) => ({ image: im.image, isPrimary: !!im.isPrimary || i === 0, sortOrder: im.sortOrder ?? i }));
    if (images.length && !images.some((im) => im.isPrimary))
        images[0].isPrimary = true;
    const product = await prisma_1.prisma.product.create({
        data: {
            name: (0, sanitize_1.sanitizeText)(data.name),
            slug,
            sku,
            categoryId: data.categoryId,
            brandId: data.brandId,
            shortDescription: (0, sanitize_1.sanitizeText)(data.shortDescription),
            description: (0, sanitize_1.sanitizeHtml)(data.description),
            price: data.price,
            salePrice: data.salePrice ?? null,
            costPrice: data.costPrice ?? null,
            weight: (0, sanitize_1.sanitizeText)(data.weight),
            dimensions: (0, sanitize_1.sanitizeText)(data.dimensions),
            stockQuantity: data.stockQuantity ?? 0,
            minimumStock: data.minimumStock ?? 5,
            featured: !!data.featured,
            status: data.status ?? 'active',
            images: { create: images },
            specifications: { create: (data.specifications ?? []).map((s) => ({ attributeName: (0, sanitize_1.sanitizeText)(s.attributeName), attributeValue: (0, sanitize_1.sanitizeText)(s.attributeValue) })) },
        },
        include: detailInclude,
    });
    if (product.stockQuantity > 0) {
        await prisma_1.prisma.inventoryLog.create({ data: { productId: product.id, type: 'stock_in', quantity: product.stockQuantity, reference: 'PRODUCT-CREATE', remarks: 'Initial stock on product creation' } });
    }
    await (0, audit_1.recordActivity)({ userId: req.user.id, action: 'product.created', entity: 'Product', entityId: product.id, details: `Created product ${product.name}`, ip: req.ip });
    await (0, audit_1.notify)({ userId: null, title: 'New product added', message: `${product.name} was added to the catalog.`, type: 'system', link: `/admin/products/${product.id}` });
    return (0, http_1.created)(res, product, 'Product created');
}));
r.put('/:id', auth_1.authenticate, auth_1.adminOrStaff, (0, validate_1.validateBody)(catalog_1.productUpdateSchema), (0, http_1.asyncHandler)(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma_1.prisma.product.findUnique({ where: { id }, include: { images: true } });
    if (!existing)
        throw new http_1.ApiError(404, 'Product not found');
    const data = req.body;
    if (data.price !== undefined || data.salePrice !== undefined) {
        const price = data.price ?? Number(existing.price);
        if (data.salePrice != null && Number(data.salePrice) > Number(price))
            throw new http_1.ApiError(400, 'Sale price cannot be higher than the regular price');
    }
    if (data.salePrice !== undefined && data.salePrice !== null && Number(data.salePrice) > Number(data.price ?? existing.price)) {
        throw new http_1.ApiError(400, 'Sale price cannot be higher than the regular price');
    }
    const payload = {};
    if (data.name !== undefined)
        payload.name = (0, sanitize_1.sanitizeText)(data.name);
    if (data.slug !== undefined)
        payload.slug = (0, http_1.slugify)(data.slug);
    if (data.sku !== undefined)
        payload.sku = data.sku.toUpperCase();
    if (data.categoryId !== undefined)
        payload.category = { connect: { id: data.categoryId } };
    if (data.brandId !== undefined)
        payload.brand = { connect: { id: data.brandId } };
    if (data.shortDescription !== undefined)
        payload.shortDescription = (0, sanitize_1.sanitizeText)(data.shortDescription);
    if (data.description !== undefined)
        payload.description = (0, sanitize_1.sanitizeHtml)(data.description);
    if (data.price !== undefined)
        payload.price = data.price;
    if (data.salePrice !== undefined)
        payload.salePrice = data.salePrice;
    if (data.costPrice !== undefined)
        payload.costPrice = data.costPrice;
    if (data.weight !== undefined)
        payload.weight = (0, sanitize_1.sanitizeText)(data.weight);
    if (data.dimensions !== undefined)
        payload.dimensions = (0, sanitize_1.sanitizeText)(data.dimensions);
    if (data.minimumStock !== undefined)
        payload.minimumStock = data.minimumStock;
    if (data.featured !== undefined)
        payload.featured = !!data.featured;
    if (data.status !== undefined)
        payload.status = data.status;
    if (data.stockQuantity !== undefined && data.stockQuantity !== existing.stockQuantity) {
        const diff = data.stockQuantity - existing.stockQuantity;
        payload.stockQuantity = data.stockQuantity;
        await prisma_1.prisma.inventoryLog.create({
            data: { productId: id, type: diff > 0 ? 'stock_in' : 'stock_out', quantity: Math.abs(diff), reference: 'PRODUCT-UPDATE', remarks: `Stock updated from ${existing.stockQuantity} to ${data.stockQuantity}` },
        });
    }
    await prisma_1.prisma.product.update({ where: { id }, data: payload });
    if (Array.isArray(data.images)) {
        await prisma_1.prisma.productImage.deleteMany({ where: { productId: id } });
        if (data.images.length) {
            const images = data.images.map((im, i) => ({ productId: id, image: im.image, isPrimary: !!im.isPrimary || i === 0, sortOrder: im.sortOrder ?? i }));
            if (!images.some((im) => im.isPrimary))
                images[0].isPrimary = true;
            await prisma_1.prisma.productImage.createMany({ data: images });
        }
    }
    if (Array.isArray(data.specifications)) {
        await prisma_1.prisma.productSpecification.deleteMany({ where: { productId: id } });
        if (data.specifications.length) {
            await prisma_1.prisma.productSpecification.createMany({ data: data.specifications.map((s) => ({ productId: id, attributeName: (0, sanitize_1.sanitizeText)(s.attributeName), attributeValue: (0, sanitize_1.sanitizeText)(s.attributeValue) })) });
        }
    }
    const full = await prisma_1.prisma.product.findUnique({ where: { id }, include: detailInclude });
    await (0, audit_1.recordActivity)({ userId: req.user.id, action: 'product.updated', entity: 'Product', entityId: id, details: `Updated product ${full?.name}`, ip: req.ip });
    return (0, http_1.ok)(res, full, undefined, 'Product updated');
}));
r.patch('/:id/status', auth_1.authenticate, auth_1.adminOrStaff, (0, http_1.asyncHandler)(async (req, res) => {
    const id = Number(req.params.id);
    const status = String(req.body.status || '');
    if (!['active', 'draft', 'inactive'].includes(status))
        throw new http_1.ApiError(400, 'Invalid status');
    const product = await prisma_1.prisma.product.update({ where: { id }, data: { status } });
    await (0, audit_1.recordActivity)({ userId: req.user.id, action: 'product.status_changed', entity: 'Product', entityId: id, details: `Set product status to ${status}`, ip: req.ip });
    return (0, http_1.ok)(res, product, undefined, `Product marked ${status}`);
}));
r.delete('/:id', auth_1.authenticate, auth_1.adminOrStaff, (0, http_1.asyncHandler)(async (req, res) => {
    const id = Number(req.params.id);
    const product = await prisma_1.prisma.product.findUnique({ where: { id }, include: { images: true } });
    if (!product)
        throw new http_1.ApiError(404, 'Product not found');
    for (const im of product.images) {
        if (im.image.startsWith('/uploads/')) {
            const filePath = path_1.default.join(upload_1.uploadDir, path_1.default.basename(im.image));
            if (fs_1.default.existsSync(filePath))
                fs_1.default.unlinkSync(filePath);
        }
    }
    await prisma_1.prisma.product.delete({ where: { id } });
    await (0, audit_1.recordActivity)({ userId: req.user.id, action: 'product.deleted', entity: 'Product', entityId: id, details: `Deleted product ${product.name}`, ip: req.ip });
    return (0, http_1.ok)(res, null, undefined, 'Product deleted');
}));
exports.default = r;
