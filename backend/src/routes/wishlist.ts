import { Router } from 'express';
import { prisma } from '../config/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { wishlistSchema } from '../validators/commerce';
import { asyncHandler, ok } from '../utils/http';
import { ApiError } from '../utils/http';

const r = Router();
r.use(authenticate);

r.get('/', asyncHandler(async (req: AuthRequest, res) => {
  const items = await prisma.wishlist.findMany({
    where: { userId: req.user!.id },
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
  return ok(res, items);
}));

r.get('/count', asyncHandler(async (req: AuthRequest, res) => {
  const count = await prisma.wishlist.count({ where: { userId: req.user!.id } });
  return ok(res, { count });
}));

r.post('/', validateBody(wishlistSchema), asyncHandler(async (req: AuthRequest, res) => {
  const { productId } = req.body;
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new ApiError(404, 'Product not found');
  await prisma.wishlist.upsert({
    where: { userId_productId: { userId: req.user!.id, productId } },
    update: {}, create: { userId: req.user!.id, productId },
  });
  const count = await prisma.wishlist.count({ where: { userId: req.user!.id } });
  return ok(res, { count, productId }, undefined, 'Added to wishlist');
}));

r.post('/toggle', validateBody(wishlistSchema), asyncHandler(async (req: AuthRequest, res) => {
  const { productId } = req.body;
  const existing = await prisma.wishlist.findUnique({ where: { userId_productId: { userId: req.user!.id, productId } } });
  if (existing) {
    await prisma.wishlist.delete({ where: { id: existing.id } });
    const count = await prisma.wishlist.count({ where: { userId: req.user!.id } });
    return ok(res, { liked: false, count }, undefined, 'Removed from wishlist');
  }
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new ApiError(404, 'Product not found');
  await prisma.wishlist.create({ data: { userId: req.user!.id, productId } });
  const count = await prisma.wishlist.count({ where: { userId: req.user!.id } });
  return ok(res, { liked: true, count }, undefined, 'Added to wishlist');
}));

r.delete('/:productId', asyncHandler(async (req: AuthRequest, res) => {
  await prisma.wishlist.deleteMany({ where: { userId: req.user!.id, productId: Number(req.params.productId) } });
  const count = await prisma.wishlist.count({ where: { userId: req.user!.id } });
  return ok(res, { count }, undefined, 'Removed from wishlist');
}));

export default r;
