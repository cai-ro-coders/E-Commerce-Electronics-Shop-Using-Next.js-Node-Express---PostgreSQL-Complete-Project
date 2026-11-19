"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../config/prisma");
const auth_1 = require("../middleware/auth");
const validate_1 = require("../middleware/validate");
const commerce_1 = require("../validators/commerce");
const http_1 = require("../utils/http");
const sanitize_1 = require("../utils/sanitize");
const audit_1 = require("../utils/audit");
const r = (0, express_1.Router)();
r.post('/', (0, validate_1.validateBody)(commerce_1.contactSchema), (0, http_1.asyncHandler)(async (req, res) => {
    const data = req.body;
    const message = await prisma_1.prisma.contactMessage.create({
        data: { name: (0, sanitize_1.sanitizeText)(data.name), email: data.email, subject: (0, sanitize_1.sanitizeText)(data.subject), message: (0, sanitize_1.sanitizeText)(data.message) },
    });
    await (0, audit_1.notify)({ userId: null, title: 'New contact message', message: `${data.name}: ${data.subject}`, type: 'customer', link: '/admin/notifications' });
    return (0, http_1.created)(res, { id: message.id }, 'Message received. Our team will reply within one business day.');
}));
r.get('/', auth_1.authenticate, auth_1.adminOrStaff, (0, http_1.asyncHandler)(async (req, res) => {
    const { page, limit, skip } = (0, http_1.getPagination)(req.query, 20);
    const status = req.query.status ? String(req.query.status) : undefined;
    const where = status ? { status } : {};
    const [items, total] = await Promise.all([
        prisma_1.prisma.contactMessage.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
        prisma_1.prisma.contactMessage.count({ where }),
    ]);
    return (0, http_1.ok)(res, items, (0, http_1.getMeta)(page, limit, total));
}));
r.patch('/:id', auth_1.authenticate, auth_1.adminOrStaff, (0, http_1.asyncHandler)(async (req, res) => {
    const status = String(req.body.status || '');
    if (!['new', 'read', 'replied', 'archived'].includes(status))
        throw new http_1.ApiError(400, 'Invalid status');
    const message = await prisma_1.prisma.contactMessage.update({ where: { id: Number(req.params.id) }, data: { status } });
    return (0, http_1.ok)(res, message, undefined, 'Message updated');
}));
r.delete('/:id', auth_1.authenticate, auth_1.adminOrStaff, (0, http_1.asyncHandler)(async (req, res) => {
    await prisma_1.prisma.contactMessage.delete({ where: { id: Number(req.params.id) } });
    return (0, http_1.ok)(res, null, undefined, 'Message deleted');
}));
exports.default = r;
