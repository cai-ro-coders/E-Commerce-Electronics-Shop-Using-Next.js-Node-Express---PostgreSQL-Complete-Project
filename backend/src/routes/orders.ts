import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { authenticate, optionalAuth, adminOrStaff, AuthRequest } from '../middleware/auth';
import { validateBody, validateQuery } from '../middleware/validate';
import { checkoutSchema, orderQuery, orderUpdateSchema } from '../validators/commerce';
import { ApiError, asyncHandler, created, dateRange, getMeta, getPagination, ok, parseDate, sortOrder } from '../utils/http';
import { orderInclude, orderStats, checkout, updateOrderStatus } from '../services/orderService';
import { recordActivity } from '../utils/audit';
import { sendCsv, toCsv } from '../utils/csv';

const r = Router();

function buildWhere(query: any): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = {};
  const and: Prisma.OrderWhereInput[] = [];
  if (query.search) {
    and.push({
      OR: [
        { orderNumber: { contains: query.search, mode: 'insensitive' } },
        { trackingNumber: { contains: query.search, mode: 'insensitive' } },
        { user: { name: { contains: query.search, mode: 'insensitive' } } },
        { user: { email: { contains: query.search, mode: 'insensitive' } } },
      ],
    });
  }
  if (query.status) and.push({ orderStatus: query.status });
  if (query.paymentStatus) and.push({ paymentStatus: query.paymentStatus });
  const { start, end } = dateRange(query.from, query.to);
  if (start || end) and.push({ createdAt: { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) } });
  if (and.length) where.AND = and;
  return where;
}

function orderByFor(query: any): Prisma.OrderOrderByWithRelationInput {
  if (query.sortBy) return { [query.sortBy]: sortOrder(query.sortDir) } as Prisma.OrderOrderByWithRelationInput;
  return { createdAt: 'desc' };
}

r.get('/stats', authenticate, adminOrStaff, asyncHandler(async (_req, res) => ok(res, await orderStats())));

r.get('/export', authenticate, adminOrStaff, asyncHandler(async (req, res) => {
  const where = buildWhere(req.query);
  const orders = await prisma.order.findMany({
    where, include: { user: { select: { name: true, email: true } }, items: true }, orderBy: { createdAt: 'desc' },
  });
  const rows = orders.map((o) => ({
    order_number: o.orderNumber, customer: o.user?.name ?? '', email: o.user?.email ?? '',
    date: o.createdAt.toISOString(), payment_method: o.paymentMethod ?? '',
    payment_status: o.paymentStatus, fulfilment: o.orderStatus, items: o.items.reduce((s, i) => s + i.quantity, 0),
    subtotal: Number(o.subtotal), discount: Number(o.discount), shipping: Number(o.shippingFee), tax: Number(o.tax),
    total: Number(o.grandTotal), tracking_number: o.trackingNumber ?? '',
  }));
  if (String(req.query.format) === 'json') {
    res.setHeader('Content-Disposition', 'attachment; filename="orders.json"');
    return res.json(rows);
  }
  return sendCsv(res, 'orders.csv', toCsv(rows));
}));

r.get('/export/csv', authenticate, adminOrStaff, asyncHandler(async (req, res) => {
  const where = buildWhere(req.query);
  const orders = await prisma.order.findMany({ where, include: { user: true }, orderBy: { createdAt: 'desc' } });
  const rows = orders.map((o) => ({
    order_number: o.orderNumber, customer: o.user?.name ?? '', email: o.user?.email ?? '',
    date: o.createdAt.toISOString(), payment_status: o.paymentStatus, order_status: o.orderStatus, total: Number(o.grandTotal),
  }));
  return sendCsv(res, 'orders.csv', toCsv(rows));
}));

r.get('/my', authenticate, validateQuery(orderQuery), asyncHandler(async (req: AuthRequest, res) => {
  const { page, limit, skip } = getPagination(req.query as any);
  const query = req.query as any;
  const where: Prisma.OrderWhereInput = { userId: req.user!.id };
  if (query.status) where.orderStatus = query.status;
  if (query.paymentStatus) where.paymentStatus = query.paymentStatus;
  if (query.search) where.OR = [{ orderNumber: { contains: query.search, mode: 'insensitive' } }];
  const [items, total] = await Promise.all([
    prisma.order.findMany({ where, skip, take: limit, include: orderInclude, orderBy: { createdAt: 'desc' } }),
    prisma.order.count({ where }),
  ]);
  return ok(res, items, getMeta(page, limit, total));
}));

