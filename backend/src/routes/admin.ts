import { Router } from 'express';
import os from 'os';
import { prisma } from '../config/prisma';
import { authenticate, adminOrStaff, authorize, AuthRequest } from '../middleware/auth';
import { asyncHandler, getPagination, getMeta, ok } from '../utils/http';
import { PERMISSION_CATALOG, ROLE_PERMISSIONS } from '../utils/permissions';

const r = Router();
r.use(authenticate, adminOrStaff);

r.get('/overview', asyncHandler(async (_req, res) => {
  const [users, customers, staff, products, orders, reviews, coupons, files, pendingReviews, lowStock] = await Promise.all([
    prisma.user.count(), prisma.user.count({ where: { role: 'customer' } }),
    prisma.user.count({ where: { role: { in: ['admin', 'staff'] } } }),
    prisma.product.count(), prisma.order.count(), prisma.review.count(), prisma.coupon.count(),
    prisma.fileAsset.count(), prisma.review.count({ where: { status: 'pending' } }),
    prisma.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*)::bigint AS count FROM products WHERE stock_quantity <= minimum_stock`,
  ]);
  return ok(res, { users, customers, staff, products, orders, reviews, coupons, files, pendingReviews, lowStock: Number(lowStock[0]?.count ?? 0) });
}));

r.get('/roles', asyncHandler(async (_req, res) => ok(res, {
  roles: [
    { key: 'admin', label: 'Administrator', description: 'Full access to every module, setting and user.', permissions: ROLE_PERMISSIONS.admin },
    { key: 'staff', label: 'Staff', description: 'Day-to-day catalog, order and inventory operations.', permissions: ROLE_PERMISSIONS.staff },
    { key: 'customer', label: 'Customer', description: 'Storefront account with order and wishlist access.', permissions: [] },
  ],
  permissions: PERMISSION_CATALOG,
})));

r.get('/activity', asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query as any, 20);
  const [items, total] = await Promise.all([
    prisma.activityLog.findMany({
      skip, take: limit, orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, name: true, email: true, role: true, avatar: true } } },
    }),
    prisma.activityLog.count(),
  ]);
  return ok(res, items, getMeta(page, limit, total));
}));

r.get('/sessions', authorize('admin'), asyncHandler(async (_req, res) => {
  const sessions = await prisma.loginHistory.findMany({
    take: 50, orderBy: { createdAt: 'desc' },
    include: { user: { select: { id: true, name: true, email: true, role: true } } },
  });
  return ok(res, sessions);
}));

r.get('/system', asyncHandler(async (_req, res) => {
  const start = Date.now();
  await prisma.$queryRaw`SELECT 1`;
  return ok(res, {
    database: { status: 'connected', latencyMs: Date.now() - start },
    runtime: {
      node: process.version, platform: process.platform, uptimeSeconds: Math.round(process.uptime()),
      memoryUsedMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      cpus: os.cpus().length, environment: process.env.NODE_ENV ?? 'development',
    },
    api: { version: '1.0.0', timestamp: new Date().toISOString() },
  });
}));

export default r;
