import { Router } from 'express';
import { prisma } from '../config/prisma';
import { adminOrStaff, authenticate, optionalAuth, AuthRequest } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { couponSchema, couponValidateSchema } from '../validators/commerce';
import { ApiError, asyncHandler, created, getMeta, getPagination, money, ok } from '../utils/http';
import { sanitizeText } from '../utils/sanitize';
import { recordActivity } from '../utils/audit';

const r = Router();

export function evaluateCoupon(coupon: any, subtotal: number) {
  const now = new Date();
  if (!coupon || coupon.status !== 'active') throw new ApiError(400, 'This coupon code is not valid');
  if (coupon.startDate && coupon.startDate > now) throw new ApiError(400, 'This coupon is not active yet');
  if (coupon.endDate && coupon.endDate < now) throw new ApiError(400, 'This coupon has expired');
  if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) throw new ApiError(400, 'This coupon has reached its usage limit');
  if (coupon.minimumOrder && subtotal < Number(coupon.minimumOrder)) throw new ApiError(400, `This coupon requires a minimum order of $${Number(coupon.minimumOrder).toFixed(2)}`);
  let discount = coupon.type === 'percentage' ? (subtotal * Number(coupon.value)) / 100 : Number(coupon.value);
  if (coupon.maximumDiscount) discount = Math.min(discount, Number(coupon.maximumDiscount));
  discount = Math.min(money(discount), subtotal);
  return { discount, code: coupon.code, type: coupon.type, value: Number(coupon.value) };
}

r.post('/validate', optionalAuth, validateBody(couponValidateSchema), asyncHandler(async (req, res) => {
  const { code, subtotal } = req.body;
  const coupon = await prisma.coupon.findUnique({ where: { code } });
  const result = evaluateCoupon(coupon, subtotal);
  return ok(res, { ...result, subtotal, total: money(subtotal - result.discount) }, undefined, 'Coupon applied');
}));

r.get('/stats', authenticate, adminOrStaff, asyncHandler(async (_req, res) => {
  const [total, active, inactive, redemptions, discountAgg] = await Promise.all([
    prisma.coupon.count(), prisma.coupon.count({ where: { status: 'active' } }),
    prisma.coupon.count({ where: { status: 'inactive' } }), prisma.couponUsage.count(),
    prisma.couponUsage.aggregate({ _sum: { discountAmount: true } }),
  ]);
  return ok(res, { total, active, inactive, redemptions, totalDiscount: money(Number(discountAgg._sum.discountAmount ?? 0)) });
}));

r.get('/', authenticate, adminOrStaff, asyncHandler(async (req: AuthRequest, res) => {
  const { page, limit, skip } = getPagination(req.query as any);
  const search = String(req.query.search || '');
  const status = req.query.status ? String(req.query.status) : undefined;
  const where: any = {
    ...(search ? { OR: [{ code: { contains: search, mode: 'insensitive' } }, { description: { contains: search, mode: 'insensitive' } }] } : {}),
    ...(status ? { status } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.coupon.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' }, include: { _count: { select: { usages: true } } } }),
    prisma.coupon.count({ where }),
  ]);
  return ok(res, items, getMeta(page, limit, total));
}));

r.get('/:id', authenticate, adminOrStaff, asyncHandler(async (req, res) => {
  const coupon = await prisma.coupon.findUnique({
    where: { id: Number(req.params.id) },
    include: {
      usages: {
        orderBy: { createdAt: 'desc' }, take: 50,
        include: { user: { select: { id: true, name: true, email: true } }, order: { select: { id: true, orderNumber: true, grandTotal: true } } },
      },
    },
  });
  if (!coupon) throw new ApiError(404, 'Coupon not found');
  return ok(res, coupon);
}));

r.post('/', authenticate, adminOrStaff, validateBody(couponSchema), asyncHandler(async (req: AuthRequest, res) => {
  const data = req.body;
  const coupon = await prisma.coupon.create({
    data: {
      code: data.code, description: sanitizeText(data.description), type: data.type, value: data.value,
      minimumOrder: data.minimumOrder ?? null, maximumDiscount: data.maximumDiscount ?? null,
      usageLimit: data.usageLimit ?? null, startDate: data.startDate ? new Date(data.startDate) : null,
      endDate: data.endDate ? new Date(data.endDate) : null, status: data.status ?? 'active',
    },
  });
  await recordActivity({ userId: req.user!.id, action: 'coupon.created', entity: 'Coupon', entityId: coupon.id, details: `Created coupon ${coupon.code}`, ip: req.ip });
  return created(res, coupon, 'Coupon created');
}));

r.put('/:id', authenticate, adminOrStaff, validateBody(couponSchema.partial()), asyncHandler(async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.coupon.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, 'Coupon not found');
  const data = req.body;
  const coupon = await prisma.coupon.update({
    where: { id },
    data: {
      ...(data.code !== undefined ? { code: data.code } : {}),
      ...(data.description !== undefined ? { description: sanitizeText(data.description) } : {}),
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
  await recordActivity({ userId: req.user!.id, action: 'coupon.updated', entity: 'Coupon', entityId: id, details: `Updated coupon ${coupon.code}`, ip: req.ip });
  return ok(res, coupon, undefined, 'Coupon updated');
}));

r.delete('/:id', authenticate, adminOrStaff, asyncHandler(async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const coupon = await prisma.coupon.findUnique({ where: { id } });
  if (!coupon) throw new ApiError(404, 'Coupon not found');
  await prisma.coupon.delete({ where: { id } });
  await recordActivity({ userId: req.user!.id, action: 'coupon.deleted', entity: 'Coupon', entityId: id, details: `Deleted coupon ${coupon.code}`, ip: req.ip });
  return ok(res, null, undefined, 'Coupon deleted');
}));

export default r;
