import { Router } from 'express';
import { prisma } from '../config/prisma';
import { AuthRequest, authenticate, authorize } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { ApiError, asyncHandler, created, getMeta, getPagination, ok } from '../utils/http';
import { sanitizeText } from '../utils/sanitize';
import { recordActivity } from '../utils/audit';
import { z } from 'zod';

const r = Router();

const settingSchema = z.object({
  key: z.string().trim().min(1).max(120).regex(/^[a-z0-9_]+$/i, 'Use letters, numbers and underscores only'),
  group: z.string().trim().max(60).optional().default('general'),
  value: z.string().max(5000).optional().nullable(),
});

const bulkSchema = z.object({
  settings: z.array(settingSchema).min(1).max(100),
});

const PUBLIC_KEYS = [
  'site_name', 'site_tagline', 'site_logo', 'support_email', 'support_phone', 'currency',
  'tax_rate', 'shipping_fee', 'free_shipping_threshold', 'theme', 'accent_color',
  'enable_dark_mode', 'maintenance_mode', 'company_name', 'company_address', 'company_phone',
  'language', 'timezone', 'cod_enabled', 'stripe_publishable_key', 'paypal_client_id',
];

r.get('/public', asyncHandler(async (_req, res) => {
  const rows = await prisma.setting.findMany({
    where: { key: { in: [...PUBLIC_KEYS, 'stripe_secret_key', 'paypal_client_secret'] } },
  });
  const values = Object.fromEntries(rows.map((s) => [s.key, (s.value ?? '').trim()]));
  const ready = (publicKey?: string, secretKey?: string) =>
    Boolean(publicKey && secretKey && !publicKey.includes('ElectroShopDemo') && !secretKey.includes('ElectroShopDemo'));
  const data = Object.fromEntries(rows.filter((s) => PUBLIC_KEYS.includes(s.key)).map((s) => [s.key, s.value]));
  return ok(res, {
    ...data,
    stripe_configured: ready(values.stripe_publishable_key, values.stripe_secret_key),
    paypal_configured: ready(values.paypal_client_id, values.paypal_client_secret),
  });
}));

r.get('/backup', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const [settings, categories, brands, products, coupons, customers] = await Promise.all([
    prisma.setting.findMany(),
    prisma.category.findMany(),
    prisma.brand.findMany(),
    prisma.product.findMany({ include: { images: true, specifications: true } }),
    prisma.coupon.findMany(),
    prisma.user.findMany({
      where: { role: 'customer' },
      select: { id: true, name: true, email: true, phone: true, status: true, createdAt: true },
    }),
  ]);
  const backup = {
    meta: { app: 'ElectroShop', created_at: new Date().toISOString(), generated_by: req.user!.email, version: '1.0.0' },
    settings, categories, brands, products, coupons, customers,
  };
  res.setHeader('Content-Disposition', `attachment; filename="electroshop-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  return res.json(backup);
}));

r.get('/stats', authenticate, authorize('admin', 'staff'), asyncHandler(async (_req, res) => {
  const rows = await prisma.setting.findMany();
  const groups = rows.reduce<Record<string, number>>((acc, s) => {
    const g = s.group ?? 'general';
    acc[g] = (acc[g] ?? 0) + 1;
    return acc;
  }, {});
  return ok(res, { total: rows.length, groups });
}));

r.get('/', authenticate, authorize('admin', 'staff'), asyncHandler(async (req: AuthRequest, res) => {
  const { page, limit, skip } = getPagination(req.query as any, 200);
  const search = String(req.query.search || '');
  const group = req.query.group ? String(req.query.group) : undefined;
  const where: any = {
    ...(group ? { group } : {}),
    ...(search ? { OR: [{ key: { contains: search, mode: 'insensitive' } }, { value: { contains: search, mode: 'insensitive' } }] } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.setting.findMany({ where, skip, take: limit, orderBy: [{ group: 'asc' }, { key: 'asc' }] }),
    prisma.setting.count({ where }),
  ]);
  // Secret values are only returned to administrators; staff see a masked placeholder.
  const sensitive = /(secret|private_key|password)/i;
  const safeItems = req.user?.role === 'admin'
    ? items
    : items.map((setting) => (sensitive.test(setting.key) && setting.value ? { ...setting, value: '••••••••' } : setting));
  const grouped = safeItems.reduce<Record<string, typeof safeItems>>((acc, s) => {
    const g = s.group ?? 'general';
    (acc[g] ??= []).push(s);
    return acc;
  }, {});
  return ok(res, safeItems, { ...getMeta(page, limit, total), groups: grouped });
}));

r.put('/bulk', authenticate, authorize('admin'), validateBody(bulkSchema), asyncHandler(async (req, res) => {
  const updates = req.body.settings;
  const results = await prisma.$transaction(
    updates.map((s: any) => prisma.setting.upsert({
      where: { key: s.key },
      update: { value: s.value !== null ? sanitizeText(s.value) : null, group: s.group ?? 'general' },
      create: { key: s.key, value: s.value !== null ? sanitizeText(s.value) : null, group: s.group ?? 'general' },
    })),
  );
  await recordActivity({ userId: req.user!.id, action: 'settings.updated', entity: 'Setting', details: `Bulk updated ${results.length} settings`, ip: req.ip });
  return ok(res, results, undefined, 'Settings saved');
}));

r.post('/', authenticate, authorize('admin'), validateBody(settingSchema), asyncHandler(async (req, res) => {
  const data = req.body;
  const setting = await prisma.setting.upsert({
    where: { key: data.key },
    update: { value: data.value !== null ? sanitizeText(data.value) : null, group: data.group ?? 'general' },
    create: { key: data.key, group: data.group ?? 'general', value: data.value !== null ? sanitizeText(data.value) : null },
  });
  await recordActivity({ userId: req.user!.id, action: 'setting.created', entity: 'Setting', entityId: setting.id, details: `Set ${setting.key}`, ip: req.ip });
  return created(res, setting, 'Setting saved');
}));

r.put('/:id', authenticate, authorize('admin'), validateBody(settingSchema.partial()), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.setting.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, 'Setting not found');
  const setting = await prisma.setting.update({
    where: { id },
    data: {
      ...(req.body.key !== undefined ? { key: req.body.key } : {}),
      ...(req.body.group !== undefined ? { group: req.body.group } : {}),
      ...(req.body.value !== undefined ? { value: req.body.value !== null ? sanitizeText(req.body.value) : null } : {}),
    },
  });
  await recordActivity({ userId: req.user!.id, action: 'setting.updated', entity: 'Setting', entityId: id, details: `Updated ${setting.key}`, ip: req.ip });
  return ok(res, setting, undefined, 'Setting updated');
}));

r.delete('/:id', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.setting.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, 'Setting not found');
  await prisma.setting.delete({ where: { id } });
  await recordActivity({ userId: req.user!.id, action: 'setting.deleted', entity: 'Setting', entityId: id, details: `Deleted ${existing.key}`, ip: req.ip });
  return ok(res, null, undefined, 'Setting deleted');
}));

export default r;
