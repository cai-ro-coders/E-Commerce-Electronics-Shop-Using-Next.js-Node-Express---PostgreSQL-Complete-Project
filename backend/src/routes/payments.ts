import { Router } from 'express';
import { OrderStatus, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { authenticate, adminOrStaff, AuthRequest } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { paymentUpdateSchema } from '../validators/commerce';
import { ApiError, asyncHandler, getMeta, getPagination, money, ok } from '../utils/http';
import { notify, recordActivity } from '../utils/audit';
import { getStripeClient, stripeApiError, toMinorUnits } from '../services/stripe';
import { capturePayPalOrder, createPayPalOrder, getPayPalOrderStatus } from '../services/paypal';

const r = Router();

interface PayableOrder {
  id: number;
  userId: number;
  orderNumber: string;
  grandTotal: Prisma.Decimal;
  orderStatus: OrderStatus;
  payment?: { id: number } | null;
}

/** Marks an order paid after a gateway has verified the transaction. */
async function completeOrderPayment(opts: {
  order: PayableOrder;
  gateway: 'stripe' | 'paypal';
  transactionId: string;
  currency: string;
  note: string;
  actorId: number;
  ip?: string;
}) {
  const { order } = opts;
  const nextOrderStatus = order.orderStatus === OrderStatus.Pending ? OrderStatus.Processing : order.orderStatus;
  let paymentId = order.payment?.id;

  await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.upsert({
      where: { orderId: order.id },
      update: {
        transactionId: opts.transactionId,
        paymentGateway: opts.gateway,
        amount: order.grandTotal,
        currency: opts.currency.toUpperCase(),
        status: 'Paid',
        paidAt: new Date(),
      },
      create: {
        orderId: order.id,
        transactionId: opts.transactionId,
        paymentGateway: opts.gateway,
        amount: order.grandTotal,
        currency: opts.currency.toUpperCase(),
        status: 'Paid',
        paidAt: new Date(),
      },
    });
    paymentId = payment.id;
    await tx.order.update({ where: { id: order.id }, data: { paymentStatus: 'Paid', orderStatus: nextOrderStatus } });
    if (nextOrderStatus !== order.orderStatus) {
      await tx.orderStatusHistory.create({ data: { orderId: order.id, status: nextOrderStatus, note: opts.note } });
    }
  });

  const label = opts.gateway === 'stripe' ? 'Stripe' : 'PayPal';
  await notify({
    userId: order.userId,
    title: 'Payment received',
    message: `Payment for order ${order.orderNumber} was confirmed. Your order is being prepared.`,
    type: 'payment',
    link: `/orders/${order.id}`,
  });
  await notify({
    userId: null,
    title: 'Payment received',
    message: `Order ${order.orderNumber} paid with ${label} — $${Number(order.grandTotal).toFixed(2)}.`,
    type: 'payment',
    link: `/admin/orders/${order.id}`,
  });
  await recordActivity({
    userId: opts.actorId,
    action: 'payment.confirmed',
    entity: 'Payment',
    entityId: paymentId,
    details: `Confirmed ${label} payment ${opts.transactionId}`,
    ip: opts.ip,
  });
}

r.get('/stats', authenticate, adminOrStaff, asyncHandler(async (_req, res) => {
  const [total, paid, pending, failed, refunded, revenue, refunds] = await Promise.all([
    prisma.payment.count(), prisma.payment.count({ where: { status: 'Paid' } }),
    prisma.payment.count({ where: { status: 'Pending' } }), prisma.payment.count({ where: { status: 'Failed' } }),
    prisma.payment.count({ where: { status: 'Refunded' } }),
    prisma.payment.aggregate({ where: { status: 'Paid' }, _sum: { amount: true } }),
    prisma.payment.aggregate({ where: { status: 'Refunded' }, _sum: { amount: true } }),
  ]);
  return ok(res, {
    total, paid, pending, failed, refunded,
    grossRevenue: money(Number(revenue._sum.amount ?? 0)),
    refundedAmount: money(Number(refunds._sum.amount ?? 0)),
  });
}));

r.get('/', authenticate, adminOrStaff, asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query as any);
  const search = String(req.query.search || '');
  const status = req.query.status ? String(req.query.status) : undefined;
  const where: any = {
    ...(status ? { status } : {}),
    ...(search ? { OR: [
      { transactionId: { contains: search, mode: 'insensitive' } },
      { order: { orderNumber: { contains: search, mode: 'insensitive' } } },
    ] } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.payment.findMany({
      where, skip, take: limit, orderBy: { createdAt: 'desc' },
      include: { order: { select: { id: true, orderNumber: true, user: { select: { name: true, email: true } } } } },
    }),
    prisma.payment.count({ where }),
  ]);
  return ok(res, items, getMeta(page, limit, total));
}));

