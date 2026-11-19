import { Router } from 'express';
import { prisma } from '../config/prisma';
import { adminOrStaff, authenticate, optionalAuth, AuthRequest } from '../middleware/auth';
import { validateBody, validateQuery } from '../middleware/validate';
import { reviewQuery, reviewSchema, reviewUpdateSchema } from '../validators/catalog';
import { ApiError, asyncHandler, created, getMeta, getPagination, money, ok } from '../utils/http';
import { sanitizeText } from '../utils/sanitize';
import { notify, recordActivity } from '../utils/audit';

const r = Router();

const reviewInclude = {
  user: { select: { id: true, name: true, email: true, avatar: true } },
  product: { select: { id: true, name: true, slug: true, sku: true, images: { take: 1, orderBy: { sortOrder: 'asc' as const } } } },
} as const;

r.get('/stats', authenticate, adminOrStaff, asyncHandler(async (_req, res) => {
  const [total, pending, approved, rejected, avg, dist] = await Promise.all([
    prisma.review.count(), prisma.review.count({ where: { status: 'pending' } }),
    prisma.review.count({ where: { status: 'approved' } }), prisma.review.count({ where: { status: 'rejected' } }),
    prisma.review.aggregate({ _avg: { rating: true } }),
    prisma.review.groupBy({ by: ['rating'], _count: { _all: true } }),
  ]);
  const distribution = [5, 4, 3, 2, 1].map((star) => ({
    star, count: dist.find((d) => d.rating === star)?._count._all ?? 0,
  }));
  return ok(res, { total, pending, approved, rejected, averageRating: money(Number(avg._avg.rating ?? 0)), distribution });
}));

r.get('/', optionalAuth, validateQuery(reviewQuery), asyncHandler(async (req: AuthRequest, res) => {
  const query = req.query as any;
  const { page, limit, skip } = getPagination(query);
  const isStaff = !!req.user && ['admin', 'staff'].includes(req.user.role);
  const where: any = {
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
    prisma.review.findMany({ where, skip, take: limit, include: reviewInclude, orderBy: { createdAt: 'desc' } }),
    prisma.review.count({ where }),
  ]);
  return ok(res, items, getMeta(page, limit, total));
}));

r.post('/', authenticate, validateBody(reviewSchema), asyncHandler(async (req: AuthRequest, res) => {
  const { productId, rating, title, comment } = req.body;
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new ApiError(404, 'Product not found');
  const existing = await prisma.review.findFirst({ where: { productId, userId: req.user!.id } });
  if (existing) throw new ApiError(409, 'You have already reviewed this product');
  const review = await prisma.review.create({
    data: {
      productId, userId: req.user!.id, rating,
      title: sanitizeText(title), comment: sanitizeText(comment), status: 'pending',
    },
    include: reviewInclude,
  });
  await notify({ userId: null, title: 'New review awaiting moderation', message: `${review.user.name} left a ${rating}-star review on ${product.name}.`, type: 'review', link: '/admin/reviews' });
  await recordActivity({ userId: req.user!.id, action: 'review.created', entity: 'Review', entityId: review.id, details: `Reviewed ${product.name}`, ip: req.ip });
  return created(res, review, 'Thank you! Your review is awaiting moderation.');
}));

r.put('/:id', authenticate, adminOrStaff, validateBody(reviewUpdateSchema), asyncHandler(async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const review = await prisma.review.update({
    where: { id },
    data: {
      ...(req.body.rating !== undefined ? { rating: req.body.rating } : {}),
      ...(req.body.title !== undefined ? { title: sanitizeText(req.body.title) } : {}),
      ...(req.body.comment !== undefined ? { comment: sanitizeText(req.body.comment) } : {}),
      ...(req.body.status !== undefined ? { status: req.body.status } : {}),
    },
    include: reviewInclude,
  });
  await recordActivity({ userId: req.user!.id, action: 'review.updated', entity: 'Review', entityId: id, details: `Updated review #${id}`, ip: req.ip });
  return ok(res, review, undefined, 'Review updated');
}));

r.patch('/:id/status', authenticate, adminOrStaff, asyncHandler(async (req: AuthRequest, res) => {
  const status = String(req.body.status || '');
  if (!['pending', 'approved', 'rejected'].includes(status)) throw new ApiError(400, 'Invalid review status');
  const id = Number(req.params.id);
  const review = await prisma.review.update({ where: { id }, data: { status }, include: reviewInclude });
  await recordActivity({ userId: req.user!.id, action: `review.${status}`, entity: 'Review', entityId: id, details: `Set review status to ${status}`, ip: req.ip });
  return ok(res, review, undefined, `Review ${status}`);
}));

r.delete('/:id', authenticate, adminOrStaff, asyncHandler(async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  await prisma.review.delete({ where: { id } });
  await recordActivity({ userId: req.user!.id, action: 'review.deleted', entity: 'Review', entityId: id, details: `Deleted review #${id}`, ip: req.ip });
  return ok(res, null, undefined, 'Review deleted');
}));

export default r;
