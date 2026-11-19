"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const prisma_1 = require("../config/prisma");
const auth_1 = require("../middleware/auth");
const validate_1 = require("../middleware/validate");
const commerce_1 = require("../validators/commerce");
const http_1 = require("../utils/http");
const audit_1 = require("../utils/audit");
const stripe_1 = require("../services/stripe");
const paypal_1 = require("../services/paypal");
const r = (0, express_1.Router)();
/** Marks an order paid after a gateway has verified the transaction. */
async function completeOrderPayment(opts) {
    const { order } = opts;
    const nextOrderStatus = order.orderStatus === client_1.OrderStatus.Pending ? client_1.OrderStatus.Processing : order.orderStatus;
    let paymentId = order.payment?.id;
    await prisma_1.prisma.$transaction(async (tx) => {
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
    await (0, audit_1.notify)({
        userId: order.userId,
        title: 'Payment received',
        message: `Payment for order ${order.orderNumber} was confirmed. Your order is being prepared.`,
        type: 'payment',
        link: `/orders/${order.id}`,
    });
    await (0, audit_1.notify)({
        userId: null,
        title: 'Payment received',
        message: `Order ${order.orderNumber} paid with ${label} — $${Number(order.grandTotal).toFixed(2)}.`,
        type: 'payment',
        link: `/admin/orders/${order.id}`,
    });
    await (0, audit_1.recordActivity)({
        userId: opts.actorId,
        action: 'payment.confirmed',
        entity: 'Payment',
        entityId: paymentId,
        details: `Confirmed ${label} payment ${opts.transactionId}`,
        ip: opts.ip,
    });
}
r.get('/stats', auth_1.authenticate, auth_1.adminOrStaff, (0, http_1.asyncHandler)(async (_req, res) => {
    const [total, paid, pending, failed, refunded, revenue, refunds] = await Promise.all([
        prisma_1.prisma.payment.count(), prisma_1.prisma.payment.count({ where: { status: 'Paid' } }),
        prisma_1.prisma.payment.count({ where: { status: 'Pending' } }), prisma_1.prisma.payment.count({ where: { status: 'Failed' } }),
        prisma_1.prisma.payment.count({ where: { status: 'Refunded' } }),
        prisma_1.prisma.payment.aggregate({ where: { status: 'Paid' }, _sum: { amount: true } }),
        prisma_1.prisma.payment.aggregate({ where: { status: 'Refunded' }, _sum: { amount: true } }),
    ]);
    return (0, http_1.ok)(res, {
        total, paid, pending, failed, refunded,
        grossRevenue: (0, http_1.money)(Number(revenue._sum.amount ?? 0)),
        refundedAmount: (0, http_1.money)(Number(refunds._sum.amount ?? 0)),
    });
}));
r.get('/', auth_1.authenticate, auth_1.adminOrStaff, (0, http_1.asyncHandler)(async (req, res) => {
    const { page, limit, skip } = (0, http_1.getPagination)(req.query);
    const search = String(req.query.search || '');
    const status = req.query.status ? String(req.query.status) : undefined;
    const where = {
        ...(status ? { status } : {}),
        ...(search ? { OR: [
                { transactionId: { contains: search, mode: 'insensitive' } },
                { order: { orderNumber: { contains: search, mode: 'insensitive' } } },
            ] } : {}),
    };
    const [items, total] = await Promise.all([
        prisma_1.prisma.payment.findMany({
            where, skip, take: limit, orderBy: { createdAt: 'desc' },
            include: { order: { select: { id: true, orderNumber: true, user: { select: { name: true, email: true } } } } },
        }),
        prisma_1.prisma.payment.count({ where }),
    ]);
    return (0, http_1.ok)(res, items, (0, http_1.getMeta)(page, limit, total));
}));
r.post('/intent', auth_1.authenticate, (0, http_1.asyncHandler)(async (req, res) => {
    const orderId = Number(req.body.orderId);
    const order = await prisma_1.prisma.order.findUnique({ where: { id: orderId }, include: { payment: true } });
    if (!order)
        throw new http_1.ApiError(404, 'Order not found');
    if (order.userId !== req.user.id && !['admin', 'staff'].includes(req.user.role))
        throw new http_1.ApiError(403, 'You cannot pay for this order');
    if (order.paymentStatus === 'Paid')
        throw new http_1.ApiError(400, 'This order has already been paid');
    if (order.paymentStatus === 'Refunded')
        throw new http_1.ApiError(400, 'This order has been refunded');
    if (['Cancelled', 'Returned'].includes(order.orderStatus))
        throw new http_1.ApiError(400, 'This order can no longer be paid');
    const gateway = req.body.gateway === 'paypal' ? 'paypal' : 'stripe';
    if (gateway === 'paypal') {
        if (order.paymentMethod && order.paymentMethod !== 'paypal') {
            throw new http_1.ApiError(400, 'This order is not configured for PayPal');
        }
        // Reuse an existing PayPal order on retry so a cancelled/abandoned attempt is never charged twice.
        const existingId = order.payment?.paymentGateway === 'paypal' ? order.payment.transactionId : null;
        if (existingId && order.payment) {
            const existingStatus = await (0, paypal_1.getPayPalOrderStatus)(existingId);
            if (existingStatus === 'COMPLETED') {
                // The PayPal capture succeeded but the local order was not updated (for example a dropped response).
                // Finish it locally instead of creating a second chargeable order.
                const capture = await (0, paypal_1.capturePayPalOrder)(existingId);
                if (Math.round(capture.amount * 100) !== Math.round(Number(order.grandTotal) * 100)) {
                    throw new http_1.ApiError(400, 'The paid amount does not match this order');
                }
                await completeOrderPayment({
                    order,
                    gateway: 'paypal',
                    transactionId: capture.captureId,
                    currency: capture.currency,
                    note: 'PayPal payment confirmed',
                    actorId: req.user.id,
                    ip: req.ip,
                });
                return (0, http_1.ok)(res, { payment: order.payment, paypalOrderId: existingId, status: existingStatus, alreadyPaid: true, demo: false }, undefined, 'Payment confirmed');
            }
            if (existingStatus && ['CREATED', 'PAYER_ACTION_REQUIRED', 'APPROVED'].includes(existingStatus)) {
                return (0, http_1.ok)(res, { payment: order.payment, paypalOrderId: existingId, status: existingStatus, demo: false });
            }
        }
        const { paypalOrderId, status, currency } = await (0, paypal_1.createPayPalOrder)(order);
        const payment = await prisma_1.prisma.payment.upsert({
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
        await (0, audit_1.recordActivity)({ userId: req.user.id, action: 'payment.intent_created', entity: 'Payment', entityId: payment.id, details: `Created PayPal order ${paypalOrderId}`, ip: req.ip });
        return (0, http_1.ok)(res, { payment, paypalOrderId, status, demo: false });
    }
    const { stripe, currency, publishableKey } = await (0, stripe_1.getStripeClient)();
    if (order.paymentMethod && order.paymentMethod !== 'stripe') {
        throw new http_1.ApiError(400, 'This order is not configured for card payment');
    }
    const amount = (0, stripe_1.toMinorUnits)(Number(order.grandTotal));
    const intent = await stripe.paymentIntents.create({
        amount,
        currency,
        allowed_payment_method_types: ['card'],
        description: `ElectroShop order ${order.orderNumber}`,
        receipt_email: req.user.email,
        metadata: {
            orderId: String(order.id),
            orderNumber: order.orderNumber,
            userId: String(order.userId),
            integration: 'electroshop',
        },
    }).catch((error) => {
        throw (0, stripe_1.stripeApiError)(error);
    });
    const payment = await prisma_1.prisma.payment.upsert({
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
    await (0, audit_1.recordActivity)({ userId: req.user.id, action: 'payment.intent_created', entity: 'Payment', entityId: payment.id, details: `Created Stripe PaymentIntent ${intent.id}`, ip: req.ip });
    return (0, http_1.ok)(res, {
        payment,
        clientSecret: intent.client_secret,
        paymentIntentId: intent.id,
        publishableKey,
        currency: currency.toUpperCase(),
        demo: false,
    });
}));
r.post('/confirm', auth_1.authenticate, (0, http_1.asyncHandler)(async (req, res) => {
    const paymentIntentId = String(req.body.paymentIntentId || '').trim();
    if (!paymentIntentId)
        throw new http_1.ApiError(400, 'A PaymentIntent id is required');
    const { stripe } = await (0, stripe_1.getStripeClient)();
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId).catch((error) => {
        throw (0, stripe_1.stripeApiError)(error);
    });
    if (intent.status !== 'succeeded')
        throw new http_1.ApiError(400, `Payment has not completed (status: ${intent.status})`);
    const orderId = Number(intent.metadata?.orderId);
    if (!orderId)
        throw new http_1.ApiError(400, 'This payment is not linked to an order');
    const order = await prisma_1.prisma.order.findUnique({ where: { id: orderId }, include: { payment: true } });
    if (!order)
        throw new http_1.ApiError(404, 'Order not found');
    if (order.userId !== req.user.id && !['admin', 'staff'].includes(req.user.role))
        throw new http_1.ApiError(403, 'You cannot confirm this payment');
    if (intent.amount_received !== (0, stripe_1.toMinorUnits)(Number(order.grandTotal)))
        throw new http_1.ApiError(400, 'The paid amount does not match this order');
    if (order.paymentStatus !== 'Paid') {
        await completeOrderPayment({
            order,
            gateway: 'stripe',
            transactionId: intent.id,
            currency: intent.currency,
            note: 'Stripe payment confirmed',
            actorId: req.user.id,
            ip: req.ip,
        });
    }
    return (0, http_1.ok)(res, { orderId: order.id, orderNumber: order.orderNumber, paymentStatus: 'Paid', transactionId: intent.id }, undefined, 'Payment confirmed');
}));
r.post('/paypal/capture', auth_1.authenticate, (0, http_1.asyncHandler)(async (req, res) => {
    const orderId = Number(req.body.orderId);
    const paypalOrderId = String(req.body.paypalOrderId || '').trim();
    if (!orderId || !paypalOrderId)
        throw new http_1.ApiError(400, 'Order id and PayPal order id are required');
    const order = await prisma_1.prisma.order.findUnique({ where: { id: orderId }, include: { payment: true } });
    if (!order)
        throw new http_1.ApiError(404, 'Order not found');
    if (order.userId !== req.user.id && !['admin', 'staff'].includes(req.user.role))
        throw new http_1.ApiError(403, 'You cannot confirm this payment');
    if (order.paymentMethod && order.paymentMethod !== 'paypal')
        throw new http_1.ApiError(400, 'This order is not configured for PayPal');
    if (order.paymentStatus === 'Paid') {
        return (0, http_1.ok)(res, { orderId: order.id, orderNumber: order.orderNumber, paymentStatus: 'Paid', transactionId: order.payment?.transactionId }, undefined, 'Payment confirmed');
    }
    if (order.paymentStatus === 'Refunded')
        throw new http_1.ApiError(400, 'This order has been refunded');
    if (['Cancelled', 'Returned'].includes(order.orderStatus))
        throw new http_1.ApiError(400, 'This order can no longer be paid');
    if (!order.payment || order.payment.transactionId !== paypalOrderId) {
        throw new http_1.ApiError(400, 'This PayPal order does not match your checkout. Start the PayPal payment again.');
    }
    const capture = await (0, paypal_1.capturePayPalOrder)(paypalOrderId);
    if (capture.customId && Number(capture.customId) !== order.id) {
        throw new http_1.ApiError(400, 'This payment is not linked to this order');
    }
    if (Math.round(capture.amount * 100) !== Math.round(Number(order.grandTotal) * 100)) {
        throw new http_1.ApiError(400, 'The paid amount does not match this order');
    }
    if (capture.currency !== String(order.payment.currency ?? '').toUpperCase()) {
        throw new http_1.ApiError(400, 'The paid currency does not match this order');
    }
    await completeOrderPayment({
        order,
        gateway: 'paypal',
        transactionId: capture.captureId,
        currency: capture.currency,
        note: 'PayPal payment confirmed',
        actorId: req.user.id,
        ip: req.ip,
    });
    return (0, http_1.ok)(res, { orderId: order.id, orderNumber: order.orderNumber, paymentStatus: 'Paid', transactionId: capture.captureId }, undefined, 'Payment confirmed');
}));
r.get('/order/:orderId', auth_1.authenticate, (0, http_1.asyncHandler)(async (req, res) => {
    const payment = await prisma_1.prisma.payment.findUnique({
        where: { orderId: Number(req.params.orderId) },
        include: { order: { select: { userId: true, orderNumber: true } } },
    });
    if (!payment)
        throw new http_1.ApiError(404, 'Payment not found');
    if (payment.order.userId !== req.user.id && !['admin', 'staff'].includes(req.user.role))
        throw new http_1.ApiError(403, 'You cannot access this payment');
    return (0, http_1.ok)(res, payment);
}));
r.patch('/:id', auth_1.authenticate, auth_1.adminOrStaff, (0, validate_1.validateBody)(commerce_1.paymentUpdateSchema), (0, http_1.asyncHandler)(async (req, res) => {
    const id = Number(req.params.id);
    const payment = await prisma_1.prisma.payment.update({
        where: { id },
        data: {
            status: req.body.status,
            paidAt: req.body.status === 'Paid' ? new Date() : null,
            ...(req.body.transactionId !== undefined ? { transactionId: req.body.transactionId } : {}),
        },
    });
    await prisma_1.prisma.order.update({ where: { id: payment.orderId }, data: { paymentStatus: req.body.status } });
    await (0, audit_1.recordActivity)({ userId: req.user.id, action: 'payment.updated', entity: 'Payment', entityId: id, details: `Set payment status to ${req.body.status}`, ip: req.ip });
    return (0, http_1.ok)(res, payment, undefined, 'Payment updated');
}));
r.post('/:id/refund', auth_1.authenticate, auth_1.adminOrStaff, (0, http_1.asyncHandler)(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma_1.prisma.payment.findUnique({ where: { id } });
    if (!existing)
        throw new http_1.ApiError(404, 'Payment not found');
    if (existing.status !== 'Paid')
        throw new http_1.ApiError(400, 'Only paid payments can be refunded');
    const payment = await prisma_1.prisma.payment.update({ where: { id }, data: { status: 'Refunded' } });
    await prisma_1.prisma.order.update({ where: { id: payment.orderId }, data: { paymentStatus: 'Refunded' } });
    await (0, audit_1.recordActivity)({ userId: req.user.id, action: 'payment.refunded', entity: 'Payment', entityId: id, details: `Refunded payment #${id}`, ip: req.ip });
    return (0, http_1.ok)(res, payment, undefined, 'Payment refunded');
}));
exports.default = r;