r.get('/my/summary', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const [totalOrders, pendingOrders, spend] = await Promise.all([
    prisma.order.count({ where: { userId } }),
    prisma.order.count({ where: { userId, orderStatus: 'Pending' } }),
    prisma.order.aggregate({
      where: { userId, orderStatus: { notIn: ['Cancelled', 'Returned'] } },
      _sum: { grandTotal: true },
    }),
  ]);
  return ok(res, { totalOrders, pendingOrders, totalSpent: Number(spend._sum.grandTotal ?? 0) });
}));

r.get('/track/:orderNumber', asyncHandler(async (req, res) => {
  const order = await prisma.order.findUnique({
    where: { orderNumber: req.params.orderNumber },
    select: {
      orderNumber: true, orderStatus: true, paymentStatus: true, trackingNumber: true,
      carrier: true, estimatedDelivery: true, createdAt: true, grandTotal: true,
      statusHistory: { orderBy: { createdAt: 'asc' } },
      items: { select: { productName: true, quantity: true, total: true } },
    },
  });
  if (!order) throw new ApiError(404, 'No order found with that number');
  return ok(res, order);
}));

r.get('/', authenticate, adminOrStaff, validateQuery(orderQuery), asyncHandler(async (req, res) => {
  const query = req.query as any;
  const { page, limit, skip } = getPagination(query);
  const where = buildWhere(query);
  const [items, total] = await Promise.all([
    prisma.order.findMany({ where, skip, take: limit, include: orderInclude, orderBy: orderByFor(query) }),
    prisma.order.count({ where }),
  ]);
  return ok(res, items, getMeta(page, limit, total));
}));

r.post('/checkout', authenticate, validateBody(checkoutSchema), asyncHandler(async (req: AuthRequest, res) => {
  const order = await checkout(req.user!.id, req.body as any, req.ip);
  return created(res, order, 'Order placed successfully');
}));

r.get('/:id/receipt', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const order = await prisma.order.findUnique({ where: { id }, include: orderInclude });
  if (!order) throw new ApiError(404, 'Order not found');
  if (!['admin', 'staff'].includes(req.user!.role) && order.userId !== req.user!.id) throw new ApiError(403, 'You cannot access this receipt');
  const settings = await prisma.setting.findMany({ where: { group: 'general' } });
  return ok(res, { order, settings: Object.fromEntries(settings.map((s) => [s.key, s.value])) });
}));

r.get('/:id', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const order = await prisma.order.findUnique({ where: { id }, include: orderInclude });
  if (!order) throw new ApiError(404, 'Order not found');
  if (!['admin', 'staff'].includes(req.user!.role) && order.userId !== req.user!.id) throw new ApiError(403, 'You cannot access this order');
  return ok(res, order);
}));

r.put('/:id', authenticate, adminOrStaff, validateBody(orderUpdateSchema), asyncHandler(async (req: AuthRequest, res) => {
  const order = await updateOrderStatus(Number(req.params.id), req.body, req.user!.id, req.ip);
  return ok(res, order, undefined, 'Order updated');
}));

r.patch('/:id/status', authenticate, adminOrStaff, validateBody(orderUpdateSchema), asyncHandler(async (req: AuthRequest, res) => {
  const order = await updateOrderStatus(Number(req.params.id), req.body, req.user!.id, req.ip);
  return ok(res, order, undefined, 'Order status updated');
}));

r.delete('/:id', authenticate, adminOrStaff, asyncHandler(async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) throw new ApiError(404, 'Order not found');
  await prisma.order.delete({ where: { id } });
  await recordActivity({ userId: req.user!.id, action: 'order.deleted', entity: 'Order', entityId: id, details: `Deleted order ${order.orderNumber}`, ip: req.ip });
  return ok(res, null, undefined, 'Order deleted');
}));

export default r;
