"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../config/prisma");
const auth_1 = require("../middleware/auth");
const validate_1 = require("../middleware/validate");
const commerce_1 = require("../validators/commerce");
const http_1 = require("../utils/http");
const http_2 = require("../utils/http");
const r = (0, express_1.Router)();
r.use(auth_1.authenticate);
r.get('/', (0, http_1.asyncHandler)(async (req, res) => {
    const items = await prisma_1.prisma.wishlist.findMany({
        where: { userId: req.user.id },
        orderBy: { createdAt: 'desc' },
        include: {
            product: {
                include: {
                    images: { take: 2, orderBy: { sortOrder: 'asc' } },
                    brand: { select: { name: true } },
                    category: { select: { name: true, slug: true } },
                },
            },
        },
    });
    return (0, http_1.ok)(res, items);
}));
r.get('/count', (0, http_1.asyncHandler)(async (req, res) => {
    const count = await prisma_1.prisma.wishlist.count({ where: { userId: req.user.id } });
    return (0, http_1.ok)(res, { count });
}));
r.post('/', (0, validate_1.validateBody)(commerce_1.wishlistSchema), (0, http_1.asyncHandler)(async (req, res) => {
    const { productId } = req.body;
    const product = await prisma_1.prisma.product.findUnique({ where: { id: productId } });
    if (!product)
        throw new http_2.ApiError(404, 'Product not found');
    await prisma_1.prisma.wishlist.upsert({
        where: { userId_productId: { userId: req.user.id, productId } },
        update: {}, create: { userId: req.user.id, productId },
    });
    const count = await prisma_1.prisma.wishlist.count({ where: { userId: req.user.id } });
    return (0, http_1.ok)(res, { count, productId }, undefined, 'Added to wishlist');
}));
r.post('/toggle', (0, validate_1.validateBody)(commerce_1.wishlistSchema), (0, http_1.asyncHandler)(async (req, res) => {
    const { productId } = req.body;
    const existing = await prisma_1.prisma.wishlist.findUnique({ where: { userId_productId: { userId: req.user.id, productId } } });
    if (existing) {
        await prisma_1.prisma.wishlist.delete({ where: { id: existing.id } });
        const count = await prisma_1.prisma.wishlist.count({ where: { userId: req.user.id } });
        return (0, http_1.ok)(res, { liked: false, count }, undefined, 'Removed from wishlist');
    }
    const product = await prisma_1.prisma.product.findUnique({ where: { id: productId } });
    if (!product)
        throw new http_2.ApiError(404, 'Product not found');
    await prisma_1.prisma.wishlist.create({ data: { userId: req.user.id, productId } });
    const count = await prisma_1.prisma.wishlist.count({ where: { userId: req.user.id } });
    return (0, http_1.ok)(res, { liked: true, count }, undefined, 'Added to wishlist');
}));
r.delete('/:productId', (0, http_1.asyncHandler)(async (req, res) => {
    await prisma_1.prisma.wishlist.deleteMany({ where: { userId: req.user.id, productId: Number(req.params.productId) } });
    const count = await prisma_1.prisma.wishlist.count({ where: { userId: req.user.id } });
    return (0, http_1.ok)(res, { count }, undefined, 'Removed from wishlist');
}));
exports.default = r;
