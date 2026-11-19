import { Router } from 'express';
import { prisma } from '../config/prisma';
import { authenticate, adminOrStaff, authorize, AuthRequest } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { createStaffSchema, updateUserSchema } from '../validators/auth';
import { ApiError, asyncHandler, created, getMeta, getPagination, ok } from '../utils/http';
import { hashPassword } from '../utils/password';
import { PERMISSION_CATALOG, permissionsForRole } from '../utils/permissions';
import { sanitizeText } from '../utils/sanitize';
import { recordActivity } from '../utils/audit';

const r = Router();
r.use(authenticate, adminOrStaff);

const select = {
  id: true, name: true, email: true, role: true, status: true, phone: true, avatar: true,
  permissions: true, lastLoginAt: true, createdAt: true, updatedAt: true,
  _count: { select: { orders: true, activityLogs: true, loginHistory: true } },
} as const;

r.get('/permissions', asyncHandler(async (_req, res) => ok(res, PERMISSION_CATALOG)));

r.get('/activity', asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query as any, 20);
  const search = String(req.query.search || '');
  const where: any = search ? { OR: [
    { action: { contains: search, mode: 'insensitive' } },
    { details: { contains: search, mode: 'insensitive' } },
    { user: { name: { contains: search, mode: 'insensitive' } } },
  ] } : {};
  const [items, total] = await Promise.all([
    prisma.activityLog.findMany({
      where, skip, take: limit, orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, name: true, email: true, avatar: true, role: true } } },
    }),
    prisma.activityLog.count({ where }),
  ]);
  return ok(res, items, getMeta(page, limit, total));
}));

r.get('/', asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query as any, 20);
  const search = String(req.query.search || '');
  const role = req.query.role ? String(req.query.role) : undefined;
  const status = req.query.status ? String(req.query.status) : undefined;
  const where: any = {
    ...(role ? { role } : {}),
    ...(status ? { status } : {}),
    ...(search ? { OR: [
      { name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      { phone: { contains: search, mode: 'insensitive' } },
    ] } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.user.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' }, select }),
    prisma.user.count({ where }),
  ]);
  return ok(res, items.map((u) => ({ ...u, permissions: permissionsForRole(u.role, u.permissions) })), getMeta(page, limit, total));
}));

r.get('/:id', asyncHandler(async (req: AuthRequest, res) => {
  const user = await prisma.user.findUnique({
    where: { id: Number(req.params.id) },
    select: {
      ...select,
      activityLogs: { orderBy: { createdAt: 'desc' }, take: 20 },
      loginHistory: { orderBy: { createdAt: 'desc' }, take: 20 },
    },
  });
  if (!user) throw new ApiError(404, 'User not found');
  return ok(res, { ...user, permissions: permissionsForRole(user.role, user.permissions) });
}));

r.post('/', authorize('admin'), validateBody(createStaffSchema), asyncHandler(async (req: AuthRequest, res) => {
  const data = req.body;
  if (await prisma.user.findUnique({ where: { email: data.email } })) throw new ApiError(409, 'Email already in use');
  const user = await prisma.user.create({
    data: {
      name: sanitizeText(data.name)!, email: data.email, password: await hashPassword(data.password),
      role: data.role, status: data.status ?? 'active', phone: data.phone ? sanitizeText(data.phone) : null,
      avatar: data.avatar ?? null, permissions: data.permissions ?? permissionsForRole(data.role),
    },
    select,
  });
  await recordActivity({ userId: req.user!.id, action: 'user.created', entity: 'User', entityId: user.id, details: `Created ${user.role} ${user.name}`, ip: req.ip });
  return created(res, { ...user, permissions: permissionsForRole(user.role, user.permissions) }, 'User created');
}));

r.put('/:id', authorize('admin'), validateBody(updateUserSchema), asyncHandler(async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, 'User not found');
  const data = req.body;
  if (id === req.user!.id && data.role && data.role !== 'admin') throw new ApiError(400, 'You cannot remove your own admin role');
  if (id === req.user!.id && data.status && data.status !== 'active') throw new ApiError(400, 'You cannot deactivate your own account');
  const roleChanged = data.role !== undefined && data.role !== existing.role;
  const user = await prisma.user.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: sanitizeText(data.name)! } : {}),
      ...(data.email !== undefined ? { email: data.email } : {}),
      ...(data.password ? { password: await hashPassword(data.password) } : {}),
      ...(data.phone !== undefined ? { phone: data.phone ? sanitizeText(data.phone) : null } : {}),
      ...(data.avatar !== undefined ? { avatar: data.avatar } : {}),
      ...(data.role !== undefined ? { role: data.role } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.permissions !== undefined || roleChanged ? { permissions: roleChanged ? permissionsForRole(data.role!, []) : (data.permissions ?? []) } : {}),
    },
    select,
  });
  await recordActivity({ userId: req.user!.id, action: 'user.updated', entity: 'User', entityId: id, details: `Updated user ${user.name}`, ip: req.ip });
  return ok(res, { ...user, permissions: permissionsForRole(user.role, user.permissions) }, undefined, 'User updated');
}));

r.patch('/:id/status', authorize('admin'), asyncHandler(async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  if (id === req.user!.id) throw new ApiError(400, 'You cannot change your own account status');
  const status = String(req.body.status || '');
  if (!['active', 'inactive', 'suspended'].includes(status)) throw new ApiError(400, 'Invalid status');
  const user = await prisma.user.update({ where: { id }, data: { status }, select });
  await recordActivity({ userId: req.user!.id, action: 'user.status_changed', entity: 'User', entityId: id, details: `Set user ${user.name} status to ${status}`, ip: req.ip });
  return ok(res, user, undefined, `User ${status === 'active' ? 'activated' : 'deactivated'}`);
}));

r.delete('/:id', authorize('admin'), asyncHandler(async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  if (id === req.user!.id) throw new ApiError(400, 'You cannot delete your own account');
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new ApiError(404, 'User not found');
  if (user.role === 'admin') {
    const admins = await prisma.user.count({ where: { role: 'admin', status: 'active' } });
    if (admins <= 1) throw new ApiError(400, 'The last active administrator cannot be deleted');
  }
  await prisma.user.delete({ where: { id } });
  await recordActivity({ userId: req.user!.id, action: 'user.deleted', entity: 'User', entityId: id, details: `Deleted user ${user.name}`, ip: req.ip });
  return ok(res, null, undefined, 'User deleted');
}));

export default r;
