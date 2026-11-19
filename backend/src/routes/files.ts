import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { prisma } from '../config/prisma';
import { authenticate, adminOrStaff, AuthRequest } from '../middleware/auth';
import { upload, uploadDir } from '../middleware/upload';
import { uploadLimiter } from '../middleware/rateLimit';
import { ApiError, asyncHandler, created, getMeta, getPagination, ok } from '../utils/http';
import { sanitizeText } from '../utils/sanitize';
import { recordActivity } from '../utils/audit';
import { z } from 'zod';
import { validateBody } from '../middleware/validate';

const r = Router();
r.use(authenticate, adminOrStaff);

const externalFileSchema = z.object({
  name: z.string().trim().min(1).max(240),
  path: z.string().trim().min(1).max(2000),
  mime: z.string().trim().max(120).optional().nullable(),
  size: z.coerce.number().int().min(0).optional().default(0),
  folder: z.enum(['images', 'documents', 'invoices', 'contracts', 'customer-files']).optional().default('documents'),
});

r.get('/stats', asyncHandler(async (_req, res) => {
  const files = await prisma.fileAsset.findMany({ select: { folder: true, size: true, mime: true } });
  const byFolder = files.reduce<Record<string, number>>((acc, f) => { acc[f.folder] = (acc[f.folder] ?? 0) + 1; return acc; }, {});
  return ok(res, {
    total: files.length, totalSize: files.reduce((s, f) => s + (f.size ?? 0), 0),
    images: files.filter((f) => (f.mime ?? '').startsWith('image/')).length,
    documents: files.filter((f) => !(f.mime ?? '').startsWith('image/')).length,
    byFolder,
  });
}));

r.get('/folders', asyncHandler(async (_req, res) => {
  const groups = await prisma.fileAsset.groupBy({ by: ['folder'], _count: { _all: true } });
  return ok(res, groups.map((g) => ({ name: g.folder, count: g._count._all })));
}));

r.get('/', asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query as any, 24);
  const search = String(req.query.search || '');
  const folder = req.query.folder ? String(req.query.folder) : undefined;
  const type = req.query.type ? String(req.query.type) : undefined;
  const where: any = {
    ...(folder && folder !== 'all' ? { folder } : {}),
    ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
    ...(type === 'images' ? { mime: { startsWith: 'image/' } } : type === 'documents' ? { mime: { not: { startsWith: 'image/' } } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.fileAsset.findMany({
      where, skip, take: limit, orderBy: { createdAt: 'desc' },
      include: { uploadedBy: { select: { id: true, name: true, email: true } } },
    }),
    prisma.fileAsset.count({ where }),
  ]);
  return ok(res, items, getMeta(page, limit, total));
}));

r.post('/upload', uploadLimiter, upload.single('file'), asyncHandler(async (req: AuthRequest, res) => {
  if (!req.file) throw new ApiError(400, 'No file uploaded');
  const folder = ['images', 'documents', 'invoices', 'contracts', 'customer-files'].includes(String(req.body.folder)) ? String(req.body.folder) : 'documents';
  const file = await prisma.fileAsset.create({
    data: {
      name: sanitizeText(req.body.name) || req.file.originalname,
      path: `/uploads/${req.file.filename}`,
      mime: req.file.mimetype,
      size: req.file.size,
      folder,
      uploadedById: req.user!.id,
    },
    include: { uploadedBy: { select: { id: true, name: true, email: true } } },
  });
  await recordActivity({ userId: req.user!.id, action: 'file.uploaded', entity: 'File', entityId: file.id, details: `Uploaded ${file.name}`, ip: req.ip });
  return created(res, file, 'File uploaded');
}));

r.post('/', validateBody(externalFileSchema), asyncHandler(async (req: AuthRequest, res) => {
  const file = await prisma.fileAsset.create({
    data: {
      name: req.body.name, path: req.body.path, mime: req.body.mime ?? null,
      size: req.body.size ?? 0, folder: req.body.folder ?? 'documents', uploadedById: req.user!.id,
    },
  });
  await recordActivity({ userId: req.user!.id, action: 'file.registered', entity: 'File', entityId: file.id, details: `Registered ${file.name}`, ip: req.ip });
  return created(res, file, 'File registered');
}));

r.delete('/:id', asyncHandler(async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const file = await prisma.fileAsset.findUnique({ where: { id } });
  if (!file) throw new ApiError(404, 'File not found');
  if (file.path.startsWith('/uploads/')) {
    const filePath = path.join(uploadDir, path.basename(file.path));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  await prisma.fileAsset.delete({ where: { id } });
  await recordActivity({ userId: req.user!.id, action: 'file.deleted', entity: 'File', entityId: id, details: `Deleted ${file.name}`, ip: req.ip });
  return ok(res, null, undefined, 'File deleted');
}));

export default r;
