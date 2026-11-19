import { Router } from 'express';
import { prisma } from '../config/prisma';
import { authenticate, adminOrStaff, authorize, AuthRequest } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { createCustomerSchema, updateUserSchema } from '../validators/auth';
import { ApiError, asyncHandler, created, getMeta, getPagination, money, ok } from '../utils/http';
import { hashPassword } from '../utils/password';
import { sanitizeText } from '../utils/sanitize';
import { recordActivity } from '../utils/audit';

const r = Router();
r.use(authenticate, adminOrStaff);

r.get('/stats', asyncHandler(async (_req, res) => {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const [total, active, inactive, newThisMonth] = await Promise.all([
    prisma.user.count({ where: { role: 'customer' } }),
    prisma.user.count({ where: { role: 'customer', status: 'active' } }),
    prisma.user.count({ where: { role: 'customer', status: { not: 'active' } } }),
    prisma.user.count({ where: { role: 'customer', createdAt: { gte: monthStart } } }),
  ]);
  const spend = await prisma.order.aggregate({ where: { user: { role: 'customer' }, orderStatus: { notIn: ['Cancelled', 'Returned'] } }, _sum: { grandTotal: true } });
  return ok(res, { total, active, inactive, newThisMonth, lifetimeValue: money(Number(spend._sum.grandTotal ?? 0)) });
}));

r.get('/', asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query as any, 20);
  const search = String(req.query.search || '');
  const status = req.query.status ? String(req.query.status) : undefined;
  const where: any = {
    role: 'customer',
    ...(status ? { status } : {}),
    ...(search ? { OR: [
      { name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      { phone: { contains: search, mode: 'insensitive' } },
    ] } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where, skip, take: limit, orderBy: { createdAt: 'desc' },
      select: {
        id: true, name: true, email: true, phone: true, avatar: true, status: true,
        lastLoginAt: true, createdAt: true,
        _count: { select: { orders: true, reviews: true, wishlist: true } },
        orders: { select: { grandTotal: true, orderStatus: true, createdAt: true }, orderBy: { createdAt: 'desc' } },
        addresses: { where: { isDefault: true }, take: 1 },
      },
    }),
    prisma.user.count({ where }),
  ]);
  const mapped = items.map((u) => {
    const valid = u.orders.filter((o) => !['Cancelled', 'Returned'].includes(o.orderStatus));
    return {
      id: u.id, name: u.name, email: u.email, phone: u.phone, avatar: u.avatar, status: u.status,
      lastLoginAt: u.lastLoginAt, createdAt: u.createdAt,
      ordersCount: u._count.orders, reviewsCount: u._count.reviews, wishlistCount: u._count.wishlist,
      totalSpent: money(valid.reduce((s, o) => s + Number(o.grandTotal), 0)),
      lastOrderAt: u.orders[0]?.createdAt ?? null,
      address: u.addresses[0] ?? null,
    };
  });
  return ok(res, mapped, getMeta(page, limit, total));
}));

r.get('/:id', asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: Number(req.params.id) },
    select: {
      id: true, name: true, email: true, phone: true, avatar: true, status: true, role: true,
      createdAt: true, lastLoginAt: true,
      addresses: { orderBy: { isDefault: 'desc' } },
      orders: { orderBy: { createdAt: 'desc' }, include: { items: true, payment: true }, take: 50 },
      reviews: { orderBy: { createdAt: 'desc' }, take: 10, include: { product: { select: { name: true, slug: true } } } },
      wishlist: { include: { product: { select: { id: true, name: true, slug: true, price: true, images: { take: 1 } } } } },
      loginHistory: { orderBy: { createdAt: 'desc' }, take: 20 },
      _count: { select: { orders: true, reviews: true, wishlist: true } },
    },
  });
  if (!user || user.role !== 'customer') throw new ApiError(404, 'Customer not found');
  const valid = user.orders.filter((o) => !['Cancelled', 'Returned'].includes(o.orderStatus));
  const totalSpent = money(valid.reduce((s, o) => s + Number(o.grandTotal), 0));
  const avgOrder = valid.length ? money(totalSpent / valid.length) : 0;
  return ok(res, { ...user, stats: { totalSpent, totalOrders: user._count.orders, reviews: user._count.reviews, wishlist: user._count.wishlist, avgOrder } });
}));