r.post('/intent', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const orderId = Number(req.body.orderId);
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { payment: true } });
  if (!order) throw new ApiError(404, 'Order not found');
  if (order.userId !== req.user!.id && !['admin', 'staff'].includes(req.user!.role)) throw new ApiError(403, 'You cannot pay for this order');
  if (order.paymentStatus === 'Paid') throw new ApiError(400, 'This order has already been paid');
  if (order.paymentStatus === 'Refunded') throw new ApiError(400, 'This order has been refunded');
  if (['Cancelled', 'Returned'].includes(order.orderStatus)) throw new ApiError(400, 'This order can no longer be paid');
  const gateway = req.body.gateway === 'paypal' ? 'paypal' : 'stripe';

  if (gateway === 'paypal') {
    if (order.paymentMethod && order.paymentMethod !== 'paypal') {
      throw new ApiError(400, 'This order is not configured for PayPal');
    }
    // Reuse an existing PayPal order on retry so a cancelled/abandoned attempt is never charged twice.
    const existingId = order.payment?.paymentGateway === 'paypal' ? order.payment.transactionId : null;
    if (existingId && order.payment) {
      const existingStatus = await getPayPalOrderStatus(existingId);
      if (existingStatus === 'COMPLETED') {
        // The PayPal capture succeeded but the local order was not updated (for example a dropped response).
        // Finish it locally instead of creating a second chargeable order.
        const capture = await capturePayPalOrder(existingId);
        if (Math.round(capture.amount * 100) !== Math.round(Number(order.grandTotal) * 100)) {
          throw new ApiError(400, 'The paid amount does not match this order');
        }
        await completeOrderPayment({
          order,
          gateway: 'paypal',
          transactionId: capture.captureId,
          currency: capture.currency,
          note: 'PayPal payment confirmed',
          actorId: req.user!.id,
          ip: req.ip,
        });
        return ok(res, { payment: order.payment, paypalOrderId: existingId, status: existingStatus, alreadyPaid: true, demo: false }, undefined, 'Payment confirmed');
      }
      if (existingStatus && ['CREATED', 'PAYER_ACTION_REQUIRED', 'APPROVED'].includes(existingStatus)) {
        return ok(res, { payment: order.payment, paypalOrderId: existingId, status: existingStatus, demo: false });
      }
    }
    const { paypalOrderId, status, currency } = await createPayPalOrder(order);
    const payment = await prisma.payment.upsert({
      where: { orderId },
      update: {
        paymentGateway: 'paypal',
        status: 'Pending',
        amount: order.grandTotal,
        currency,
        transactionId: paypalOrderId,
      },
      create: {
        orderId,
        amount: order.grandTotal,
        paymentGateway: 'paypal',
        status: 'Pending',
        currency,
        transactionId: paypalOrderId,
      },
    });
    await recordActivity({ userId: req.user!.id, action: 'payment.intent_created', entity: 'Payment', entityId: payment.id, details: `Created PayPal order ${paypalOrderId}`, ip: req.ip });
    return ok(res, { payment, paypalOrderId, status, demo: false });
  }

  const { stripe, currency, publishableKey } = await getStripeClient();
  if (order.paymentMethod && order.paymentMethod !== 'stripe') {
    throw new ApiError(400, 'This order is not configured for card payment');
  }

  const amount = toMinorUnits(Number(order.grandTotal));
  const intent = await stripe.paymentIntents.create({
    amount,
    currency,
    allowed_payment_method_types: ['card'],
    description: `ElectroShop order ${order.orderNumber}`,
    receipt_email: req.user!.email,
    metadata: {
      orderId: String(order.id),
      orderNumber: order.orderNumber,
      userId: String(order.userId),
      integration: 'electroshop',
    },
  }).catch((error) => {
    throw stripeApiError(error);
  });

  const payment = await prisma.payment.upsert({
    where: { orderId },
    update: {
      paymentGateway: 'stripe',
      status: 'Pending',
      amount: order.grandTotal,
      currency: currency.toUpperCase(),
      transactionId: intent.id,
    },
    create: {
      orderId,
      amount: order.grandTotal,
      paymentGateway: 'stripe',
      status: 'Pending',
      currency: currency.toUpperCase(),
      transactionId: intent.id,
    },
  });

  await recordActivity({ userId: req.user!.id, action: 'payment.intent_created', entity: 'Payment', entityId: payment.id, details: `Created Stripe PaymentIntent ${intent.id}`, ip: req.ip });
  return ok(res, {
    payment,
    clientSecret: intent.client_secret,
    paymentIntentId: intent.id,
    publishableKey,
    currency: currency.toUpperCase(),
    demo: false,
  });
}));

