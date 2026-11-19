"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.orderInclude = void 0;
exports.getSetting = getSetting;
exports.checkout = checkout;
exports.updateOrderStatus = updateOrderStatus;
exports.orderStats = orderStats;
const client_1 = require("@prisma/client");
const prisma_1 = require("../config/prisma");
const http_1 = require("../utils/http");
const audit_1 = require("../utils/audit");
exports.orderInclude = {
    user: { select: { id: true, name: true, email: true, phone: true, avatar: true } },
    items: { include: { product: { select: { id: true, name: true, slug: true, images: { take: 1, orderBy: { sortOrder: 'asc' } } } } } },
    payment: true,
    shippingAddress: true,
    statusHistory: { orderBy: { createdAt: 'asc' } },
    couponUsages: { include: { coupon: { select: { code: true, type: true, value: true } } } },
};
async function getSetting(key, fallback) {
    const row = await prisma_1.prisma.setting.findUnique({ where: { key } });
    return row?.value ?? fallback;
}
function paymentGatewayLabel(method) {
    return method === 'cod' ? 'cash_on_delivery' : method;
}
async function nextOrderNumber(tx) {
    for (let i = 0; i < 5; i++) {
        const candidate = `ORD-${new Date().getFullYear()}${String(Date.now()).slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
        const exists = await tx.order.findUnique({ where: { orderNumber: candidate }, select: { id: true } });
        if (!exists)
            return candidate;
    }
    throw new http_1.ApiError(500, 'Could not generate an order number. Please try again.');
}
async function checkout(userId, input, ip) {
    const productIds = input.items.map((i) => i.productId);
    const products = await prisma_1.prisma.product.findMany({ where: { id: { in: productIds } } });
    if (products.length !== new Set(productIds).size)
        throw new http_1.ApiError(400, 'One or more products in your cart are no longer available');
    const lines = input.items.map((line) => {
        const product = products.find((p) => p.id === line.productId);
        if (product.status !== 'active')
            throw new http_1.ApiError(400, `${product.name} is not available for purchase`);
        if (product.stockQuantity < line.quantity)
            throw new http_1.ApiError(400, `Only ${product.stockQuantity} unit(s) of ${product.name} are in stock`);
        const unitPrice = Number(product.salePrice ?? product.price);
        return {
            product, quantity: line.quantity, unitPrice,
            total: (0, http_1.money)(unitPrice * line.quantity),
            cost: Number(product.costPrice ?? unitPrice * 0.7),
        };
    });
    const subtotal = (0, http_1.money)(lines.reduce((s, l) => s + l.total, 0));
    let addressId = input.addressId;
    if (addressId) {
        const address = await prisma_1.prisma.address.findFirst({ where: { id: addressId, userId } });
        if (!address)
            throw new http_1.ApiError(400, 'The selected shipping address is invalid');
    }
    else if (input.address) {
        const existing = await prisma_1.prisma.address.count({ where: { userId } });
        const address = await prisma_1.prisma.address.create({
            data: {
                userId,
                fullName: input.address.fullName,
                phone: input.address.phone,
                addressLine1: input.address.addressLine1,
                addressLine2: input.address.addressLine2 ?? null,
                city: input.address.city,
                province: input.address.province,
                postalCode: input.address.postalCode,
                country: input.address.country,
                isDefault: input.address.isDefault ?? existing === 0,
            },
        });
        addressId = address.id;
    }
    if (!addressId)
        throw new http_1.ApiError(400, 'A shipping address is required');
    let couponId;
    let discount = 0;
    let couponCode = null;
    if (input.couponCode) {
        const now = new Date();
        const coupon = await prisma_1.prisma.coupon.findUnique({ where: { code: input.couponCode.toUpperCase() } });
        if (!coupon || coupon.status !== 'active')
            throw new http_1.ApiError(400, 'This coupon is not valid');
        if (coupon.startDate && coupon.startDate > now)
            throw new http_1.ApiError(400, 'This coupon is not active yet');
        if (coupon.endDate && coupon.endDate < now)
            throw new http_1.ApiError(400, 'This coupon has expired');
        if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit)
            throw new http_1.ApiError(400, 'This coupon has reached its usage limit');
        if (coupon.minimumOrder && subtotal < Number(coupon.minimumOrder))
            throw new http_1.ApiError(400, `This coupon requires a minimum order of $${Number(coupon.minimumOrder).toFixed(2)}`);
        discount = coupon.type === 'percentage' ? (subtotal * Number(coupon.value)) / 100 : Number(coupon.value);
        if (coupon.maximumDiscount)
            discount = Math.min(discount, Number(coupon.maximumDiscount));
        discount = Math.min((0, http_1.money)(discount), subtotal);
        couponId = coupon.id;
        couponCode = coupon.code;
    }
    const [shippingRaw, taxRaw, freeThresholdRaw] = await Promise.all([
        getSetting('shipping_fee', '12.99'),
        getSetting('tax_rate', '8'),
        getSetting('free_shipping_threshold', '500'),
    ]);
    const shippingBase = Number(shippingRaw) || 0;
    const freeThreshold = Number(freeThresholdRaw) || 0;
    const shippingFee = subtotal - discount >= freeThreshold ? 0 : (0, http_1.money)(shippingBase);
    const tax = (0, http_1.money)(((subtotal - discount) * (Number(taxRaw) || 0)) / 100);
    const grandTotal = (0, http_1.money)(subtotal - discount + shippingFee + tax);
    // Stripe and PayPal orders stay pending until the gateway confirms the payment.
    const paid = false;
    const order = await prisma_1.prisma.$transaction(async (tx) => {
        for (const line of lines) {
            const updated = await tx.product.updateMany({
                where: { id: line.product.id, stockQuantity: { gte: line.quantity } },
                data: { stockQuantity: { decrement: line.quantity } },
            });
            if (updated.count !== 1)
                throw new http_1.ApiError(409, `${line.product.name} just went out of stock. Please update your cart.`);
        }
        const orderNumber = await nextOrderNumber(tx);
        const created = await tx.order.create({
            data: {
                userId,
                orderNumber,
                subtotal,
                discount,
                shippingFee,
                tax,
                grandTotal,
                paymentMethod: input.paymentMethod,
                paymentStatus: paid ? client_1.PaymentStatus.Paid : client_1.PaymentStatus.Pending,
                orderStatus: paid ? client_1.OrderStatus.Processing : client_1.OrderStatus.Pending,
                shippingAddressId: addressId,
                couponCode,
                notes: input.notes ? String(input.notes).slice(0, 1000) : null,
                estimatedDelivery: (0, http_1.addDays)(new Date(), 3),
                items: {
                    create: lines.map((l) => ({
                        productId: l.product.id, productName: l.product.name, sku: l.product.sku,
                        quantity: l.quantity, price: l.unitPrice, total: l.total,
                    })),
                },
                payment: {
                    create: {
                        // Stripe/PayPal transaction ids are created by the gateway after checkout.
                        transactionId: input.paymentMethod === 'cod' ? `TXN-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}` : null,
                        paymentGateway: paymentGatewayLabel(input.paymentMethod),
                        amount: grandTotal,
                        currency: await tx.setting.findUnique({ where: { key: 'currency' } }).then((s) => s?.value ?? 'USD'),
                        status: paid ? client_1.PaymentStatus.Paid : client_1.PaymentStatus.Pending,
                        paidAt: paid ? new Date() : null,
                    },
                },
                statusHistory: {
                    create: [{ status: client_1.OrderStatus.Pending, note: 'Order placed by customer' }, ...(paid ? [{ status: client_1.OrderStatus.Processing, note: 'Payment confirmed and order is being prepared' }] : [])],
                },
            },
            include: exports.orderInclude,
        });
        await tx.inventoryLog.createMany({
            data: lines.map((l) => ({
                productId: l.product.id, type: 'stock_out', quantity: l.quantity,
                reference: orderNumber, remarks: `Sold via checkout (${input.paymentMethod})`,
            })),
        });
        if (couponId && discount > 0) {
            await tx.couponUsage.create({ data: { couponId, userId, orderId: created.id, discountAmount: discount } });
            await tx.coupon.update({ where: { id: couponId }, data: { usedCount: { increment: 1 } } });
        }
        await tx.cartItem.deleteMany({ where: { cart: { userId } } });
        return created;
    });
    await (0, audit_1.notify)({ userId, title: 'Order confirmed', message: `Order ${order.orderNumber} has been received. Total $${grandTotal.toFixed(2)}.`, type: 'order', link: `/orders/${order.id}` });
    await (0, audit_1.notify)({ userId: null, title: 'New order received', message: `${order.orderNumber} from ${order.user?.name ?? 'a customer'} — $${grandTotal.toFixed(2)}`, type: 'order', link: `/admin/orders/${order.id}` });
    await (0, audit_1.recordActivity)({ userId, action: 'order.created', entity: 'Order', entityId: order.id, details: `Placed order ${order.orderNumber}`, ip });
    const productsWithCost = new Map(lines.map((l) => [l.product.id, l.cost]));
    return { ...order, items: order.items.map((it) => ({ ...it, costPrice: productsWithCost.get(it.productId ?? 0) ?? 0 })) };
}
async function updateOrderStatus(orderId, data, actorId, ip) {
    const existing = await prisma_1.prisma.order.findUnique({ where: { id: orderId }, include: { items: true, payment: true } });
    if (!existing)
        throw new http_1.ApiError(404, 'Order not found');
    const newStatus = data.orderStatus;
    const terminal = ['Cancelled', 'Returned'];
    const restoreStock = newStatus && terminal.includes(newStatus) && !terminal.includes(existing.orderStatus);
    const order = await prisma_1.prisma.$transaction(async (tx) => {
        const update = {};
        if (newStatus)
            update.orderStatus = newStatus;
        if (data.paymentStatus)
            update.paymentStatus = data.paymentStatus;
        if (data.trackingNumber !== undefined)
            update.trackingNumber = data.trackingNumber;
        if (data.carrier !== undefined)
            update.carrier = data.carrier;
        if (data.notes !== undefined)
            update.notes = data.notes;
        if (data.estimatedDelivery !== undefined)
            update.estimatedDelivery = data.estimatedDelivery ? new Date(data.estimatedDelivery) : null;
        if (data.shippingAddressId !== undefined && data.shippingAddressId !== null)
            update.shippingAddress = { connect: { id: data.shippingAddressId } };
        if (newStatus === 'Shipped' && !existing.trackingNumber && data.trackingNumber === undefined) {
            update.trackingNumber = `TRK${Date.now().toString().slice(-9)}`;
            update.carrier = data.carrier ?? existing.carrier ?? 'UPS';
        }
        const updated = await tx.order.update({ where: { id: orderId }, data: update, include: exports.orderInclude });
        if (newStatus && newStatus !== existing.orderStatus) {
            await tx.orderStatusHistory.create({ data: { orderId, status: newStatus, note: data.note ?? `Status updated to ${newStatus}` } });
        }
        if (data.paymentStatus && data.paymentStatus !== existing.paymentStatus) {
            await tx.payment.upsert({
                where: { orderId },
                update: {
                    status: data.paymentStatus,
                    paidAt: data.paymentStatus === 'Paid' ? new Date() : null,
                },
                create: {
                    orderId,
                    amount: existing.grandTotal,
                    status: data.paymentStatus,
                    paymentGateway: existing.paymentMethod ?? 'manual',
                    paidAt: data.paymentStatus === 'Paid' ? new Date() : null,
                },
            });
            if (newStatus === undefined) {
                await tx.order.update({ where: { id: orderId }, data: { paymentStatus: data.paymentStatus } });
                updated.paymentStatus = data.paymentStatus;
            }
        }
        if (restoreStock) {
            for (const item of existing.items) {
                if (!item.productId)
                    continue;
                await tx.product.update({ where: { id: item.productId }, data: { stockQuantity: { increment: item.quantity } } });
                await tx.inventoryLog.create({ data: { productId: item.productId, type: 'return', quantity: item.quantity, reference: existing.orderNumber, remarks: `Stock restored — order ${newStatus}` } });
            }
        }
        return updated;
    });
    await (0, audit_1.recordActivity)({ userId: actorId, action: 'order.updated', entity: 'Order', entityId: orderId, details: `Updated order ${order.orderNumber}`, ip });
    if (newStatus && newStatus !== existing.orderStatus) {
        await (0, audit_1.notify)({
            userId: existing.userId,
            title: `Order ${newStatus.toLowerCase()}`,
            message: `Your order ${order.orderNumber} is now ${newStatus}.${order.trackingNumber ? ` Tracking: ${order.trackingNumber}.` : ''}`,
            type: 'order', link: `/orders/${orderId}`,
        });
    }
    return order;
}
async function orderStats() {
    const today = (0, http_1.startOfDay)();
    const yesterday = (0, http_1.addDays)(today, -1);
    const [totalOrders, open, paid, delivered, cancelled, todayCount, yesterdayCount, paidAgg, avgAgg, customers] = await Promise.all([
        prisma_1.prisma.order.count(),
        prisma_1.prisma.order.count({ where: { orderStatus: { in: ['Pending', 'Processing', 'Shipped'] } } }),
        prisma_1.prisma.order.count({ where: { paymentStatus: 'Paid' } }),
        prisma_1.prisma.order.count({ where: { orderStatus: 'Delivered' } }),
        prisma_1.prisma.order.count({ where: { orderStatus: 'Cancelled' } }),
        prisma_1.prisma.order.count({ where: { createdAt: { gte: today } } }),
        prisma_1.prisma.order.count({ where: { createdAt: { gte: yesterday, lt: today } } }),
        prisma_1.prisma.payment.aggregate({ where: { status: 'Paid' }, _sum: { amount: true } }),
        prisma_1.prisma.order.aggregate({ where: { orderStatus: { notIn: ['Cancelled', 'Returned'] } }, _avg: { grandTotal: true } }),
        prisma_1.prisma.user.count({ where: { role: 'customer' } }),
    ]);
    const revenue = Number(paidAgg._sum.amount ?? 0);
    return {
        totalOrders, openOrders: open, paidOrders: paid, deliveredOrders: delivered, cancelledOrders: cancelled,
        todayOrders: todayCount, yesterdayOrders: yesterdayCount,
        totalRevenue: (0, http_1.money)(revenue), averageOrderValue: (0, http_1.money)(Number(avgAgg._avg.grandTotal ?? 0)),
        totalCustomers: customers,
    };
}