r.post('/', authorize('admin'), validateBody(createCustomerSchema), asyncHandler(async (req: AuthRequest, res) => {
  const data = req.body;
  if (await prisma.user.findUnique({ where: { email: data.email } })) throw new ApiError(409, 'Email already in use');
  const user = await prisma.user.create({
    data: {
      name: sanitizeText(data.name)!, email: data.email, password: await hashPassword(data.password),
      phone: data.phone ? sanitizeText(data.phone) : null, status: data.status ?? 'active',
      avatar: data.avatar ?? null, role: 'customer',
    },
    select: { id: true, name: true, email: true, status: true, phone: true, avatar: true, createdAt: true },
  });
  await prisma.cart.create({ data: { userId: user.id } }).catch(() => undefined);
  await recordActivity({ userId: req.user!.id, action: 'customer.created', entity: 'Customer', entityId: user.id, details: `Created customer ${user.name}`, ip: req.ip });
  return created(res, user, 'Customer created');
}));

r.put('/:id', authorize('admin'), validateBody(updateUserSchema), asyncHandler(async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing || existing.role !== 'customer') throw new ApiError(404, 'Customer not found');
  const data = req.body;
  const user = await prisma.user.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: sanitizeText(data.name)! } : {}),
      ...(data.email !== undefined ? { email: data.email } : {}),
      ...(data.password ? { password: await hashPassword(data.password) } : {}),
      ...(data.phone !== undefined ? { phone: data.phone ? sanitizeText(data.phone) : null } : {}),
      ...(data.avatar !== undefined ? { avatar: data.avatar } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
    },
    select: { id: true, name: true, email: true, status: true, phone: true, avatar: true, createdAt: true },
  });
  await recordActivity({ userId: req.user!.id, action: 'customer.updated', entity: 'Customer', entityId: id, details: `Updated customer ${user.name}`, ip: req.ip });
  return ok(res, user, undefined, 'Customer updated');
}));

r.patch('/:id/status', authorize('admin'), asyncHandler(async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const status = String(req.body.status || '');
  if (!['active', 'inactive', 'suspended'].includes(status)) throw new ApiError(400, 'Invalid status');
  const user = await prisma.user.update({ where: { id }, data: { status } });
  await recordActivity({ userId: req.user!.id, action: 'customer.status_changed', entity: 'Customer', entityId: id, details: `Set customer ${user.name} status to ${status}`, ip: req.ip });
  return ok(res, { id: user.id, status: user.status }, undefined, `Customer ${status === 'active' ? 'activated' : 'deactivated'}`);
}));

r.delete('/:id', authorize('admin'), asyncHandler(async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const customer = await prisma.user.findUnique({ where: { id }, include: { _count: { select: { orders: true } } } });
  if (!customer || customer.role !== 'customer') throw new ApiError(404, 'Customer not found');
  if (customer._count.orders > 0) {
    await prisma.user.update({ where: { id }, data: { status: 'inactive' } });
    await recordActivity({ userId: req.user!.id, action: 'customer.deactivated', entity: 'Customer', entityId: id, details: `Deactivated customer ${customer.name} (has order history)`, ip: req.ip });
    return ok(res, { deactivated: true }, undefined, 'Customer has order history, so the account was deactivated instead of deleted');
  }
  await prisma.user.delete({ where: { id } });
  await recordActivity({ userId: req.user!.id, action: 'customer.deleted', entity: 'Customer', entityId: id, details: `Deleted customer ${customer.name}`, ip: req.ip });
  return ok(res, { deleted: true }, undefined, 'Customer deleted');
}));

r.get('/:id/orders', asyncHandler(async (req, res) => {
  const orders = await prisma.order.findMany({
    where: { userId: Number(req.params.id) },
    orderBy: { createdAt: 'desc' },
    include: { items: { include: { product: { select: { images: { take: 1 } } } } }, payment: true },
  });
  return ok(res, orders);
}));

export default r;
