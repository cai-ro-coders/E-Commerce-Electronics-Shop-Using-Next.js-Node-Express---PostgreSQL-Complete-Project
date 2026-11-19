import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { authenticate, optionalAuth, AuthRequest, adminOrStaff } from '../middleware/auth';
import { validateBody, validateQuery } from '../middleware/validate';
import { productQuery, productSchema, productUpdateSchema } from '../validators/catalog';
import { ApiError, asyncHandler, ok, created, getPagination, getMeta, slugify, toBoolean, toNumber } from '../utils/http';
import { sanitizeHtml, sanitizeText } from '../utils/sanitize';
import { recordActivity, notify } from '../utils/audit';
import { sendCsv, toCsv } from '../utils/csv';
import { uploadDir } from '../middleware/upload';

const r = Router();

const listInclude = {
  category: { select: { id: true, name: true, slug: true } },
  brand: { select: { id: true, name: true, slug: true } },
  images: { orderBy: { sortOrder: 'asc' as const }, take: 3 },
} satisfies Prisma.ProductInclude;

const detailInclude = {
  category: true,
  brand: true,
  images: { orderBy: { sortOrder: 'asc' as const } },
  specifications: { orderBy: { id: 'asc' as const } },
  reviews: {
    where: { status: 'approved' },
    include: { user: { select: { id: true, name: true, avatar: true } } },
    orderBy: { createdAt: 'desc' as const },
    take: 20,
  },
} satisfies Prisma.ProductInclude;

async function attachRatings<T extends { id: number }>(items: T[]) {
  if (!items.length) return items.map((i) => ({ ...i, rating: 0, reviewCount: 0 }));
  const reviews = await prisma.review.findMany({
    where: { productId: { in: items.map((i) => i.id) }, status: 'approved' },
    select: { productId: true, rating: true },
  });
  const map = new Map<number, { total: number; count: number }>();
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

async function resolveRef(value?: string) {
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value);
  const [category, brand] = await Promise.all([
    prisma.category.findUnique({ where: { slug: value }, select: { id: true } }),
    prisma.brand.findUnique({ where: { slug: value }, select: { id: true } }),
  ]);
  return category?.id ?? brand?.id;
}

async function buildWhere(query: any, isStaff: boolean): Promise<Prisma.ProductWhereInput> {
  const where: Prisma.ProductWhereInput = {};
  const and: Prisma.ProductWhereInput[] = [];
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
    if (/^\d+$/.test(query.category)) and.push({ categoryId: Number(query.category) });
    else {
      const cat = await prisma.category.findUnique({ where: { slug: query.category }, select: { id: true } });
      if (!cat) return { id: -1 };
      and.push({ OR: [{ categoryId: cat.id }, { category: { parentId: cat.id } }] });
    }
  }
  if (query.brand) {
    if (/^\d+$/.test(query.brand)) and.push({ brandId: Number(query.brand) });
    else {
      const brand = await prisma.brand.findUnique({ where: { slug: query.brand }, select: { id: true } });
      if (!brand) return { id: -1 };
      and.push({ brandId: brand.id });
    }
  }
  if (query.minPrice !== undefined || query.maxPrice !== undefined) {
    and.push({ price: { ...(query.minPrice !== undefined ? { gte: query.minPrice } : {}), ...(query.maxPrice !== undefined ? { lte: query.maxPrice } : {}) } });
  }
  if (query.status) and.push({ status: query.status });
  else if (!isStaff) and.push({ status: 'active' });
  if (query.featured !== undefined) and.push({ featured: query.featured });
  if (query.onSale) and.push({ salePrice: { not: null } });
  if (query.lowStock) {
    const low = await prisma.$queryRaw<{ id: number }[]>`SELECT id FROM products WHERE stock_quantity <= minimum_stock`;
    and.push({ id: { in: low.map((l) => l.id) } });
  }
  if (and.length) where.AND = and;
  return where;
}

