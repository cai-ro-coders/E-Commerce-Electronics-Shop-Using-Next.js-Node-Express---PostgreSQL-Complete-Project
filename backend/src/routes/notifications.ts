import { Router } from 'express';
import { prisma } from '../config/prisma';
import { authenticate, adminOrStaff, optionalAuth, AuthRequest } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { notificationSchema } from '../validators/commerce';
import { ApiError, asyncHandler, created, getMeta, getPagination, ok } from '../utils/http';
import { recordActivity } from '../utils/audit';

const r = Router();

r.get('/', optionalAuth, asyncHandler(async (req: AuthRequest, res) => {
  const { page, limit, skip } = getPagination(req.query as any, 20);
  const isStaff = !!req.user && ['admin', 'staff'].includes(req.user.role);
  const search = String(req.query.search || '');
  const type = req.query.type ? String(req.query.type) : undefined;
  const read = req.query.read;
  const allForAdmin = isStaff && req.query.all === 'true';

  const where: any = {};
  if (allForAdmin) {
    // Admin notification center sees every notification.
  } else if (req.user) {
    where.OR = [{ userId: req.user.id }, { userId: null }];
  } else {
    return ok(res, [], getMeta(1, limit, 0));
  }
  if (type) where.type = type;
  if (read === 'true') where.isRead = true;
  if (read === 'false') where.isRead = false;
  if (search) where.AND = [{ OR: [{ title: { contains: search, mode: 'insensitive' } }, { message: { contains: search, mode: 'insensitive' } }] }];

  const [items, total, unread] = await Promise.all([
    prisma.notification.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' }, include: { user: { select: { id: true, name: true, email: true, role: true } } } }),
    prisma.notification.count({ where }),
    req.user ? prisma.notification.count({ where: { userId: req.user.id, isRead: false } }) : Promise.resolve(0),
  ]);
  return ok(res, items, { ...getMeta(page, limit, total), unread });
}));

r.get('/unread-count', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const count = await prisma.notification.count({ where: { userId: req.user!.id, isRead: false } });
  return ok(res, { count });
}));

r.patch('/:id/read', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.notification.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, 'Notification not found');
  if (existing.userId && existing.userId !== req.user!.id && !['admin', 'staff'].includes(req.user!.role)) throw new ApiError(403, 'You cannot update this notification');
  const notification = await prisma.notification.update({ where: { id }, data: { isRead: true } });
  return ok(res, notification, undefined, 'Marked as read');
}));

r.post('/read-all', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const result = await prisma.notification.updateMany({ where: { userId: req.user!.id, isRead: false }, data: { isRead: true } });
  return ok(res, { updated: result.count }, undefined, 'All notifications marked as read');
}));

r.post('/', authenticate, adminOrStaff, validateBody(notificationSchema), asyncHandler(async (req: AuthRequest, res) => {
  const data = req.body;
  const notification = await prisma.notification.create({
    data: { title: data.title, message: data.message, type: data.type ?? 'system', userId: data.userId ?? null, link: data.link ?? null },
  });
  await recordActivity({ userId: req.user!.id, action: 'notification.created', entity: 'Notification', entityId: notification.id, details: `Sent notification ${notification.title}`, ip: req.ip });
  return created(res, notification, 'Notification sent');
}));

r.delete('/:id', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.notification.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, 'Notification not found');
  if (existing.userId && existing.userId !== req.user!.id && !['admin', 'staff'].includes(req.user!.role)) throw new ApiError(403, 'You cannot delete this notification');
  await prisma.notification.delete({ where: { id } });
  return ok(res, null, undefined, 'Notification deleted');
}));

export default r;
