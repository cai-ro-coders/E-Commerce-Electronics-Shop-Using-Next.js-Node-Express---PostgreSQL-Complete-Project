"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificationSchema = exports.contactSchema = exports.inventoryEventSchema = exports.inventoryAdjustSchema = exports.paymentUpdateSchema = exports.orderQuery = exports.orderUpdateSchema = exports.checkoutSchema = exports.couponValidateSchema = exports.couponSchema = exports.wishlistSchema = exports.cartUpdateSchema = exports.cartItemSchema = exports.addressSchema = void 0;
const zod_1 = require("zod");
exports.addressSchema = zod_1.z.object({
    fullName: zod_1.z.string().trim().min(2, 'Full name is required').max(160),
    phone: zod_1.z.string().trim().min(5, 'Phone is required').max(40),
    addressLine1: zod_1.z.string().trim().min(3, 'Address is required').max(240),
    addressLine2: zod_1.z.string().trim().max(240).optional().nullable(),
    city: zod_1.z.string().trim().min(2, 'City is required').max(120),
    province: zod_1.z.string().trim().min(1, 'State is required').max(120),
    postalCode: zod_1.z.string().trim().min(2, 'Postal code is required').max(30),
    country: zod_1.z.string().trim().min(2, 'Country is required').max(120),
    isDefault: zod_1.z.boolean().optional().default(false),
});
exports.cartItemSchema = zod_1.z.object({
    productId: zod_1.z.coerce.number().int().positive(),
    quantity: zod_1.z.coerce.number().int().min(1).max(99).optional().default(1),
});
exports.cartUpdateSchema = zod_1.z.object({
    quantity: zod_1.z.coerce.number().int().min(1, 'Quantity must be at least 1').max(99),
});
exports.wishlistSchema = zod_1.z.object({ productId: zod_1.z.coerce.number().int().positive() });
exports.couponSchema = zod_1.z.object({
    code: zod_1.z.string().trim().min(3, 'Coupon code is required').max(40).transform((v) => v.toUpperCase()),
    description: zod_1.z.string().trim().max(500).optional().nullable(),
    type: zod_1.z.enum(['percentage', 'fixed']),
    value: zod_1.z.coerce.number().min(0.01, 'Value is required').max(100000),
    minimumOrder: zod_1.z.union([zod_1.z.coerce.number().min(0), zod_1.z.literal('').transform(() => null), zod_1.z.null()]).optional(),
    maximumDiscount: zod_1.z.union([zod_1.z.coerce.number().min(0), zod_1.z.literal('').transform(() => null), zod_1.z.null()]).optional(),
    usageLimit: zod_1.z.union([zod_1.z.coerce.number().int().min(0), zod_1.z.literal('').transform(() => null), zod_1.z.null()]).optional(),
    startDate: zod_1.z.string().trim().optional().nullable(),
    endDate: zod_1.z.string().trim().optional().nullable(),
    status: zod_1.z.enum(['active', 'inactive']).optional().default('active'),
});
exports.couponValidateSchema = zod_1.z.object({
    code: zod_1.z.string().trim().min(1).max(40).transform((v) => v.toUpperCase()),
    subtotal: zod_1.z.coerce.number().min(0),
});
exports.checkoutSchema = zod_1.z.object({
    items: zod_1.z.array(zod_1.z.object({ productId: zod_1.z.coerce.number().int().positive(), quantity: zod_1.z.coerce.number().int().min(1).max(99) })).min(1, 'Your cart is empty'),
    addressId: zod_1.z.coerce.number().int().positive().optional(),
    address: exports.addressSchema.optional(),
    paymentMethod: zod_1.z.enum(['stripe', 'paypal', 'cod']).default('stripe'),
    couponCode: zod_1.z.string().trim().max(40).optional().nullable(),
    notes: zod_1.z.string().trim().max(1000).optional().nullable(),
    cardLast4: zod_1.z.string().trim().max(4).optional().nullable(),
}).refine((data) => data.addressId || data.address, { message: 'A shipping address is required', path: ['address'] });
exports.orderUpdateSchema = zod_1.z.object({
    orderStatus: zod_1.z.enum(['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled', 'Returned']).optional(),
    paymentStatus: zod_1.z.enum(['Pending', 'Paid', 'Failed', 'Refunded']).optional(),
    trackingNumber: zod_1.z.string().trim().max(120).optional().nullable(),
    carrier: zod_1.z.string().trim().max(120).optional().nullable(),
    estimatedDelivery: zod_1.z.string().trim().optional().nullable(),
    notes: zod_1.z.string().trim().max(2000).optional().nullable(),
    shippingAddressId: zod_1.z.coerce.number().int().positive().optional().nullable(),
    note: zod_1.z.string().trim().max(500).optional(),
});
exports.orderQuery = zod_1.z.object({
    page: zod_1.z.coerce.number().int().min(1).optional().default(1),
    limit: zod_1.z.coerce.number().int().min(1).max(2000).optional().default(10),
    search: zod_1.z.string().trim().max(200).optional().default(''),
    status: zod_1.z.string().trim().max(30).optional(),
    paymentStatus: zod_1.z.string().trim().max(30).optional(),
    from: zod_1.z.string().trim().optional(),
    to: zod_1.z.string().trim().optional(),
    sortBy: zod_1.z.string().trim().max(60).optional(),
    sortDir: zod_1.z.enum(['asc', 'desc']).optional().default('desc'),
});
exports.paymentUpdateSchema = zod_1.z.object({
    status: zod_1.z.enum(['Pending', 'Paid', 'Failed', 'Refunded']),
    transactionId: zod_1.z.string().trim().max(160).optional().nullable(),
});
exports.inventoryAdjustSchema = zod_1.z.object({
    productId: zod_1.z.coerce.number().int().positive(),
    type: zod_1.z.enum(['stock_in', 'stock_out', 'adjustment', 'return']),
    quantity: zod_1.z.coerce.number().int().refine((v) => v !== 0, 'Quantity cannot be zero'),
    reference: zod_1.z.string().trim().max(120).optional().nullable(),
    remarks: zod_1.z.string().trim().max(500).optional().nullable(),
});
exports.inventoryEventSchema = zod_1.z.object({
    title: zod_1.z.string().trim().min(2).max(200),
    start: zod_1.z.string().trim().min(4),
    end: zod_1.z.string().trim().optional().nullable(),
    type: zod_1.z.enum(['restock', 'stocktake', 'supplier', 'promotion', 'audit']).optional().default('restock'),
    productId: zod_1.z.union([zod_1.z.coerce.number().int().positive(), zod_1.z.literal('').transform(() => null), zod_1.z.null()]).optional(),
    notes: zod_1.z.string().trim().max(1000).optional().nullable(),
});
exports.contactSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(2).max(120),
    email: zod_1.z.string().trim().toLowerCase().email(),
    subject: zod_1.z.string().trim().min(3).max(200),
    message: zod_1.z.string().trim().min(10).max(3000),
});
exports.notificationSchema = zod_1.z.object({
    title: zod_1.z.string().trim().min(2).max(200),
    message: zod_1.z.string().trim().min(2).max(1000),
    type: zod_1.z.enum(['order', 'stock', 'review', 'payment', 'system', 'customer']).optional().default('system'),
    userId: zod_1.z.union([zod_1.z.coerce.number().int().positive(), zod_1.z.literal('').transform(() => null), zod_1.z.null()]).optional(),
    link: zod_1.z.string().trim().max(300).optional().nullable(),
});
