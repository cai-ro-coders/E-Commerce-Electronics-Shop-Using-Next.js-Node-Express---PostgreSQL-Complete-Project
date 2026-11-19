"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const prisma_1 = require("../config/prisma");
const auth_1 = require("../middleware/auth");
const upload_1 = require("../middleware/upload");
const rateLimit_1 = require("../middleware/rateLimit");
const http_1 = require("../utils/http");
const sanitize_1 = require("../utils/sanitize");
const audit_1 = require("../utils/audit");
const zod_1 = require("zod");
const validate_1 = require("../middleware/validate");
const r = (0, express_1.Router)();
r.use(auth_1.authenticate, auth_1.adminOrStaff);
const externalFileSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(1).max(240),
    path: zod_1.z.string().trim().min(1).max(2000),
    mime: zod_1.z.string().trim().max(120).optional().nullable(),
    size: zod_1.z.coerce.number().int().min(0).optional().default(0),
    folder: zod_1.z.enum(['images', 'documents', 'invoices', 'contracts', 'customer-files']).optional().default('documents'),
});
r.get('/stats', (0, http_1.asyncHandler)(async (_req, res) => {
    const files = await prisma_1.prisma.fileAsset.findMany({ select: { folder: true, size: true, mime: true } });
    const byFolder = files.reduce((acc, f) => { acc[f.folder] = (acc[f.folder] ?? 0) + 1; return acc; }, {});
    return (0, http_1.ok)(res, {
        total: files.length, totalSize: files.reduce((s, f) => s + (f.size ?? 0), 0),
        images: files.filter((f) => (f.mime ?? '').startsWith('image/')).length,
        documents: files.filter((f) => !(f.mime ?? '').startsWith('image/')).length,
        byFolder,
    });
}));
r.get('/folders', (0, http_1.asyncHandler)(async (_req, res) => {
    const groups = await prisma_1.prisma.fileAsset.groupBy({ by: ['folder'], _count: { _all: true } });
    return (0, http_1.ok)(res, groups.map((g) => ({ name: g.folder, count: g._count._all })));
}));
r.get('/', (0, http_1.asyncHandler)(async (req, res) => {
    const { page, limit, skip } = (0, http_1.getPagination)(req.query, 24);
    const search = String(req.query.search || '');
    const folder = req.query.folder ? String(req.query.folder) : undefined;
    const type = req.query.type ? String(req.query.type) : undefined;
    const where = {
        ...(folder && folder !== 'all' ? { folder } : {}),
        ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
        ...(type === 'images' ? { mime: { startsWith: 'image/' } } : type === 'documents' ? { mime: { not: { startsWith: 'image/' } } } : {}),
    };
    const [items, total] = await Promise.all([
        prisma_1.prisma.fileAsset.findMany({
            where, skip, take: limit, orderBy: { createdAt: 'desc' },
            include: { uploadedBy: { select: { id: true, name: true, email: true } } },
        }),
        prisma_1.prisma.fileAsset.count({ where }),
    ]);
    return (0, http_1.ok)(res, items, (0, http_1.getMeta)(page, limit, total));
}));
r.post('/upload', rateLimit_1.uploadLimiter, upload_1.upload.single('file'), (0, http_1.asyncHandler)(async (req, res) => {
    if (!req.file)
        throw new http_1.ApiError(400, 'No file uploaded');
    const folder = ['images', 'documents', 'invoices', 'contracts', 'customer-files'].includes(String(req.body.folder)) ? String(req.body.folder) : 'documents';
    const file = await prisma_1.prisma.fileAsset.create({
        data: {
            name: (0, sanitize_1.sanitizeText)(req.body.name) || req.file.originalname,
            path: `/uploads/${req.file.filename}`,
            mime: req.file.mimetype,
            size: req.file.size,
            folder,
            uploadedById: req.user.id,
        },
        include: { uploadedBy: { select: { id: true, name: true, email: true } } },
    });
    await (0, audit_1.recordActivity)({ userId: req.user.id, action: 'file.uploaded', entity: 'File', entityId: file.id, details: `Uploaded ${file.name}`, ip: req.ip });
    return (0, http_1.created)(res, file, 'File uploaded');
}));
r.post('/', (0, validate_1.validateBody)(externalFileSchema), (0, http_1.asyncHandler)(async (req, res) => {
    const file = await prisma_1.prisma.fileAsset.create({
        data: {
            name: req.body.name, path: req.body.path, mime: req.body.mime ?? null,
            size: req.body.size ?? 0, folder: req.body.folder ?? 'documents', uploadedById: req.user.id,
        },
    });
    await (0, audit_1.recordActivity)({ userId: req.user.id, action: 'file.registered', entity: 'File', entityId: file.id, details: `Registered ${file.name}`, ip: req.ip });
    return (0, http_1.created)(res, file, 'File registered');
}));
r.delete('/:id', (0, http_1.asyncHandler)(async (req, res) => {
    const id = Number(req.params.id);
    const file = await prisma_1.prisma.fileAsset.findUnique({ where: { id } });
    if (!file)
        throw new http_1.ApiError(404, 'File not found');
    if (file.path.startsWith('/uploads/')) {
        const filePath = path_1.default.join(upload_1.uploadDir, path_1.default.basename(file.path));
        if (fs_1.default.existsSync(filePath))
            fs_1.default.unlinkSync(filePath);
    }
    await prisma_1.prisma.fileAsset.delete({ where: { id } });
    await (0, audit_1.recordActivity)({ userId: req.user.id, action: 'file.deleted', entity: 'File', entityId: id, details: `Deleted ${file.name}`, ip: req.ip });
    return (0, http_1.ok)(res, null, undefined, 'File deleted');
}));
exports.default = r;
