import { Router } from 'express';
import { prisma } from '../config/prisma';
import { authenticate, adminOrStaff, AuthRequest } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { inventoryAdjustSchema, inventoryEventSchema } from '../validators/commerce';
import { ApiError, asyncHandler, created, dateRange, getMeta, getPagination, money, ok } from '../utils/http';
import { recordActivity, notify } from '../utils/audit';
import { sendCsv, toCsv } from '../utils/csv';

const r = Router();
r.use(authenticate, adminOrStaff);

r.get('/stats', asyncHandler(async (_req, res) => {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const [products, lowStock, stockIn, stockOut, movements] = await Promise.all([
    prisma.product.findMany({ select: { stockQuantity: true, costPrice: true, price: true, minimumStock: true } }),
    prisma.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*)::bigint AS count FROM products WHERE stock_quantity <= minimum_stock`,
    prisma.inventoryLog.aggregate({ where: { type: 'stock_in', createdAt: { gte: monthStart } }, _sum: { quantity: true } }),
    prisma.inventoryLog.aggregate({ where: { type: 'stock_out', createdAt: { gte: monthStart } }, _sum: { quantity: true } }),
    prisma.inventoryLog.count(),
  ]);
  const totalUnits = products.reduce((s, p) => s + p.stockQuantity, 0);
  const valuationCost = products.reduce((s, p) => s + p.stockQuantity * Number(p.costPrice ?? Number(p.price) * 0.7), 0);
  const valuationRetail = products.reduce((s, p) => s + p.stockQuantity * Number(p.price), 0);
  return ok(res, {
    totalProducts: products.length, totalUnits,
    valuationCost: money(valuationCost), valuationRetail: money(valuationRetail),
    potentialProfit: money(valuationRetail - valuationCost),
    lowStock: Number(lowStock[0]?.count ?? 0),
    outOfStock: products.filter((p) => p.stockQuantity === 0).length,
    stockInThisMonth: stockIn._sum.quantity ?? 0, stockOutThisMonth: stockOut._sum.quantity ?? 0,
    movements,
  });
}));

r.get('/low-stock', asyncHandler(async (_req, res) => {
  const products = await prisma.product.findMany({
    select: {
      id: true, name: true, sku: true, stockQuantity: true, minimumStock: true, price: true, status: true,
      images: { take: 1, orderBy: { sortOrder: 'asc' } }, category: { select: { name: true } }, brand: { select: { name: true } },
    },
  });
  const items = products.filter((p) => p.stockQuantity <= p.minimumStock).sort((a, b) => (a.stockQuantity - a.minimumStock) - (b.stockQuantity - b.minimumStock));
  return ok(res, items.map((p) => ({ ...p, deficit: Math.max(0, p.minimumStock - p.stockQuantity) })));
}));

r.get('/valuation', asyncHandler(async (_req, res) => {
  const products = await prisma.product.findMany({
    include: { category: { select: { id: true, name: true } }, brand: { select: { id: true, name: true } } },
  });
  const byCategory = new Map<number, { name: string; units: number; cost: number; retail: number; products: number }>();
  for (const p of products) {
    const curr = byCategory.get(p.categoryId) ?? { name: p.category.name, units: 0, cost: 0, retail: 0, products: 0 };
    curr.units += p.stockQuantity;
    curr.cost += p.stockQuantity * Number(p.costPrice ?? Number(p.price) * 0.7);
    curr.retail += p.stockQuantity * Number(p.price);
    curr.products += 1;
    byCategory.set(p.categoryId, curr);
  }
  return ok(res, {
    categories: Array.from(byCategory.values()).map((c) => ({ ...c, cost: money(c.cost), retail: money(c.retail), profit: money(c.retail - c.cost) })).sort((a, b) => b.retail - a.retail),
    totalCost: money(products.reduce((s, p) => s + p.stockQuantity * Number(p.costPrice ?? Number(p.price) * 0.7), 0)),
    totalRetail: money(products.reduce((s, p) => s + p.stockQuantity * Number(p.price), 0)),
  });
}));

r.get('/logs', asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query as any, 20);
  const search = String(req.query.search || '');
  const type = req.query.type ? String(req.query.type) : undefined;
  const productId = req.query.productId ? Number(req.query.productId) : undefined;
  const { start, end } = dateRange(req.query.from, req.query.to);
  const where: any = {
    ...(type ? { type } : {}),
    ...(productId ? { productId } : {}),
    ...(start || end ? { createdAt: { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) } } : {}),
    ...(search ? { OR: [
      { reference: { contains: search, mode: 'insensitive' } },
      { remarks: { contains: search, mode: 'insensitive' } },
      { product: { name: { contains: search, mode: 'insensitive' } } },
      { product: { sku: { contains: search, mode: 'insensitive' } } },
    ] } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.inventoryLog.findMany({
      where, skip, take: limit, orderBy: { createdAt: 'desc' },
      include: { product: { select: { id: true, name: true, sku: true, stockQuantity: true, images: { take: 1 } } } },
    }),
    prisma.inventoryLog.count({ where }),
  ]);
  return ok(res, items, getMeta(page, limit, total));
}));

r.get('/logs/export', asyncHandler(async (req, res) => {
  const logs = await prisma.inventoryLog.findMany({
    orderBy: { createdAt: 'desc' }, take: 5000,
    include: { product: { select: { name: true, sku: true } } },
  });
  const rows = logs.map((l) => ({
    date: l.createdAt.toISOString(), product: l.product?.name ?? '', sku: l.product?.sku ?? '',
    type: l.type, quantity: l.quantity, reference: l.reference ?? '', remarks: l.remarks ?? '',
  }));
  return sendCsv(res, 'inventory-movements.csv', toCsv(rows));
}));

r.post('/adjust', validateBody(inventoryAdjustSchema), asyncHandler(async (req: AuthRequest, res) => {
  const { productId, type, quantity, reference, remarks } = req.body;
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new ApiError(404, 'Product not found');
  let delta = 0;
  if (type === 'stock_in' || type === 'return') {
    if (quantity < 0) throw new ApiError(400, 'Quantity must be positive for stock in');
    delta = quantity;
  } else if (type === 'stock_out') {
    if (quantity < 0) throw new ApiError(400, 'Quantity must be positive for stock out');
    if (product.stockQuantity < quantity) throw new ApiError(400, `Only ${product.stockQuantity} unit(s) in stock`);
    delta = -quantity;
  } else {
    delta = quantity;
  }
  const nextStock = product.stockQuantity + delta;
  if (nextStock < 0) throw new ApiError(400, 'Adjustment would result in negative stock');

  const [updated, log] = await prisma.$transaction([
    prisma.product.update({ where: { id: productId }, data: { stockQuantity: nextStock } }),
    prisma.inventoryLog.create({
      data: {
        productId, type, quantity: type === 'adjustment' ? quantity : Math.abs(quantity),
        reference: reference ?? 'MANUAL-ADJUSTMENT', remarks: remarks ?? `Stock adjusted by ${delta > 0 ? '+' : ''}${delta}`,
      },
      include: { product: { select: { name: true, sku: true } } },
    }),
  ]);
  await recordActivity({ userId: req.user!.id, action: 'inventory.adjusted', entity: 'Product', entityId: productId, details: `${type}: ${delta > 0 ? '+' : ''}${delta} units for ${product.name}`, ip: req.ip });
  if (nextStock <= product.minimumStock) {
    await notify({ userId: null, title: 'Low stock warning', message: `${product.name} now has ${nextStock} unit(s) left (minimum ${product.minimumStock}).`, type: 'stock', link: '/admin/inventory' });
  }
  return ok(res, { product: updated, log }, undefined, 'Stock adjusted');
}));

r.get('/events', asyncHandler(async (req, res) => {
  const { start, end } = dateRange(req.query.start, req.query.end);
  const items = await prisma.inventoryEvent.findMany({
    where: start || end ? { start: { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) } } : {},
    include: { product: { select: { id: true, name: true, sku: true } } },
    orderBy: { start: 'asc' },
  });
  return ok(res, items);
}));

r.post('/events', validateBody(inventoryEventSchema), asyncHandler(async (req: AuthRequest, res) => {
  const data = req.body;
  const event = await prisma.inventoryEvent.create({
    data: {
      title: data.title, start: new Date(data.start), end: data.end ? new Date(data.end) : null,
      type: data.type ?? 'restock', productId: data.productId ?? null, notes: data.notes ?? null,
    },
    include: { product: { select: { name: true } } },
  });
  await recordActivity({ userId: req.user!.id, action: 'inventory.event_created', entity: 'InventoryEvent', entityId: event.id, details: `Created event ${event.title}`, ip: req.ip });
  return created(res, event, 'Inventory event created');
}));

r.put('/events/:id', validateBody(inventoryEventSchema.partial()), asyncHandler(async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const data = req.body;
  const event = await prisma.inventoryEvent.update({
    where: { id },
    data: {
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.start !== undefined ? { start: new Date(data.start) } : {}),
      ...(data.end !== undefined ? { end: data.end ? new Date(data.end) : null } : {}),
      ...(data.type !== undefined ? { type: data.type } : {}),
      ...(data.productId !== undefined ? { productId: data.productId } : {}),
      ...(data.notes !== undefined ? { notes: data.notes } : {}),
    },
  });
  await recordActivity({ userId: req.user!.id, action: 'inventory.event_updated', entity: 'InventoryEvent', entityId: id, details: `Updated event ${event.title}`, ip: req.ip });
  return ok(res, event, undefined, 'Event updated');
}));

r.delete('/events/:id', asyncHandler(async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  await prisma.inventoryEvent.delete({ where: { id } });
  await recordActivity({ userId: req.user!.id, action: 'inventory.event_deleted', entity: 'InventoryEvent', entityId: id, details: `Deleted event #${id}`, ip: req.ip });
  return ok(res, null, undefined, 'Event deleted');
}));

export default r;
