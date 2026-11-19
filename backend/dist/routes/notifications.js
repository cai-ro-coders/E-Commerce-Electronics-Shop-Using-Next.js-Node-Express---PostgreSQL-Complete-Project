"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../config/prisma");
const auth_1 = require("../middleware/auth");
const validate_1 = require("../middleware/validate");
const commerce_1 = require("../validators/commerce");
const http_1 = require("../utils/http");
const audit_1 = require("../utils/audit");
const r = (0, express_1.Router)();
r.get('/', auth_1.optionalAuth, (0, http_1.asyncHandler)(async (req, res) => {
    const { page, limit, skip } = (0, http_1.getPagination)(req.query, 20);
    const isStaff = !!req.user && ['admin', 'staff'].includes(req.user.role);
    const search = String(req.query.search || '');
    const type = req.query.type ? String(req.query.type) : undefined;
    const read = req.query.read;
    const allForAdmin = isStaff && req.query.all === 'true';
    const where = {};
    if (allForAdmin) {
        // Admin notification center sees every notification.
    }
    else if (req.user) {
        where.OR = [{ userId: req.user.id }, { userId: null }];
    }
    else {
        return (0, http_1.ok)(res, [], (0, http_1.getMeta)(1, limit, 0));
    }
    if (type)
        where.type = type;
    if (read === 'true')
        where.isRead = true;
    if (read === 'false')
        where.isRead = false;
    if (search)
        where.AND = [{ OR: [{ title: { contains: search, mode: 'insensitive' } }, { message: { contains: search, mode: 'insensitive' } }] }];
    const [items, total, unread] = await Promise.all([
        prisma_1.prisma.notification.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' }, include: { user: { select: { id: true, name: true, email: true, role: true } } } }),
        prisma_1.prisma.notification.count({ where }),
        req.user ? prisma_1.prisma.notification.count({ where: { userId: req.user.id, isRead: false } }) : Promise.resolve(0),
    ]);
    return (0, http_1.ok)(res, items, { ...(0, http_1.getMeta)(page, limit, total), unread });
}));
r.get('/unread-count', auth_1.authenticate, (0, http_1.asyncHandler)(async (req, res) => {
    const count = await prisma_1.prisma.notification.count({ where: { userId: req.user.id, isRead: false } });
    return (0, http_1.ok)(res, { count });
}));
r.patch('/:id/read', auth_1.authenticate, (0, http_1.asyncHandler)(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma_1.prisma.notification.findUnique({ where: { id } });
    if (!existing)
        throw new http_1.ApiError(404, 'Notification not found');
    if (existing.userId && existing.userId !== req.user.id && !['admin', 'staff'].includes(req.user.role))
        throw new http_1.ApiError(403, 'You cannot update this notification');
    const notification = await prisma_1.prisma.notification.update({ where: { id }, data: { isRead: true } });
    return (0, http_1.ok)(res, notification, undefined, 'Marked as read');
}));
r.post('/read-all', auth_1.authenticate, (0, http_1.asyncHandler)(async (req, res) => {
    const result = await prisma_1.prisma.notification.updateMany({ where: { userId: req.user.id, isRead: false }, data: { isRead: true } });
    return (0, http_1.ok)(res, { updated: result.count }, undefined, 'All notifications marked as read');
}));
r.post('/', auth_1.authenticate, auth_1.adminOrStaff, (0, validate_1.validateBody)(commerce_1.notificationSchema), (0, http_1.asyncHandler)(async (req, res) => {
    const data = req.body;
    const notification = await prisma_1.prisma.notification.create({
        data: { title: data.title, message: data.message, type: data.type ?? 'system', userId: data.userId ?? null, link: data.link ?? null },
    });
    await (0, audit_1.recordActivity)({ userId: req.user.id, action: 'notification.created', entity: 'Notification', entityId: notification.id, details: `Sent notification ${notification.title}`, ip: req.ip });
    return (0, http_1.created)(res, notification, 'Notification sent');
}));
r.delete('/:id', auth_1.authenticate, (0, http_1.asyncHandler)(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma_1.prisma.notification.findUnique({ where: { id } });
    if (!existing)
        throw new http_1.ApiError(404, 'Notification not found');
    if (existing.userId && existing.userId !== req.user.id && !['admin', 'staff'].includes(req.user.role))
        throw new http_1.ApiError(403, 'You cannot delete this notification');
    await prisma_1.prisma.notification.delete({ where: { id } });
    return (0, http_1.ok)(res, null, undefined, 'Notification deleted');
}));
exports.default = r;
