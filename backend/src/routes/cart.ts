import { Router } from 'express';
import { prisma } from '../config/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { cartItemSchema, cartUpdateSchema } from '../validators/commerce';
import { ApiError, asyncHandler, money, ok } from '../utils/http';
import { getSetting } from '../services/orderService';

const r = Router();
r.use(authenticate);

const cartInclude = {
  items: {
    orderBy: { createdAt: 'desc' as const },
    include: {
      product: {
        include: {
          images: { take: 1, orderBy: { sortOrder: 'asc' as const } },
          brand: { select: { name: true } },
          category: { select: { name: true, slug: true } },
        },
      },
    },
  },
} as const;

async function ensureCart(userId: number) {
  return prisma.cart.upsert({ where: { userId }, update: {}, create: { userId } });
}

async function cartPayload(userId: number) {
  const cart = await prisma.cart.findUnique({ where: { userId }, include: cartInclude });
  if (!cart) return { items: [], subtotal: 0, shippingFee: 0, tax: 0, total: 0, itemCount: 0 };
  const [taxRate, shippingFee, threshold] = await Promise.all([
    getSetting('tax_rate', '8'), getSetting('shipping_fee', '12.99'), getSetting('free_shipping_threshold', '500'),
  ]);
  const subtotal = money(cart.items.reduce((s, i) => s + Number(i.price) * i.quantity, 0));
  const shipping = subtotal >= Number(threshold) ? 0 : subtotal > 0 ? Number(shippingFee) : 0;
  const tax = money((subtotal * Number(taxRate)) / 100);
  return {
    ...cart,
    subtotal,
    shippingFee: money(shipping),
    tax,
    total: money(subtotal + shipping + tax),
    itemCount: cart.items.reduce((s, i) => s + i.quantity, 0),
  };
}

r.get('/', asyncHandler(async (req: AuthRequest, res) => {
  await ensureCart(req.user!.id);
  return ok(res, await cartPayload(req.user!.id));
}));

r.post('/items', validateBody(cartItemSchema), asyncHandler(async (req: AuthRequest, res) => {
  const { productId, quantity } = req.body;
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new ApiError(404, 'Product not found');
  if (product.status !== 'active') throw new ApiError(400, 'This product is not available');
  const cart = await ensureCart(req.user!.id);
  const existing = await prisma.cartItem.findUnique({ where: { cartId_productId: { cartId: cart.id, productId } } });
  const nextQty = (existing?.quantity ?? 0) + quantity;
  if (nextQty > product.stockQuantity) throw new ApiError(400, `Only ${product.stockQuantity} unit(s) available`);
  await prisma.cartItem.upsert({
    where: { cartId_productId: { cartId: cart.id, productId } },
    update: { quantity: nextQty, price: product.salePrice ?? product.price },
    create: { cartId: cart.id, productId, quantity: nextQty, price: product.salePrice ?? product.price },
  });
  return ok(res, await cartPayload(req.user!.id), undefined, 'Added to cart');
}));

r.put('/items/:id', validateBody(cartUpdateSchema), asyncHandler(async (req: AuthRequest, res) => {
  const item = await prisma.cartItem.findFirst({ where: { id: Number(req.params.id), cart: { userId: req.user!.id } }, include: { product: true } });
  if (!item) throw new ApiError(404, 'Cart item not found');
  if (req.body.quantity > item.product.stockQuantity) throw new ApiError(400, `Only ${item.product.stockQuantity} unit(s) available`);
  await prisma.cartItem.update({ where: { id: item.id }, data: { quantity: req.body.quantity } });
  return ok(res, await cartPayload(req.user!.id), undefined, 'Cart updated');
}));

r.delete('/items/:id', asyncHandler(async (req: AuthRequest, res) => {
  const item = await prisma.cartItem.findFirst({ where: { id: Number(req.params.id), cart: { userId: req.user!.id } } });
  if (!item) throw new ApiError(404, 'Cart item not found');
  await prisma.cartItem.delete({ where: { id: item.id } });
  return ok(res, await cartPayload(req.user!.id), undefined, 'Item removed');
}));

r.delete('/', asyncHandler(async (req: AuthRequest, res) => {
  await prisma.cartItem.deleteMany({ where: { cart: { userId: req.user!.id } } });
  return ok(res, await cartPayload(req.user!.id), undefined, 'Cart cleared');
}));

export default r;
