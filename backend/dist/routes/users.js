"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../config/prisma");
const auth_1 = require("../middleware/auth");
const validate_1 = require("../middleware/validate");
const auth_2 = require("../validators/auth");
const http_1 = require("../utils/http");
const password_1 = require("../utils/password");
const permissions_1 = require("../utils/permissions");
const sanitize_1 = require("../utils/sanitize");
const audit_1 = require("../utils/audit");
const r = (0, express_1.Router)();
r.use(auth_1.authenticate, auth_1.adminOrStaff);
const select = {
    id: true, name: true, email: true, role: true, status: true, phone: true, avatar: true,
    permissions: true, lastLoginAt: true, createdAt: true, updatedAt: true,
    _count: { select: { orders: true, activityLogs: true, loginHistory: true } },
};
r.get('/permissions', (0, http_1.asyncHandler)(async (_req, res) => (0, http_1.ok)(res, permissions_1.PERMISSION_CATALOG)));
r.get('/activity', (0, http_1.asyncHandler)(async (req, res) => {
    const { page, limit, skip } = (0, http_1.getPagination)(req.query, 20);
    const search = String(req.query.search || '');
    const where = search ? { OR: [
            { action: { contains: search, mode: 'insensitive' } },
            { details: { contains: search, mode: 'insensitive' } },
            { user: { name: { contains: search, mode: 'insensitive' } } },
        ] } : {};
    const [items, total] = await Promise.all([
        prisma_1.prisma.activityLog.findMany({
            where, skip, take: limit, orderBy: { createdAt: 'desc' },
            include: { user: { select: { id: true, name: true, email: true, avatar: true, role: true } } },
        }),
        prisma_1.prisma.activityLog.count({ where }),
    ]);
    return (0, http_1.ok)(res, items, (0, http_1.getMeta)(page, limit, total));
}));
r.get('/', (0, http_1.asyncHandler)(async (req, res) => {
    const { page, limit, skip } = (0, http_1.getPagination)(req.query, 20);
    const search = String(req.query.search || '');
    const role = req.query.role ? String(req.query.role) : undefined;
    const status = req.query.status ? String(req.query.status) : undefined;
    const where = {
        ...(role ? { role } : {}),
        ...(status ? { status } : {}),
        ...(search ? { OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search, mode: 'insensitive' } },
            ] } : {}),
    };
    const [items, total] = await Promise.all([
        prisma_1.prisma.user.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' }, select }),
        prisma_1.prisma.user.count({ where }),
    ]);
    return (0, http_1.ok)(res, items.map((u) => ({ ...u, permissions: (0, permissions_1.permissionsForRole)(u.role, u.permissions) })), (0, http_1.getMeta)(page, limit, total));
}));
r.get('/:id', (0, http_1.asyncHandler)(async (req, res) => {
    const user = await prisma_1.prisma.user.findUnique({
        where: { id: Number(req.params.id) },
        select: {
            ...select,
            activityLogs: { orderBy: { createdAt: 'desc' }, take: 20 },
            loginHistory: { orderBy: { createdAt: 'desc' }, take: 20 },
        },
    });
    if (!user)
        throw new http_1.ApiError(404, 'User not found');
    return (0, http_1.ok)(res, { ...user, permissions: (0, permissions_1.permissionsForRole)(user.role, user.permissions) });
}));
r.post('/', (0, auth_1.authorize)('admin'), (0, validate_1.validateBody)(auth_2.createStaffSchema), (0, http_1.asyncHandler)(async (req, res) => {
    const data = req.body;
    if (await prisma_1.prisma.user.findUnique({ where: { email: data.email } }))
        throw new http_1.ApiError(409, 'Email already in use');
    const user = await prisma_1.prisma.user.create({
        data: {
            name: (0, sanitize_1.sanitizeText)(data.name), email: data.email, password: await (0, password_1.hashPassword)(data.password),
            role: data.role, status: data.status ?? 'active', phone: data.phone ? (0, sanitize_1.sanitizeText)(data.phone) : null,
            avatar: data.avatar ?? null, permissions: data.permissions ?? (0, permissions_1.permissionsForRole)(data.role),
        },
        select,
    });
    await (0, audit_1.recordActivity)({ userId: req.user.id, action: 'user.created', entity: 'User', entityId: user.id, details: `Created ${user.role} ${user.name}`, ip: req.ip });
    return (0, http_1.created)(res, { ...user, permissions: (0, permissions_1.permissionsForRole)(user.role, user.permissions) }, 'User created');
}));
r.put('/:id', (0, auth_1.authorize)('admin'), (0, validate_1.validateBody)(auth_2.updateUserSchema), (0, http_1.asyncHandler)(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma_1.prisma.user.findUnique({ where: { id } });
    if (!existing)
        throw new http_1.ApiError(404, 'User not found');
    const data = req.body;
    if (id === req.user.id && data.role && data.role !== 'admin')
        throw new http_1.ApiError(400, 'You cannot remove your own admin role');
    if (id === req.user.id && data.status && data.status !== 'active')
        throw new http_1.ApiError(400, 'You cannot deactivate your own account');
    const roleChanged = data.role !== undefined && data.role !== existing.role;
    const user = await prisma_1.prisma.user.update({
        where: { id },
        data: {
            ...(data.name !== undefined ? { name: (0, sanitize_1.sanitizeText)(data.name) } : {}),
            ...(data.email !== undefined ? { email: data.email } : {}),
            ...(data.password ? { password: await (0, password_1.hashPassword)(data.password) } : {}),
            ...(data.phone !== undefined ? { phone: data.phone ? (0, sanitize_1.sanitizeText)(data.phone) : null } : {}),
            ...(data.avatar !== undefined ? { avatar: data.avatar } : {}),
            ...(data.role !== undefined ? { role: data.role } : {}),
            ...(data.status !== undefined ? { status: data.status } : {}),
            ...(data.permissions !== undefined || roleChanged ? { permissions: roleChanged ? (0, permissions_1.permissionsForRole)(data.role, []) : (data.permissions ?? []) } : {}),
        },
        select,
    });
    await (0, audit_1.recordActivity)({ userId: req.user.id, action: 'user.updated', entity: 'User', entityId: id, details: `Updated user ${user.name}`, ip: req.ip });
    return (0, http_1.ok)(res, { ...user, permissions: (0, permissions_1.permissionsForRole)(user.role, user.permissions) }, undefined, 'User updated');
}));
r.patch('/:id/status', (0, auth_1.authorize)('admin'), (0, http_1.asyncHandler)(async (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id)
        throw new http_1.ApiError(400, 'You cannot change your own account status');
    const status = String(req.body.status || '');
    if (!['active', 'inactive', 'suspended'].includes(status))
        throw new http_1.ApiError(400, 'Invalid status');
    const user = await prisma_1.prisma.user.update({ where: { id }, data: { status }, select });
    await (0, audit_1.recordActivity)({ userId: req.user.id, action: 'user.status_changed', entity: 'User', entityId: id, details: `Set user ${user.name} status to ${status}`, ip: req.ip });
    return (0, http_1.ok)(res, user, undefined, `User ${status === 'active' ? 'activated' : 'deactivated'}`);
}));
r.delete('/:id', (0, auth_1.authorize)('admin'), (0, http_1.asyncHandler)(async (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id)
        throw new http_1.ApiError(400, 'You cannot delete your own account');
    const user = await prisma_1.prisma.user.findUnique({ where: { id } });
    if (!user)
        throw new http_1.ApiError(404, 'User not found');
    if (user.role === 'admin') {
        const admins = await prisma_1.prisma.user.count({ where: { role: 'admin', status: 'active' } });
        if (admins <= 1)
            throw new http_1.ApiError(400, 'The last active administrator cannot be deleted');
    }
    await prisma_1.prisma.user.delete({ where: { id } });
    await (0, audit_1.recordActivity)({ userId: req.user.id, action: 'user.deleted', entity: 'User', entityId: id, details: `Deleted user ${user.name}`, ip: req.ip });
    return (0, http_1.ok)(res, null, undefined, 'User deleted');
}));
exports.default = r;
