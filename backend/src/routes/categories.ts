import { Router } from 'express';
import { prisma } from '../config/prisma';
import { adminOrStaff, authenticate, optionalAuth, AuthRequest } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { categorySchema } from '../validators/catalog';
import { ApiError, asyncHandler, created, getMeta, getPagination, ok, slugify } from '../utils/http';
import { sanitizeText } from '../utils/sanitize';
import { recordActivity } from '../utils/audit';

const r = Router();

r.get('/stats', authenticate, adminOrStaff, asyncHandler(async (_req, res) => {
  const [total, active, inactive, withProducts] = await Promise.all([
    prisma.category.count(), prisma.category.count({ where: { status: 'active' } }),
    prisma.category.count({ where: { status: 'inactive' } }),
    prisma.category.count({ where: { products: { some: {} } } }),
  ]);
  return ok(res, { total, active, inactive, withProducts, empty: total - withProducts });
}));

r.get('/', optionalAuth, asyncHandler(async (req: AuthRequest, res) => {
  const { page, limit, skip } = getPagination(req.query as any, 50);
  const search = String(req.query.search || '');
  const status = req.query.status ? String(req.query.status) : undefined;
  const isStaff = !!req.user && ['admin', 'staff'].includes(req.user.role);
  const where: any = {
    ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { description: { contains: search, mode: 'insensitive' } }] } : {}),
    ...(status && isStaff ? { status } : !isStaff ? { status: 'active' } : {}),
    ...(req.query.parentId ? { parentId: req.query.parentId === 'null' ? null : Number(req.query.parentId) } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.category.findMany({
      where, skip, take: limit, orderBy: [{ parentId: 'asc' }, { name: 'asc' }],
      include: {
        parent: { select: { id: true, name: true } },
        _count: { select: { products: true, children: true } },
      },
    }),
    prisma.category.count({ where }),
  ]);
  return ok(res, items, getMeta(page, limit, total));
}));

r.get('/:idOrSlug', optionalAuth, asyncHandler(async (req, res) => {
  const value = req.params.idOrSlug;
  const category = await prisma.category.findFirst({
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
  if (!category) throw new ApiError(404, 'Category not found');
  return ok(res, category);
}));

r.post('/', authenticate, adminOrStaff, validateBody(categorySchema), asyncHandler(async (req: AuthRequest, res) => {
  const data = req.body;
  let slug = slugify(data.slug || data.name);
  if (await prisma.category.findUnique({ where: { slug } })) slug = `${slug}-${Date.now().toString().slice(-4)}`;
  if (data.parentId) {
    const parent = await prisma.category.findUnique({ where: { id: data.parentId } });
    if (!parent) throw new ApiError(400, 'Parent category not found');
  }
  const category = await prisma.category.create({
    data: {
      name: sanitizeText(data.name)!, slug, parentId: data.parentId ?? null,
      image: data.image ?? null, description: sanitizeText(data.description), status: data.status ?? 'active',
    },
  });
  await recordActivity({ userId: req.user!.id, action: 'category.created', entity: 'Category', entityId: category.id, details: `Created category ${category.name}`, ip: req.ip });
  return created(res, category, 'Category created');
}));

r.put('/:id', authenticate, adminOrStaff, validateBody(categorySchema.partial()), asyncHandler(async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.category.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, 'Category not found');
  const data = req.body;
  if (data.parentId === id) throw new ApiError(400, 'A category cannot be its own parent');
  if (data.parentId) {
    const parent = await prisma.category.findUnique({ where: { id: data.parentId } });
    if (!parent) throw new ApiError(400, 'Parent category not found');
  }
  const category = await prisma.category.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: sanitizeText(data.name)! } : {}),
      ...(data.slug !== undefined ? { slug: slugify(data.slug) } : {}),
      ...(data.parentId !== undefined ? { parentId: data.parentId } : {}),
      ...(data.image !== undefined ? { image: data.image } : {}),
      ...(data.description !== undefined ? { description: sanitizeText(data.description) } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
    },
  });
  await recordActivity({ userId: req.user!.id, action: 'category.updated', entity: 'Category', entityId: id, details: `Updated category ${category.name}`, ip: req.ip });
  return ok(res, category, undefined, 'Category updated');
}));

r.delete('/:id', authenticate, adminOrStaff, asyncHandler(async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const category = await prisma.category.findUnique({ where: { id }, include: { _count: { select: { products: true, children: true } } } });
  if (!category) throw new ApiError(404, 'Category not found');
  if (category._count.products > 0) throw new ApiError(409, `This category contains ${category._count.products} product(s). Reassign them before deleting.`);
  if (category._count.children > 0) throw new ApiError(409, 'This category has subcategories. Move or delete them first.');
  await prisma.category.delete({ where: { id } });
  await recordActivity({ userId: req.user!.id, action: 'category.deleted', entity: 'Category', entityId: id, details: `Deleted category ${category.name}`, ip: req.ip });
  return ok(res, null, undefined, 'Category deleted');
}));

export default r;