function orderByFor(sort: string, sortBy?: string, sortDir?: 'asc' | 'desc'): Prisma.ProductOrderByWithRelationInput {
  if (sortBy) return { [sortBy]: sortDir ?? 'desc' } as Prisma.ProductOrderByWithRelationInput;
  switch (sort) {
    case 'oldest': return { createdAt: 'asc' };
    case 'price_asc': return { price: 'asc' };
    case 'price_desc': return { price: 'desc' };
    case 'name_asc': return { name: 'asc' };
    case 'popular': return { views: 'desc' };
    default: return { createdAt: 'desc' };
  }
}

r.get('/stats', authenticate, adminOrStaff, asyncHandler(async (_req, res) => {
  const [products, total, active, draft, inactive, lowStock, categories, brands] = await Promise.all([
    prisma.product.findMany({ select: { stockQuantity: true, costPrice: true, price: true } }),
    prisma.product.count(),
    prisma.product.count({ where: { status: 'active' } }),
    prisma.product.count({ where: { status: 'draft' } }),
    prisma.product.count({ where: { status: 'inactive' } }),
    prisma.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*)::bigint AS count FROM products WHERE stock_quantity <= minimum_stock`,
    prisma.category.count(),
    prisma.brand.count(),
  ]);
  const low = Number(lowStock[0]?.count ?? 0);
  const inventoryUnits = products.reduce((s, p) => s + p.stockQuantity, 0);
  const inventoryValue = products.reduce((s, p) => s + p.stockQuantity * Number(p.costPrice ?? Number(p.price) * 0.7), 0);
  const outOfStock = products.filter((p) => p.stockQuantity === 0).length;
  return ok(res, { totalProducts: total, active, draft, inactive, lowStock: low, outOfStock, inventoryUnits, inventoryValue: Number(inventoryValue.toFixed(2)), categories, brands });
}));

r.get('/export', authenticate, adminOrStaff, asyncHandler(async (req, res) => {
  const isStaff = true;
  const where = await buildWhere(req.query, isStaff);
  const items = await prisma.product.findMany({ where, include: listInclude, orderBy: { createdAt: 'desc' } });
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
  return sendCsv(res, 'products.csv', toCsv(rows as any));
}));

r.get('/', optionalAuth, validateQuery(productQuery), asyncHandler(async (req: AuthRequest, res) => {
  const query = req.query as any;
  const isStaff = !!req.user && ['admin', 'staff'].includes(req.user.role);
  const { page, limit, skip } = getPagination(query);
  const where = await buildWhere(query, isStaff);
  const orderBy = orderByFor(query.sort, query.sortBy, query.sortDir);

  if (query.sort === 'rating') {
    const all = await prisma.product.findMany({ where, include: listInclude });
    const rated = await attachRatings(all);
    rated.sort((a: any, b: any) => b.rating - a.rating);
    const items = rated.slice(skip, skip + limit);
    return ok(res, items, getMeta(page, limit, rated.length));
  }

  const [items, total] = await Promise.all([
    prisma.product.findMany({ where, skip, take: limit, include: listInclude, orderBy }),
    prisma.product.count({ where }),
  ]);
  return ok(res, await attachRatings(items), getMeta(page, limit, total));
}));

r.get('/:idOrSlug', optionalAuth, asyncHandler(async (req: AuthRequest, res) => {
  const value = req.params.idOrSlug;
  const isStaff = !!req.user && ['admin', 'staff'].includes(req.user.role);
  const where: Prisma.ProductWhereInput = /^\d+$/.test(value) ? { id: Number(value) } : { slug: value };
  const product = await prisma.product.findFirst({ where, include: detailInclude });
  if (!product) throw new ApiError(404, 'Product not found');
  if (product.status !== 'active' && !isStaff) throw new ApiError(404, 'Product not found');

  const related = await prisma.product.findMany({
    where: { categoryId: product.categoryId, status: 'active', id: { not: product.id } },
    include: listInclude, take: 4, orderBy: { views: 'desc' },
  });

  prisma.product.update({ where: { id: product.id }, data: { views: { increment: 1 } } }).catch(() => undefined);
  const [rated] = await attachRatings([product]);
  return ok(res, { ...rated, related: await attachRatings(related) });
}));

r.post('/', authenticate, adminOrStaff, validateBody(productSchema), asyncHandler(async (req: AuthRequest, res) => {
  const data = req.body;
  if (data.salePrice != null && Number(data.salePrice) > Number(data.price)) throw new ApiError(400, 'Sale price cannot be higher than the regular price');
  if (data.costPrice != null && Number(data.costPrice) > Number(data.price)) throw new ApiError(400, 'Cost price cannot be higher than the selling price');

  let slug = slugify(data.slug || data.name);
  const existingSlug = await prisma.product.findUnique({ where: { slug } });
  if (existingSlug) slug = `${slug}-${Date.now().toString().slice(-5)}`;
  const sku = data.sku?.toUpperCase() || `ELEC-${Date.now().toString().slice(-8)}`;
  if (await prisma.product.findUnique({ where: { sku } })) throw new ApiError(409, 'A product with this SKU already exists');

  const images = (data.images ?? []).map((im: any, i: number) => ({ image: im.image, isPrimary: !!im.isPrimary || i === 0, sortOrder: im.sortOrder ?? i }));
  if (images.length && !images.some((im: any) => im.isPrimary)) images[0].isPrimary = true;

  const product = await prisma.product.create({
    data: {
      name: sanitizeText(data.name)!,
      slug,
      sku,
      categoryId: data.categoryId,
      brandId: data.brandId,
      shortDescription: sanitizeText(data.shortDescription),
      description: sanitizeHtml(data.description),
      price: data.price,
      salePrice: data.salePrice ?? null,
      costPrice: data.costPrice ?? null,
      weight: sanitizeText(data.weight),
      dimensions: sanitizeText(data.dimensions),
      stockQuantity: data.stockQuantity ?? 0,
      minimumStock: data.minimumStock ?? 5,
      featured: !!data.featured,
      status: data.status ?? 'active',
      images: { create: images },
      specifications: { create: (data.specifications ?? []).map((s: any) => ({ attributeName: sanitizeText(s.attributeName)!, attributeValue: sanitizeText(s.attributeValue)! })) },
    },
    include: detailInclude,
  });

  if (product.stockQuantity > 0) {
    await prisma.inventoryLog.create({ data: { productId: product.id, type: 'stock_in', quantity: product.stockQuantity, reference: 'PRODUCT-CREATE', remarks: 'Initial stock on product creation' } });
  }
  await recordActivity({ userId: req.user!.id, action: 'product.created', entity: 'Product', entityId: product.id, details: `Created product ${product.name}`, ip: req.ip });
  await notify({ userId: null, title: 'New product added', message: `${product.name} was added to the catalog.`, type: 'system', link: `/admin/products/${product.id}` });
  return created(res, product, 'Product created');
}));

r.put('/:id', authenticate, adminOrStaff, validateBody(productUpdateSchema), asyncHandler(async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.product.findUnique({ where: { id }, include: { images: true } });
  if (!existing) throw new ApiError(404, 'Product not found');
  const data = req.body;
  if (data.price !== undefined || data.salePrice !== undefined) {
    const price = data.price ?? Number(existing.price);
    if (data.salePrice != null && Number(data.salePrice) > Number(price)) throw new ApiError(400, 'Sale price cannot be higher than the regular price');
  }
  if (data.salePrice !== undefined && data.salePrice !== null && Number(data.salePrice) > Number(data.price ?? existing.price)) {
    throw new ApiError(400, 'Sale price cannot be higher than the regular price');
  }

  const payload: Prisma.ProductUpdateInput = {};
  if (data.name !== undefined) payload.name = sanitizeText(data.name)!;
  if (data.slug !== undefined) payload.slug = slugify(data.slug);
  if (data.sku !== undefined) payload.sku = data.sku.toUpperCase();
  if (data.categoryId !== undefined) payload.category = { connect: { id: data.categoryId } };
  if (data.brandId !== undefined) payload.brand = { connect: { id: data.brandId } };
  if (data.shortDescription !== undefined) payload.shortDescription = sanitizeText(data.shortDescription);
  if (data.description !== undefined) payload.description = sanitizeHtml(data.description);
  if (data.price !== undefined) payload.price = data.price;
  if (data.salePrice !== undefined) payload.salePrice = data.salePrice;
  if (data.costPrice !== undefined) payload.costPrice = data.costPrice;
  if (data.weight !== undefined) payload.weight = sanitizeText(data.weight);
  if (data.dimensions !== undefined) payload.dimensions = sanitizeText(data.dimensions);
  if (data.minimumStock !== undefined) payload.minimumStock = data.minimumStock;
  if (data.featured !== undefined) payload.featured = !!data.featured;
  if (data.status !== undefined) payload.status = data.status;
  if (data.stockQuantity !== undefined && data.stockQuantity !== existing.stockQuantity) {
    const diff = data.stockQuantity - existing.stockQuantity;
    payload.stockQuantity = data.stockQuantity;
    await prisma.inventoryLog.create({
      data: { productId: id, type: diff > 0 ? 'stock_in' : 'stock_out', quantity: Math.abs(diff), reference: 'PRODUCT-UPDATE', remarks: `Stock updated from ${existing.stockQuantity} to ${data.stockQuantity}` },
    });
  }

  await prisma.product.update({ where: { id }, data: payload });

  if (Array.isArray(data.images)) {
    await prisma.productImage.deleteMany({ where: { productId: id } });
    if (data.images.length) {
      const images = data.images.map((im: any, i: number) => ({ productId: id, image: im.image, isPrimary: !!im.isPrimary || i === 0, sortOrder: im.sortOrder ?? i }));
      if (!images.some((im: any) => im.isPrimary)) images[0].isPrimary = true;
      await prisma.productImage.createMany({ data: images });
    }
  }
  if (Array.isArray(data.specifications)) {
    await prisma.productSpecification.deleteMany({ where: { productId: id } });
    if (data.specifications.length) {
      await prisma.productSpecification.createMany({ data: data.specifications.map((s: any) => ({ productId: id, attributeName: sanitizeText(s.attributeName)!, attributeValue: sanitizeText(s.attributeValue)! })) });
    }
  }

  const full = await prisma.product.findUnique({ where: { id }, include: detailInclude });
  await recordActivity({ userId: req.user!.id, action: 'product.updated', entity: 'Product', entityId: id, details: `Updated product ${full?.name}`, ip: req.ip });
  return ok(res, full, undefined, 'Product updated');
}));

r.patch('/:id/status', authenticate, adminOrStaff, asyncHandler(async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const status = String(req.body.status || '');
  if (!['active', 'draft', 'inactive'].includes(status)) throw new ApiError(400, 'Invalid status');
  const product = await prisma.product.update({ where: { id }, data: { status } });
  await recordActivity({ userId: req.user!.id, action: 'product.status_changed', entity: 'Product', entityId: id, details: `Set product status to ${status}`, ip: req.ip });
  return ok(res, product, undefined, `Product marked ${status}`);
}));

r.delete('/:id', authenticate, adminOrStaff, asyncHandler(async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const product = await prisma.product.findUnique({ where: { id }, include: { images: true } });
  if (!product) throw new ApiError(404, 'Product not found');
  for (const im of product.images) {
    if (im.image.startsWith('/uploads/')) {
      const filePath = path.join(uploadDir, path.basename(im.image));
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  }
  await prisma.product.delete({ where: { id } });
  await recordActivity({ userId: req.user!.id, action: 'product.deleted', entity: 'Product', entityId: id, details: `Deleted product ${product.name}`, ip: req.ip });
  return ok(res, null, undefined, 'Product deleted');
}));

export default r;
