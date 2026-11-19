"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../config/prisma");
const auth_1 = require("../middleware/auth");
const validate_1 = require("../middleware/validate");
const commerce_1 = require("../validators/commerce");
const http_1 = require("../utils/http");
const orderService_1 = require("../services/orderService");
const r = (0, express_1.Router)();
r.use(auth_1.authenticate);
const cartInclude = {
    items: {
        orderBy: { createdAt: 'desc' },
        include: {
            product: {
                include: {
                    images: { take: 1, orderBy: { sortOrder: 'asc' } },
                    brand: { select: { name: true } },
                    category: { select: { name: true, slug: true } },
                },
            },
        },
    },
};
async function ensureCart(userId) {
    return prisma_1.prisma.cart.upsert({ where: { userId }, update: {}, create: { userId } });
}
async function cartPayload(userId) {
    const cart = await prisma_1.prisma.cart.findUnique({ where: { userId }, include: cartInclude });
    if (!cart)
        return { items: [], subtotal: 0, shippingFee: 0, tax: 0, total: 0, itemCount: 0 };
    const [taxRate, shippingFee, threshold] = await Promise.all([
        (0, orderService_1.getSetting)('tax_rate', '8'), (0, orderService_1.getSetting)('shipping_fee', '12.99'), (0, orderService_1.getSetting)('free_shipping_threshold', '500'),
    ]);
    const subtotal = (0, http_1.money)(cart.items.reduce((s, i) => s + Number(i.price) * i.quantity, 0));
    const shipping = subtotal >= Number(threshold) ? 0 : subtotal > 0 ? Number(shippingFee) : 0;
    const tax = (0, http_1.money)((subtotal * Number(taxRate)) / 100);
    return {
        ...cart,
        subtotal,
        shippingFee: (0, http_1.money)(shipping),
        tax,
        total: (0, http_1.money)(subtotal + shipping + tax),
        itemCount: cart.items.reduce((s, i) => s + i.quantity, 0),
    };
}
r.get('/', (0, http_1.asyncHandler)(async (req, res) => {
    await ensureCart(req.user.id);
    return (0, http_1.ok)(res, await cartPayload(req.user.id));
}));
r.post('/items', (0, validate_1.validateBody)(commerce_1.cartItemSchema), (0, http_1.asyncHandler)(async (req, res) => {
    const { productId, quantity } = req.body;
    const product = await prisma_1.prisma.product.findUnique({ where: { id: productId } });
    if (!product)
        throw new http_1.ApiError(404, 'Product not found');
    if (product.status !== 'active')
        throw new http_1.ApiError(400, 'This product is not available');
    const cart = await ensureCart(req.user.id);
    const existing = await prisma_1.prisma.cartItem.findUnique({ where: { cartId_productId: { cartId: cart.id, productId } } });
    const nextQty = (existing?.quantity ?? 0) + quantity;
    if (nextQty > product.stockQuantity)
        throw new http_1.ApiError(400, `Only ${product.stockQuantity} unit(s) available`);
    await prisma_1.prisma.cartItem.upsert({
        where: { cartId_productId: { cartId: cart.id, productId } },
        update: { quantity: nextQty, price: product.salePrice ?? product.price },
        create: { cartId: cart.id, productId, quantity: nextQty, price: product.salePrice ?? product.price },
    });
    return (0, http_1.ok)(res, await cartPayload(req.user.id), undefined, 'Added to cart');
}));
r.put('/items/:id', (0, validate_1.validateBody)(commerce_1.cartUpdateSchema), (0, http_1.asyncHandler)(async (req, res) => {
    const item = await prisma_1.prisma.cartItem.findFirst({ where: { id: Number(req.params.id), cart: { userId: req.user.id } }, include: { product: true } });
    if (!item)
        throw new http_1.ApiError(404, 'Cart item not found');
    if (req.body.quantity > item.product.stockQuantity)
        throw new http_1.ApiError(400, `Only ${item.product.stockQuantity} unit(s) available`);
    await prisma_1.prisma.cartItem.update({ where: { id: item.id }, data: { quantity: req.body.quantity } });
    return (0, http_1.ok)(res, await cartPayload(req.user.id), undefined, 'Cart updated');
}));
r.delete('/items/:id', (0, http_1.asyncHandler)(async (req, res) => {
    const item = await prisma_1.prisma.cartItem.findFirst({ where: { id: Number(req.params.id), cart: { userId: req.user.id } } });
    if (!item)
        throw new http_1.ApiError(404, 'Cart item not found');
    await prisma_1.prisma.cartItem.delete({ where: { id: item.id } });
    return (0, http_1.ok)(res, await cartPayload(req.user.id), undefined, 'Item removed');
}));
r.delete('/', (0, http_1.asyncHandler)(async (req, res) => {
    await prisma_1.prisma.cartItem.deleteMany({ where: { cart: { userId: req.user.id } } });
    return (0, http_1.ok)(res, await cartPayload(req.user.id), undefined, 'Cart cleared');
}));
exports.default = r;
