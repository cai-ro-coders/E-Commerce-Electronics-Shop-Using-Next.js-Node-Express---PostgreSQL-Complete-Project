"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../config/prisma");
const auth_1 = require("../middleware/auth");
const http_1 = require("../utils/http");
const r = (0, express_1.Router)();
function dayKey(d) {
    return d.toISOString().slice(0, 10);
}
r.get('/admin', auth_1.authenticate, auth_1.adminOrStaff, (0, http_1.asyncHandler)(async (_req, res) => {
    const now = new Date();
    const today = (0, http_1.startOfDay)(now);
    const yesterday = (0, http_1.addDays)(today, -1);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    const seriesStart = (0, http_1.addDays)(today, -13);
    const [orders, products, totalCustomers, newCustomers, revenueAgg, refundAgg, statusGroups, methodGroups, bestGroups] = await Promise.all([
        prisma_1.prisma.order.findMany({
            where: { createdAt: { gte: (0, http_1.addDays)(today, -60) } },
            include: {
                user: { select: { id: true, name: true, email: true, avatar: true } },
                items: { include: { product: { select: { costPrice: true } } } },
                payment: true,
            },
        }),
        prisma_1.prisma.product.findMany({
            select: { id: true, name: true, sku: true, stockQuantity: true, minimumStock: true, price: true, costPrice: true, images: { take: 1, orderBy: { sortOrder: 'asc' } }, category: { select: { name: true } } },
        }),
        prisma_1.prisma.user.count({ where: { role: 'customer' } }),
        prisma_1.prisma.user.count({ where: { role: 'customer', createdAt: { gte: monthStart } } }),
        prisma_1.prisma.payment.aggregate({ where: { status: 'Paid' }, _sum: { amount: true } }),
        prisma_1.prisma.payment.aggregate({ where: { status: 'Refunded' }, _sum: { amount: true } }),
        prisma_1.prisma.order.groupBy({ by: ['orderStatus'], _count: { _all: true } }),
        prisma_1.prisma.order.groupBy({ by: ['paymentMethod'], _count: { _all: true } }),
        prisma_1.prisma.orderItem.groupBy({ by: ['productId'], where: { order: { paymentStatus: 'Paid' } }, _sum: { quantity: true, total: true }, orderBy: { _sum: { quantity: 'desc' } }, take: 8 }),
    ]);
    const paidOrders = orders.filter((o) => o.paymentStatus === 'Paid');
    const totalRevenue = (0, http_1.money)(Number(revenueAgg._sum.amount ?? 0));
    const refunds = (0, http_1.money)(Number(refundAgg._sum.amount ?? 0));
    let netEarning = 0;
    for (const order of paidOrders) {
        for (const item of order.items) {
            const cost = Number(item.product?.costPrice ?? Number(item.price) * 0.7);
            netEarning += Number(item.price) * item.quantity - cost * item.quantity;
        }
        netEarning -= Number(order.discount);
    }
    netEarning = (0, http_1.money)(Math.max(0, netEarning));
    const todayOrders = orders.filter((o) => o.createdAt >= today).length;
    const yesterdayOrders = orders.filter((o) => o.createdAt >= yesterday && o.createdAt < today).length;
    const lowStockProducts = products.filter((p) => p.stockQuantity <= p.minimumStock).sort((a, b) => a.stockQuantity - b.stockQuantity);
    const avgOrder = orders.length ? (0, http_1.money)(orders.reduce((s, o) => s + Number(o.grandTotal), 0) / orders.length) : 0;
    const labels = [];
    const revenueSeries = [];
    const orderSeries = [];
    for (let i = 13; i >= 0; i--) {
        const day = (0, http_1.addDays)(today, -i);
        const key = dayKey(day);
        labels.push(day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
        const dayOrders = orders.filter((o) => dayKey(o.createdAt) === key);
        revenueSeries.push((0, http_1.money)(dayOrders.filter((o) => o.paymentStatus === 'Paid').reduce((s, o) => s + Number(o.grandTotal), 0)));
        orderSeries.push(dayOrders.length);
    }
    const thisMonthRevenue = (0, http_1.money)(paidOrders.filter((o) => o.createdAt >= monthStart).reduce((s, o) => s + Number(o.grandTotal), 0));
    const lastMonthRevenue = (0, http_1.money)(paidOrders.filter((o) => o.createdAt >= lastMonthStart && o.createdAt <= lastMonthEnd).reduce((s, o) => s + Number(o.grandTotal), 0));
    const growth = lastMonthRevenue > 0 ? (0, http_1.money)(((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100) : 100;
    const bestSellers = await Promise.all(bestGroups.map(async (g) => {
        const product = await prisma_1.prisma.product.findUnique({
            where: { id: g.productId ?? 0 },
            select: { id: true, name: true, slug: true, price: true, images: { take: 1, orderBy: { sortOrder: 'asc' } }, category: { select: { name: true } } },
        });
        return { product, quantity: g._sum.quantity ?? 0, revenue: (0, http_1.money)(Number(g._sum.total ?? 0)) };
    }));
    const recentOrders = await prisma_1.prisma.order.findMany({
        take: 7, orderBy: { createdAt: 'desc' },
        include: {
            user: { select: { id: true, name: true, email: true, avatar: true } },
            items: { take: 3, include: { product: { select: { images: { take: 1 } } } } },
            payment: true,
        },
    });
    const recentCustomers = await prisma_1.prisma.user.findMany({
        where: { role: 'customer' }, take: 5, orderBy: { createdAt: 'desc' },
        select: { id: true, name: true, email: true, avatar: true, createdAt: true, status: true, _count: { select: { orders: true } } },
    });
    const statusOrder = ['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled', 'Returned'];
    const salesByStatus = {
        labels: statusOrder,
        data: statusOrder.map((s) => statusGroups.find((g) => g.orderStatus === s)?._count._all ?? 0),
    };
    const methodLabels = methodGroups.map((g) => g.paymentMethod ?? 'unknown');
    const paymentMethods = {
        labels: methodLabels.map((m) => m === 'cod' ? 'Cash on delivery' : m.charAt(0).toUpperCase() + m.slice(1)),
        data: methodGroups.map((g) => g._count._all),
    };
    return (0, http_1.ok)(res, {
        cards: {
            totalRevenue, netEarning, todayOrders, yesterdayOrders,
            totalOrders: orders.length, totalProducts: products.length, totalCustomers,
            lowStockProducts: lowStockProducts.length, averageOrderValue: avgOrder,
            newCustomers, refunds, pendingOrders: orders.filter((o) => o.orderStatus === 'Pending').length,
            deliveredOrders: orders.filter((o) => o.orderStatus === 'Delivered').length,
            activeProducts: products.length,
            inventoryUnits: products.reduce((s, p) => s + p.stockQuantity, 0),
        },
        revenueSeries: { labels, revenue: revenueSeries, orders: orderSeries },
        salesByStatus,
        paymentMethods,
        bestSellers,
        recentOrders,
        lowStock: lowStockProducts.slice(0, 6),
        recentCustomers,
        monthly: { thisMonthRevenue, lastMonthRevenue, growth },
    });
}));
exports.default = r;
