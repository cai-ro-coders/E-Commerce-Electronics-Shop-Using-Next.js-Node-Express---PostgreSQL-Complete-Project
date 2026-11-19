import { Router } from 'express';
import { prisma } from '../config/prisma';
import { authenticate, AuthRequest, adminOrStaff } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { addressSchema } from '../validators/commerce';
import { ApiError, asyncHandler, created, ok } from '../utils/http';
import { sanitizeText } from '../utils/sanitize';

const r = Router();
r.use(authenticate);

function clean(data: any) {
  return {
    fullName: sanitizeText(data.fullName)!, phone: sanitizeText(data.phone)!, addressLine1: sanitizeText(data.addressLine1)!,
    addressLine2: data.addressLine2 ? sanitizeText(data.addressLine2) : null,
    city: sanitizeText(data.city)!, province: sanitizeText(data.province)!,
    postalCode: sanitizeText(data.postalCode)!, country: sanitizeText(data.country)!,
  };
}

r.get('/', asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.role === 'admin' && req.query.userId ? Number(req.query.userId) : req.user!.id;
  const items = await prisma.address.findMany({ where: { userId }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }] });
  return ok(res, items);
}));

r.post('/', validateBody(addressSchema), asyncHandler(async (req: AuthRequest, res) => {
  const count = await prisma.address.count({ where: { userId: req.user!.id } });
  const makeDefault = req.body.isDefault || count === 0;
  if (makeDefault) await prisma.address.updateMany({ where: { userId: req.user!.id }, data: { isDefault: false } });
  const address = await prisma.address.create({
    data: { ...clean(req.body), userId: req.user!.id, isDefault: makeDefault },
  });
  return created(res, address, 'Address saved');
}));

r.put('/:id', validateBody(addressSchema.partial()), asyncHandler(async (req: AuthRequest, res) => {
  const existing = await prisma.address.findUnique({ where: { id: Number(req.params.id) } });
  if (!existing) throw new ApiError(404, 'Address not found');
  if (existing.userId !== req.user!.id && req.user!.role !== 'admin') throw new ApiError(403, 'You cannot edit this address');
  if (req.body.isDefault) await prisma.address.updateMany({ where: { userId: existing.userId }, data: { isDefault: false } });
  const address = await prisma.address.update({
    where: { id: existing.id },
    data: { ...clean({ ...existing, ...req.body }), ...(req.body.isDefault !== undefined ? { isDefault: req.body.isDefault } : {}) },
  });
  return ok(res, address, undefined, 'Address updated');
}));

r.patch('/:id/default', asyncHandler(async (req: AuthRequest, res) => {
  const existing = await prisma.address.findUnique({ where: { id: Number(req.params.id) } });
  if (!existing || (existing.userId !== req.user!.id && req.user!.role !== 'admin')) throw new ApiError(404, 'Address not found');
  await prisma.$transaction([
    prisma.address.updateMany({ where: { userId: existing.userId }, data: { isDefault: false } }),
    prisma.address.update({ where: { id: existing.id }, data: { isDefault: true } }),
  ]);
  return ok(res, await prisma.address.findMany({ where: { userId: existing.userId }, orderBy: { isDefault: 'desc' } }), undefined, 'Default address updated');
}));

r.delete('/:id', asyncHandler(async (req: AuthRequest, res) => {
  const existing = await prisma.address.findUnique({ where: { id: Number(req.params.id) } });
  if (!existing) throw new ApiError(404, 'Address not found');
  if (existing.userId !== req.user!.id && req.user!.role !== 'admin') throw new ApiError(403, 'You cannot delete this address');
  await prisma.address.delete({ where: { id: existing.id } });
  return ok(res, null, undefined, 'Address deleted');
}));

export default r;
