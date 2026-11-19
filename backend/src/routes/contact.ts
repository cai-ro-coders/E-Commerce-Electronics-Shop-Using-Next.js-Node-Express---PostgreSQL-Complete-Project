import { Router } from 'express';
import { prisma } from '../config/prisma';
import { authenticate, adminOrStaff, AuthRequest } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { contactSchema } from '../validators/commerce';
import { ApiError, asyncHandler, created, getMeta, getPagination, ok } from '../utils/http';
import { sanitizeText } from '../utils/sanitize';
import { notify } from '../utils/audit';

const r = Router();

r.post('/', validateBody(contactSchema), asyncHandler(async (req, res) => {
  const data = req.body;
  const message = await prisma.contactMessage.create({
    data: { name: sanitizeText(data.name)!, email: data.email, subject: sanitizeText(data.subject)!, message: sanitizeText(data.message)! },
  });
  await notify({ userId: null, title: 'New contact message', message: `${data.name}: ${data.subject}`, type: 'customer', link: '/admin/notifications' });
  return created(res, { id: message.id }, 'Message received. Our team will reply within one business day.');
}));

r.get('/', authenticate, adminOrStaff, asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query as any, 20);
  const status = req.query.status ? String(req.query.status) : undefined;
  const where: any = status ? { status } : {};
  const [items, total] = await Promise.all([
    prisma.contactMessage.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
    prisma.contactMessage.count({ where }),
  ]);
  return ok(res, items, getMeta(page, limit, total));
}));

r.patch('/:id', authenticate, adminOrStaff, asyncHandler(async (req, res) => {
  const status = String(req.body.status || '');
  if (!['new', 'read', 'replied', 'archived'].includes(status)) throw new ApiError(400, 'Invalid status');
  const message = await prisma.contactMessage.update({ where: { id: Number(req.params.id) }, data: { status } });
  return ok(res, message, undefined, 'Message updated');
}));

r.delete('/:id', authenticate, adminOrStaff, asyncHandler(async (req, res) => {
  await prisma.contactMessage.delete({ where: { id: Number(req.params.id) } });
  return ok(res, null, undefined, 'Message deleted');
}));

export default r;
