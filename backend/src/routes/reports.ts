import { Router } from 'express';
import { prisma } from '../config/prisma';
import { authenticate, adminOrStaff } from '../middleware/auth';
import { asyncHandler, addDays, dateRange, money, ok, startOfDay } from '../utils/http';
import { sendCsv, toCsv } from '../utils/csv';

const r = Router();
r.use(authenticate, adminOrStaff);

function defaultRange(from?: unknown, to?: unknown) {
  const parsed = dateRange(from, to);
  const start = parsed.start ?? addDays(startOfDay(), -29);
  const end = parsed.end ?? new Date();
  return { start, end };
}

function dayKey(d: Date) { return d.toISOString().slice(0, 10); }

async function salesReport(from?: unknown, to?: unknown) {
  const { start, end } = defaultRange(from, to);
  const orders = await prisma.order.findMany({
    where: { createdAt: { gte: start, lte: end } },
    include: {
      items: { include: { product: { include: { category: { select: { id: true, name: true } } } } } },
      payment: true,
      user: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  const paid = orders.filter((o) => o.paymentStatus === 'Paid');
  const totalSales = money(paid.reduce((s, o) => s + Number(o.grandTotal), 0));
  const totalOrders = orders.length;
  const avgOrder = totalOrders ? money(paid.reduce((s, o) => s + Number(o.grandTotal), 0) / Math.max(1, paid.length)) : 0;
  const discounts = money(orders.reduce((s, o) => s + Number(o.discount), 0));
  const tax = money(paid.reduce((s, o) => s + Number(o.tax), 0));
  const shipping = money(paid.reduce((s, o) => s + Number(o.shippingFee), 0));
  const refunds = await prisma.payment.aggregate({ where: { status: 'Refunded', createdAt: { gte: start, lte: end } }, _sum: { amount: true } });
  const refundTotal = money(Number(refunds._sum.amount ?? 0));

  const days: string[] = [];
  const salesSeries: number[] = [];
  const ordersSeries: number[] = [];
  const cursor = new Date(start);
  while (cursor <= end && days.length < 120) {
    const key = dayKey(cursor);
    days.push(cursor.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    const dayOrders = orders.filter((o) => dayKey(o.createdAt) === key);
    salesSeries.push(money(dayOrders.filter((o) => o.paymentStatus === 'Paid').reduce((s, o) => s + Number(o.grandTotal), 0)));
    ordersSeries.push(dayOrders.length);
    cursor.setDate(cursor.getDate() + 1);
  }

  const productMap = new Map<number, { name: string; sku: string; quantity: number; revenue: number }>();
  const categoryMap = new Map<number, { name: string; quantity: number; revenue: number }>();
  for (const order of paid) {
    for (const item of order.items) {
      const key = item.productId ?? 0;
      const curr = productMap.get(key) ?? { name: item.productName, sku: item.sku, quantity: 0, revenue: 0 };
      curr.quantity += item.quantity;
      curr.revenue += Number(item.total);
      productMap.set(key, curr);
      if (item.product?.category) {
        const c = categoryMap.get(item.product.category.id) ?? { name: item.product.category.name, quantity: 0, revenue: 0 };
        c.quantity += item.quantity;
        c.revenue += Number(item.total);
        categoryMap.set(item.product.category.id, c);
      }
    }
  }

  const paymentMap = new Map<string, number>();
  for (const order of paid) {
    const method = order.paymentMethod ?? 'unknown';
    paymentMap.set(method, (paymentMap.get(method) ?? 0) + Number(order.grandTotal));
  }

  const statusMap = new Map<string, number>();
  for (const order of orders) statusMap.set(order.orderStatus, (statusMap.get(order.orderStatus) ?? 0) + 1);

  return {
    range: { from: start.toISOString(), to: end.toISOString() },
    summary: {
      totalSales, totalOrders, paidOrders: paid.length, averageOrderValue: avgOrder,
      discounts, tax, shipping, refunds: refundTotal,
      netSales: money(totalSales - refundTotal),
      conversion: totalOrders ? money((paid.length / totalOrders) * 100) : 0,
    },
    series: { labels: days, sales: salesSeries, orders: ordersSeries },
    topProducts: Array.from(productMap.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 10).map((p) => ({ ...p, revenue: money(p.revenue) })),
    categories: Array.from(categoryMap.values()).sort((a, b) => b.revenue - a.revenue).map((c) => ({ ...c, revenue: money(c.revenue) })),
    paymentMethods: Array.from(paymentMap.entries()).map(([method, amount]) => ({ method, amount: money(amount) })),
    statuses: Array.from(statusMap.entries()).map(([status, count]) => ({ status, count })),
    orders: orders.slice(-50).reverse(),
  };
}

r.get('/sales', asyncHandler(async (req, res) => ok(res, await salesReport(req.query.from, req.query.to))));

r.get('/inventory', asyncHandler(async (_req, res) => {
  const products = await prisma.product.findMany({
    include: { category: { select: { id: true, name: true } }, brand: { select: { name: true } } },
  });
  const categories = new Map<number, { name: string; units: number; cost: number; retail: number }>();
  for (const p of products) {
    const c = categories.get(p.categoryId) ?? { name: p.category.name, units: 0, cost: 0, retail: 0 };
    c.units += p.stockQuantity;
    c.cost += p.stockQuantity * Number(p.costPrice ?? Number(p.price) * 0.7);
    c.retail += p.stockQuantity * Number(p.price);
    categories.set(p.categoryId, c);
  }
  const lowStock = products.filter((p) => p.stockQuantity <= p.minimumStock)
    .map((p) => ({ id: p.id, name: p.name, sku: p.sku, stockQuantity: p.stockQuantity, minimumStock: p.minimumStock, category: p.category.name }))
    .sort((a, b) => a.stockQuantity - b.stockQuantity);
  const logs = await prisma.inventoryLog.groupBy({ by: ['type'], _sum: { quantity: true }, _count: { _all: true } });
  return ok(res, {
    totalUnits: products.reduce((s, p) => s + p.stockQuantity, 0),
    totalCost: money(products.reduce((s, p) => s + p.stockQuantity * Number(p.costPrice ?? Number(p.price) * 0.7), 0)),
    totalRetail: money(products.reduce((s, p) => s + p.stockQuantity * Number(p.price), 0)),
    lowStockCount: lowStock.length,
    outOfStockCount: products.filter((p) => p.stockQuantity === 0).length,
    categories: Array.from(categories.values()).map((c) => ({ ...c, cost: money(c.cost), retail: money(c.retail) })).sort((a, b) => b.retail - a.retail),
    lowStock,
    movements: logs.map((l) => ({ type: l.type, quantity: l._sum.quantity ?? 0, count: l._count._all })),
  });
}));

r.get('/customers', asyncHandler(async (_req, res) => {
  const customers = await prisma.user.findMany({
    where: { role: 'customer' },
    include: { orders: { where: { orderStatus: { notIn: ['Cancelled', 'Returned'] } }, select: { grandTotal: true, createdAt: true } }, _count: { select: { orders: true } } },
    orderBy: { createdAt: 'desc' },
  });
  const mapped = customers.map((c) => ({
    id: c.id, name: c.name, email: c.email, status: c.status, createdAt: c.createdAt,
    orders: c._count.orders,
    totalSpent: money(c.orders.reduce((s, o) => s + Number(o.grandTotal), 0)),
    lastOrderAt: c.orders.length ? c.orders.map((o) => o.createdAt).sort((a, b) => b.getTime() - a.getTime())[0] : null,
  }));
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  return ok(res, {
    total: mapped.length,
    active: mapped.filter((c) => c.status === 'active').length,
    newThisMonth: mapped.filter((c) => new Date(c.createdAt) >= monthStart).length,
    lifetimeValue: money(mapped.reduce((s, c) => s + c.totalSpent, 0)),
    topCustomers: mapped.sort((a, b) => b.totalSpent - a.totalSpent).slice(0, 10),
    customers: mapped,
  });
}));

r.get('/export', asyncHandler(async (req, res) => {
  const type = String(req.query.type || 'sales');
  if (type === 'inventory') {
    const report = await prisma.product.findMany({ include: { category: true, brand: true } });
    const rows = report.map((p) => ({
      sku: p.sku, product: p.name, category: p.category?.name ?? '', brand: p.brand?.name ?? '',
      stock: p.stockQuantity, minimum: p.minimumStock, cost: Number(p.costPrice ?? 0), price: Number(p.price),
      value_at_cost: money(p.stockQuantity * Number(p.costPrice ?? 0)), value_at_retail: money(p.stockQuantity * Number(p.price)),
    }));
    return sendCsv(res, 'inventory-report.csv', toCsv(rows));
  }
  if (type === 'customers') {
    const customers = await prisma.user.findMany({ where: { role: 'customer' }, include: { orders: true } });
    const rows = customers.map((c) => ({
      name: c.name, email: c.email, status: c.status, phone: c.phone ?? '',
      orders: c.orders.length, total_spent: money(c.orders.reduce((s, o) => s + Number(o.grandTotal), 0)),
      joined: c.createdAt.toISOString(),
    }));
    return sendCsv(res, 'customers-report.csv', toCsv(rows));
  }
  const report = await salesReport(req.query.from, req.query.to);
  const rows = report.orders.map((o) => ({
    order: o.orderNumber, customer: o.user?.name ?? '', date: o.createdAt.toISOString(),
    payment: o.paymentStatus, status: o.orderStatus, total: Number(o.grandTotal),
  }));
  return sendCsv(res, 'sales-report.csv', toCsv(rows));
}));

export default r;
