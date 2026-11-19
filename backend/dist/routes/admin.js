"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const os_1 = __importDefault(require("os"));
const prisma_1 = require("../config/prisma");
const auth_1 = require("../middleware/auth");
const http_1 = require("../utils/http");
const permissions_1 = require("../utils/permissions");
const r = (0, express_1.Router)();
r.use(auth_1.authenticate, auth_1.adminOrStaff);
r.get('/overview', (0, http_1.asyncHandler)(async (_req, res) => {
    const [users, customers, staff, products, orders, reviews, coupons, files, pendingReviews, lowStock] = await Promise.all([
        prisma_1.prisma.user.count(), prisma_1.prisma.user.count({ where: { role: 'customer' } }),
        prisma_1.prisma.user.count({ where: { role: { in: ['admin', 'staff'] } } }),
        prisma_1.prisma.product.count(), prisma_1.prisma.order.count(), prisma_1.prisma.review.count(), prisma_1.prisma.coupon.count(),
        prisma_1.prisma.fileAsset.count(), prisma_1.prisma.review.count({ where: { status: 'pending' } }),
        prisma_1.prisma.$queryRaw `SELECT COUNT(*)::bigint AS count FROM products WHERE stock_quantity <= minimum_stock`,
    ]);
    return (0, http_1.ok)(res, { users, customers, staff, products, orders, reviews, coupons, files, pendingReviews, lowStock: Number(lowStock[0]?.count ?? 0) });
}));
r.get('/roles', (0, http_1.asyncHandler)(async (_req, res) => (0, http_1.ok)(res, {
    roles: [
        { key: 'admin', label: 'Administrator', description: 'Full access to every module, setting and user.', permissions: permissions_1.ROLE_PERMISSIONS.admin },
        { key: 'staff', label: 'Staff', description: 'Day-to-day catalog, order and inventory operations.', permissions: permissions_1.ROLE_PERMISSIONS.staff },
        { key: 'customer', label: 'Customer', description: 'Storefront account with order and wishlist access.', permissions: [] },
    ],
    permissions: permissions_1.PERMISSION_CATALOG,
})));
r.get('/activity', (0, http_1.asyncHandler)(async (req, res) => {
    const { page, limit, skip } = (0, http_1.getPagination)(req.query, 20);
    const [items, total] = await Promise.all([
        prisma_1.prisma.activityLog.findMany({
            skip, take: limit, orderBy: { createdAt: 'desc' },
            include: { user: { select: { id: true, name: true, email: true, role: true, avatar: true } } },
        }),
        prisma_1.prisma.activityLog.count(),
    ]);
    return (0, http_1.ok)(res, items, (0, http_1.getMeta)(page, limit, total));
}));
r.get('/sessions', (0, auth_1.authorize)('admin'), (0, http_1.asyncHandler)(async (_req, res) => {
    const sessions = await prisma_1.prisma.loginHistory.findMany({
        take: 50, orderBy: { createdAt: 'desc' },
        include: { user: { select: { id: true, name: true, email: true, role: true } } },
    });
    return (0, http_1.ok)(res, sessions);
}));
r.get('/system', (0, http_1.asyncHandler)(async (_req, res) => {
    const start = Date.now();
    await prisma_1.prisma.$queryRaw `SELECT 1`;
    return (0, http_1.ok)(res, {
        database: { status: 'connected', latencyMs: Date.now() - start },
        runtime: {
            node: process.version, platform: process.platform, uptimeSeconds: Math.round(process.uptime()),
            memoryUsedMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
            cpus: os_1.default.cpus().length, environment: process.env.NODE_ENV ?? 'development',
        },
        api: { version: '1.0.0', timestamp: new Date().toISOString() },
    });
}));
exports.default = r;
