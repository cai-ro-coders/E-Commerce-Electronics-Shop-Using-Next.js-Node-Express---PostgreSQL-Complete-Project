import { Router } from 'express';
import { prisma } from '../config/prisma';
import { adminOrStaff, authenticate, optionalAuth, AuthRequest } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { brandSchema } from '../validators/catalog';
import { ApiError, asyncHandler, created, getMeta, getPagination, ok, slugify } from '../utils/http';
import { sanitizeText } from '../utils/sanitize';
import { recordActivity } from '../utils/audit';

const r = Router();

r.get('/stats', authenticate, adminOrStaff, asyncHandler(async (_req, res) => {
  const [total, active, inactive, withProducts] = await Promise.all([
    prisma.brand.count(), prisma.brand.count({ where: { status: 'active' } }),
    prisma.brand.count({ where: { status: 'inactive' } }),
    prisma.brand.count({ where: { products: { some: {} } } }),
  ]);
  return ok(res, { total, active, inactive, withProducts });
}));

r.get('/', optionalAuth, asyncHandler(async (req: AuthRequest, res) => {
  const { page, limit, skip } = getPagination(req.query as any, 50);
  const search = String(req.query.search || '');
  const status = req.query.status ? String(req.query.status) : undefined;
  const isStaff = !!req.user && ['admin', 'staff'].includes(req.user.role);
  const where: any = {
    ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { description: { contains: search, mode: 'insensitive' } }] } : {}),
    ...(status && isStaff ? { status } : !isStaff ? { status: 'active' } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.brand.findMany({
      where, skip, take: limit, orderBy: { name: 'asc' },
      include: { _count: { select: { products: true } } },
    }),
    prisma.brand.count({ where }),
  ]);
  return ok(res, items, getMeta(page, limit, total));
}));

r.get('/:idOrSlug', optionalAuth, asyncHandler(async (req, res) => {
  const value = req.params.idOrSlug;
  const brand = await prisma.brand.findFirst({
    where: /^\d+$/.test(value) ? { id: Number(value) } : { slug: value },
    include: {
      _count: { select: { products: true } },
      products: {
        where: { status: 'active' }, take: 8, orderBy: { createdAt: 'desc' },
        include: { images: { take: 2, orderBy: { sortOrder: 'asc' } }, category: { select: { name: true } } },
      },
    },
  });
  if (!brand) throw new ApiError(404, 'Brand not found');
  return ok(res, brand);
}));

r.post('/', authenticate, adminOrStaff, validateBody(brandSchema), asyncHandler(async (req: AuthRequest, res) => {
  const data = req.body;
  let slug = slugify(data.slug || data.name);
  if (await prisma.brand.findUnique({ where: { slug } })) slug = `${slug}-${Date.now().toString().slice(-4)}`;
  const brand = await prisma.brand.create({
    data: {
      name: sanitizeText(data.name)!, slug, logo: data.logo ?? null,
      description: sanitizeText(data.description), status: data.status ?? 'active',
    },
  });
  await recordActivity({ userId: req.user!.id, action: 'brand.created', entity: 'Brand', entityId: brand.id, details: `Created brand ${brand.name}`, ip: req.ip });
  return created(res, brand, 'Brand created');
}));

r.put('/:id', authenticate, adminOrStaff, validateBody(brandSchema.partial()), asyncHandler(async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.brand.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, 'Brand not found');
  const data = req.body;
  const brand = await prisma.brand.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: sanitizeText(data.name)! } : {}),
      ...(data.slug !== undefined ? { slug: slugify(data.slug) } : {}),
      ...(data.logo !== undefined ? { logo: data.logo } : {}),
      ...(data.description !== undefined ? { description: sanitizeText(data.description) } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
    },
  });
  await recordActivity({ userId: req.user!.id, action: 'brand.updated', entity: 'Brand', entityId: id, details: `Updated brand ${brand.name}`, ip: req.ip });
  return ok(res, brand, undefined, 'Brand updated');
}));

r.delete('/:id', authenticate, adminOrStaff, asyncHandler(async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const brand = await prisma.brand.findUnique({ where: { id }, include: { _count: { select: { products: true } } } });
  if (!brand) throw new ApiError(404, 'Brand not found');
  if (brand._count.products > 0) throw new ApiError(409, `This brand has ${brand._count.products} product(s). Reassign them before deleting.`);
  await prisma.brand.delete({ where: { id } });
  await recordActivity({ userId: req.user!.id, action: 'brand.deleted', entity: 'Brand', entityId: id, details: `Deleted brand ${brand.name}`, ip: req.ip });
  return ok(res, null, undefined, 'Brand deleted');
}));

export default r;
