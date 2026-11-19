"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../config/prisma");
const auth_1 = require("../middleware/auth");
const validate_1 = require("../middleware/validate");
const commerce_1 = require("../validators/commerce");
const http_1 = require("../utils/http");
const orderService_1 = require("../services/orderService");
const audit_1 = require("../utils/audit");
const csv_1 = require("../utils/csv");
const r = (0, express_1.Router)();
function buildWhere(query) {
    const where = {};
    const and = [];
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
    if (query.status)
        and.push({ orderStatus: query.status });
    if (query.paymentStatus)
        and.push({ paymentStatus: query.paymentStatus });
    const { start, end } = (0, http_1.dateRange)(query.from, query.to);
    if (start || end)
        and.push({ createdAt: { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) } });
    if (and.length)
        where.AND = and;
    return where;
}
function orderByFor(query) {
    if (query.sortBy)
        return { [query.sortBy]: (0, http_1.sortOrder)(query.sortDir) };
    return { createdAt: 'desc' };
}
r.get('/stats', auth_1.authenticate, auth_1.adminOrStaff, (0, http_1.asyncHandler)(async (_req, res) => (0, http_1.ok)(res, await (0, orderService_1.orderStats)())));
r.get('/export', auth_1.authenticate, auth_1.adminOrStaff, (0, http_1.asyncHandler)(async (req, res) => {
    const where = buildWhere(req.query);
    const orders = await prisma_1.prisma.order.findMany({
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
    return (0, csv_1.sendCsv)(res, 'orders.csv', (0, csv_1.toCsv)(rows));
}));
r.get('/export/csv', auth_1.authenticate, auth_1.adminOrStaff, (0, http_1.asyncHandler)(async (req, res) => {
    const where = buildWhere(req.query);
    const orders = await prisma_1.prisma.order.findMany({ where, include: { user: true }, orderBy: { createdAt: 'desc' } });
    const rows = orders.map((o) => ({
        order_number: o.orderNumber, customer: o.user?.name ?? '', email: o.user?.email ?? '',
        date: o.createdAt.toISOString(), payment_status: o.paymentStatus, order_status: o.orderStatus, total: Number(o.grandTotal),
    }));
    return (0, csv_1.sendCsv)(res, 'orders.csv', (0, csv_1.toCsv)(rows));
}));
r.get('/my', auth_1.authenticate, (0, validate_1.validateQuery)(commerce_1.orderQuery), (0, http_1.asyncHandler)(async (req, res) => {
    const { page, limit, skip } = (0, http_1.getPagination)(req.query);
    const query = req.query;
    const where = { userId: req.user.id };
    if (query.status)
        where.orderStatus = query.status;
    if (query.paymentStatus)
        where.paymentStatus = query.paymentStatus;
    if (query.search)
        where.OR = [{ orderNumber: { contains: query.search, mode: 'insensitive' } }];
    const [items, total] = await Promise.all([
        prisma_1.prisma.order.findMany({ where, skip, take: limit, include: orderService_1.orderInclude, orderBy: { createdAt: 'desc' } }),
        prisma_1.prisma.order.count({ where }),
    ]);
    return (0, http_1.ok)(res, items, (0, http_1.getMeta)(page, limit, total));
}));
r.get('/my/summary', auth_1.authenticate, (0, http_1.asyncHandler)(async (req, res) => {
    const userId = req.user.id;
    const [totalOrders, pendingOrders, spend] = await Promise.all([
        prisma_1.prisma.order.count({ where: { userId } }),
        prisma_1.prisma.order.count({ where: { userId, orderStatus: 'Pending' } }),
        prisma_1.prisma.order.aggregate({
            where: { userId, orderStatus: { notIn: ['Cancelled', 'Returned'] } },
            _sum: { grandTotal: true },
        }),
    ]);
    return (0, http_1.ok)(res, { totalOrders, pendingOrders, totalSpent: Number(spend._sum.grandTotal ?? 0) });
}));
r.get('/track/:orderNumber', (0, http_1.asyncHandler)(async (req, res) => {
    const order = await prisma_1.prisma.order.findUnique({
        where: { orderNumber: req.params.orderNumber },
        select: {
            orderNumber: true, orderStatus: true, paymentStatus: true, trackingNumber: true,
            carrier: true, estimatedDelivery: true, createdAt: true, grandTotal: true,
            statusHistory: { orderBy: { createdAt: 'asc' } },
            items: { select: { productName: true, quantity: true, total: true } },
        },
    });
    if (!order)
        throw new http_1.ApiError(404, 'No order found with that number');
    return (0, http_1.ok)(res, order);
}));
r.get('/', auth_1.authenticate, auth_1.adminOrStaff, (0, validate_1.validateQuery)(commerce_1.orderQuery), (0, http_1.asyncHandler)(async (req, res) => {
    const query = req.query;
    const { page, limit, skip } = (0, http_1.getPagination)(query);
    const where = buildWhere(query);
    const [items, total] = await Promise.all([
        prisma_1.prisma.order.findMany({ where, skip, take: limit, include: orderService_1.orderInclude, orderBy: orderByFor(query) }),
        prisma_1.prisma.order.count({ where }),
    ]);
    return (0, http_1.ok)(res, items, (0, http_1.getMeta)(page, limit, total));
}));
r.post('/checkout', auth_1.authenticate, (0, validate_1.validateBody)(commerce_1.checkoutSchema), (0, http_1.asyncHandler)(async (req, res) => {
    const order = await (0, orderService_1.checkout)(req.user.id, req.body, req.ip);
    return (0, http_1.created)(res, order, 'Order placed successfully');
}));
r.get('/:id/receipt', auth_1.authenticate, (0, http_1.asyncHandler)(async (req, res) => {
    const id = Number(req.params.id);
    const order = await prisma_1.prisma.order.findUnique({ where: { id }, include: orderService_1.orderInclude });
    if (!order)
        throw new http_1.ApiError(404, 'Order not found');
    if (!['admin', 'staff'].includes(req.user.role) && order.userId !== req.user.id)
        throw new http_1.ApiError(403, 'You cannot access this receipt');
    const settings = await prisma_1.prisma.setting.findMany({ where: { group: 'general' } });
    return (0, http_1.ok)(res, { order, settings: Object.fromEntries(settings.map((s) => [s.key, s.value])) });
}));
r.get('/:id', auth_1.authenticate, (0, http_1.asyncHandler)(async (req, res) => {
    const id = Number(req.params.id);
    const order = await prisma_1.prisma.order.findUnique({ where: { id }, include: orderService_1.orderInclude });
    if (!order)
        throw new http_1.ApiError(404, 'Order not found');
    if (!['admin', 'staff'].includes(req.user.role) && order.userId !== req.user.id)
        throw new http_1.ApiError(403, 'You cannot access this order');
    return (0, http_1.ok)(res, order);
}));
r.put('/:id', auth_1.authenticate, auth_1.adminOrStaff, (0, validate_1.validateBody)(commerce_1.orderUpdateSchema), (0, http_1.asyncHandler)(async (req, res) => {
    const order = await (0, orderService_1.updateOrderStatus)(Number(req.params.id), req.body, req.user.id, req.ip);
    return (0, http_1.ok)(res, order, undefined, 'Order updated');
}));
r.patch('/:id/status', auth_1.authenticate, auth_1.adminOrStaff, (0, validate_1.validateBody)(commerce_1.orderUpdateSchema), (0, http_1.asyncHandler)(async (req, res) => {
    const order = await (0, orderService_1.updateOrderStatus)(Number(req.params.id), req.body, req.user.id, req.ip);
    return (0, http_1.ok)(res, order, undefined, 'Order status updated');
}));
r.delete('/:id', auth_1.authenticate, auth_1.adminOrStaff, (0, http_1.asyncHandler)(async (req, res) => {
    const id = Number(req.params.id);
    const order = await prisma_1.prisma.order.findUnique({ where: { id } });
    if (!order)
        throw new http_1.ApiError(404, 'Order not found');
    await prisma_1.prisma.order.delete({ where: { id } });
    await (0, audit_1.recordActivity)({ userId: req.user.id, action: 'order.deleted', entity: 'Order', entityId: id, details: `Deleted order ${order.orderNumber}`, ip: req.ip });
    return (0, http_1.ok)(res, null, undefined, 'Order deleted');
}));
exports.default = r;