r.post('/confirm', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const paymentIntentId = String(req.body.paymentIntentId || '').trim();
  if (!paymentIntentId) throw new ApiError(400, 'A PaymentIntent id is required');

  const { stripe } = await getStripeClient();
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId).catch((error) => {
    throw stripeApiError(error);
  });
  if (intent.status !== 'succeeded') throw new ApiError(400, `Payment has not completed (status: ${intent.status})`);

  const orderId = Number(intent.metadata?.orderId);
  if (!orderId) throw new ApiError(400, 'This payment is not linked to an order');
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { payment: true } });
  if (!order) throw new ApiError(404, 'Order not found');
  if (order.userId !== req.user!.id && !['admin', 'staff'].includes(req.user!.role)) throw new ApiError(403, 'You cannot confirm this payment');
  if (intent.amount_received !== toMinorUnits(Number(order.grandTotal))) throw new ApiError(400, 'The paid amount does not match this order');

  if (order.paymentStatus !== 'Paid') {
    await completeOrderPayment({
      order,
      gateway: 'stripe',
      transactionId: intent.id,
      currency: intent.currency,
      note: 'Stripe payment confirmed',
      actorId: req.user!.id,
      ip: req.ip,
    });
  }

  return ok(res, { orderId: order.id, orderNumber: order.orderNumber, paymentStatus: 'Paid', transactionId: intent.id }, undefined, 'Payment confirmed');
}));

r.post('/paypal/capture', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const orderId = Number(req.body.orderId);
  const paypalOrderId = String(req.body.paypalOrderId || '').trim();
  if (!orderId || !paypalOrderId) throw new ApiError(400, 'Order id and PayPal order id are required');

  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { payment: true } });
  if (!order) throw new ApiError(404, 'Order not found');
  if (order.userId !== req.user!.id && !['admin', 'staff'].includes(req.user!.role)) throw new ApiError(403, 'You cannot confirm this payment');
  if (order.paymentMethod && order.paymentMethod !== 'paypal') throw new ApiError(400, 'This order is not configured for PayPal');

  if (order.paymentStatus === 'Paid') {
    return ok(res, { orderId: order.id, orderNumber: order.orderNumber, paymentStatus: 'Paid', transactionId: order.payment?.transactionId }, undefined, 'Payment confirmed');
  }
  if (order.paymentStatus === 'Refunded') throw new ApiError(400, 'This order has been refunded');
  if (['Cancelled', 'Returned'].includes(order.orderStatus)) throw new ApiError(400, 'This order can no longer be paid');
  if (!order.payment || order.payment.transactionId !== paypalOrderId) {
    throw new ApiError(400, 'This PayPal order does not match your checkout. Start the PayPal payment again.');
  }

  const capture = await capturePayPalOrder(paypalOrderId);
  if (capture.customId && Number(capture.customId) !== order.id) {
    throw new ApiError(400, 'This payment is not linked to this order');
  }
  if (Math.round(capture.amount * 100) !== Math.round(Number(order.grandTotal) * 100)) {
    throw new ApiError(400, 'The paid amount does not match this order');
  }
  if (capture.currency !== String(order.payment.currency ?? '').toUpperCase()) {
    throw new ApiError(400, 'The paid currency does not match this order');
  }

  await completeOrderPayment({
    order,
    gateway: 'paypal',
    transactionId: capture.captureId,
    currency: capture.currency,
    note: 'PayPal payment confirmed',
    actorId: req.user!.id,
    ip: req.ip,
  });

  return ok(res, { orderId: order.id, orderNumber: order.orderNumber, paymentStatus: 'Paid', transactionId: capture.captureId }, undefined, 'Payment confirmed');
}));

r.get('/order/:orderId', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const payment = await prisma.payment.findUnique({
    where: { orderId: Number(req.params.orderId) },
    include: { order: { select: { userId: true, orderNumber: true } } },
  });
  if (!payment) throw new ApiError(404, 'Payment not found');
  if (payment.order.userId !== req.user!.id && !['admin', 'staff'].includes(req.user!.role)) throw new ApiError(403, 'You cannot access this payment');
  return ok(res, payment);
}));

r.patch('/:id', authenticate, adminOrStaff, validateBody(paymentUpdateSchema), asyncHandler(async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const payment = await prisma.payment.update({
    where: { id },
    data: {
      status: req.body.status,
      paidAt: req.body.status === 'Paid' ? new Date() : null,
      ...(req.body.transactionId !== undefined ? { transactionId: req.body.transactionId } : {}),
    },
  });
  await prisma.order.update({ where: { id: payment.orderId }, data: { paymentStatus: req.body.status } });
  await recordActivity({ userId: req.user!.id, action: 'payment.updated', entity: 'Payment', entityId: id, details: `Set payment status to ${req.body.status}`, ip: req.ip });
  return ok(res, payment, undefined, 'Payment updated');
}));

r.post('/:id/refund', authenticate, adminOrStaff, asyncHandler(async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.payment.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, 'Payment not found');
  if (existing.status !== 'Paid') throw new ApiError(400, 'Only paid payments can be refunded');
  const payment = await prisma.payment.update({ where: { id }, data: { status: 'Refunded' } });
  await prisma.order.update({ where: { id: payment.orderId }, data: { paymentStatus: 'Refunded' } });
  await recordActivity({ userId: req.user!.id, action: 'payment.refunded', entity: 'Payment', entityId: id, details: `Refunded payment #${id}`, ip: req.ip });
  return ok(res, payment, undefined, 'Payment refunded');
}));

export default r;
