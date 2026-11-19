"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../config/prisma");
const auth_1 = require("../middleware/auth");
const validate_1 = require("../middleware/validate");
const commerce_1 = require("../validators/commerce");
const http_1 = require("../utils/http");
const sanitize_1 = require("../utils/sanitize");
const r = (0, express_1.Router)();
r.use(auth_1.authenticate);
function clean(data) {
    return {
        fullName: (0, sanitize_1.sanitizeText)(data.fullName), phone: (0, sanitize_1.sanitizeText)(data.phone), addressLine1: (0, sanitize_1.sanitizeText)(data.addressLine1),
        addressLine2: data.addressLine2 ? (0, sanitize_1.sanitizeText)(data.addressLine2) : null,
        city: (0, sanitize_1.sanitizeText)(data.city), province: (0, sanitize_1.sanitizeText)(data.province),
        postalCode: (0, sanitize_1.sanitizeText)(data.postalCode), country: (0, sanitize_1.sanitizeText)(data.country),
    };
}
r.get('/', (0, http_1.asyncHandler)(async (req, res) => {
    const userId = req.user.role === 'admin' && req.query.userId ? Number(req.query.userId) : req.user.id;
    const items = await prisma_1.prisma.address.findMany({ where: { userId }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }] });
    return (0, http_1.ok)(res, items);
}));
r.post('/', (0, validate_1.validateBody)(commerce_1.addressSchema), (0, http_1.asyncHandler)(async (req, res) => {
    const count = await prisma_1.prisma.address.count({ where: { userId: req.user.id } });
    const makeDefault = req.body.isDefault || count === 0;
    if (makeDefault)
        await prisma_1.prisma.address.updateMany({ where: { userId: req.user.id }, data: { isDefault: false } });
    const address = await prisma_1.prisma.address.create({
        data: { ...clean(req.body), userId: req.user.id, isDefault: makeDefault },
    });
    return (0, http_1.created)(res, address, 'Address saved');
}));
r.put('/:id', (0, validate_1.validateBody)(commerce_1.addressSchema.partial()), (0, http_1.asyncHandler)(async (req, res) => {
    const existing = await prisma_1.prisma.address.findUnique({ where: { id: Number(req.params.id) } });
    if (!existing)
        throw new http_1.ApiError(404, 'Address not found');
    if (existing.userId !== req.user.id && req.user.role !== 'admin')
        throw new http_1.ApiError(403, 'You cannot edit this address');
    if (req.body.isDefault)
        await prisma_1.prisma.address.updateMany({ where: { userId: existing.userId }, data: { isDefault: false } });
    const address = await prisma_1.prisma.address.update({
        where: { id: existing.id },
        data: { ...clean({ ...existing, ...req.body }), ...(req.body.isDefault !== undefined ? { isDefault: req.body.isDefault } : {}) },
    });
    return (0, http_1.ok)(res, address, undefined, 'Address updated');
}));
r.patch('/:id/default', (0, http_1.asyncHandler)(async (req, res) => {
    const existing = await prisma_1.prisma.address.findUnique({ where: { id: Number(req.params.id) } });
    if (!existing || (existing.userId !== req.user.id && req.user.role !== 'admin'))
        throw new http_1.ApiError(404, 'Address not found');
    await prisma_1.prisma.$transaction([
        prisma_1.prisma.address.updateMany({ where: { userId: existing.userId }, data: { isDefault: false } }),
        prisma_1.prisma.address.update({ where: { id: existing.id }, data: { isDefault: true } }),
    ]);
    return (0, http_1.ok)(res, await prisma_1.prisma.address.findMany({ where: { userId: existing.userId }, orderBy: { isDefault: 'desc' } }), undefined, 'Default address updated');
}));
r.delete('/:id', (0, http_1.asyncHandler)(async (req, res) => {
    const existing = await prisma_1.prisma.address.findUnique({ where: { id: Number(req.params.id) } });
    if (!existing)
        throw new http_1.ApiError(404, 'Address not found');
    if (existing.userId !== req.user.id && req.user.role !== 'admin')
        throw new http_1.ApiError(403, 'You cannot delete this address');
    await prisma_1.prisma.address.delete({ where: { id: existing.id } });
    return (0, http_1.ok)(res, null, undefined, 'Address deleted');
}));
exports.default = r;
