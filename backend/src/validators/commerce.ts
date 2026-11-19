import { z } from 'zod';
import { booleanish } from './common';

export const addressSchema = z.object({
  fullName: z.string().trim().min(2, 'Full name is required').max(160),
  phone: z.string().trim().min(5, 'Phone is required').max(40),
  addressLine1: z.string().trim().min(3, 'Address is required').max(240),
  addressLine2: z.string().trim().max(240).optional().nullable(),
  city: z.string().trim().min(2, 'City is required').max(120),
  province: z.string().trim().min(1, 'State is required').max(120),
  postalCode: z.string().trim().min(2, 'Postal code is required').max(30),
  country: z.string().trim().min(2, 'Country is required').max(120),
  isDefault: z.boolean().optional().default(false),
});

export const cartItemSchema = z.object({
  productId: z.coerce.number().int().positive(),
  quantity: z.coerce.number().int().min(1).max(99).optional().default(1),
});

export const cartUpdateSchema = z.object({
  quantity: z.coerce.number().int().min(1, 'Quantity must be at least 1').max(99),
});

export const wishlistSchema = z.object({ productId: z.coerce.number().int().positive() });

export const couponSchema = z.object({
  code: z.string().trim().min(3, 'Coupon code is required').max(40).transform((v) => v.toUpperCase()),
  description: z.string().trim().max(500).optional().nullable(),
  type: z.enum(['percentage', 'fixed']),
  value: z.coerce.number().min(0.01, 'Value is required').max(100000),
  minimumOrder: z.union([z.coerce.number().min(0), z.literal('').transform(() => null), z.null()]).optional(),
  maximumDiscount: z.union([z.coerce.number().min(0), z.literal('').transform(() => null), z.null()]).optional(),
  usageLimit: z.union([z.coerce.number().int().min(0), z.literal('').transform(() => null), z.null()]).optional(),
  startDate: z.string().trim().optional().nullable(),
  endDate: z.string().trim().optional().nullable(),
  status: z.enum(['active', 'inactive']).optional().default('active'),
});

export const couponValidateSchema = z.object({
  code: z.string().trim().min(1).max(40).transform((v) => v.toUpperCase()),
  subtotal: z.coerce.number().min(0),
});

export const checkoutSchema = z.object({
  items: z.array(z.object({ productId: z.coerce.number().int().positive(), quantity: z.coerce.number().int().min(1).max(99) })).min(1, 'Your cart is empty'),
  addressId: z.coerce.number().int().positive().optional(),
  address: addressSchema.optional(),
  paymentMethod: z.enum(['stripe', 'paypal', 'cod']).default('stripe'),
  couponCode: z.string().trim().max(40).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  cardLast4: z.string().trim().max(4).optional().nullable(),
}).refine((data) => data.addressId || data.address, { message: 'A shipping address is required', path: ['address'] });

export const orderUpdateSchema = z.object({
  orderStatus: z.enum(['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled', 'Returned']).optional(),
  paymentStatus: z.enum(['Pending', 'Paid', 'Failed', 'Refunded']).optional(),
  trackingNumber: z.string().trim().max(120).optional().nullable(),
  carrier: z.string().trim().max(120).optional().nullable(),
  estimatedDelivery: z.string().trim().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  shippingAddressId: z.coerce.number().int().positive().optional().nullable(),
  note: z.string().trim().max(500).optional(),
});

export const orderQuery = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(2000).optional().default(10),
  search: z.string().trim().max(200).optional().default(''),
  status: z.string().trim().max(30).optional(),
  paymentStatus: z.string().trim().max(30).optional(),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
  sortBy: z.string().trim().max(60).optional(),
  sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
});

export const paymentUpdateSchema = z.object({
  status: z.enum(['Pending', 'Paid', 'Failed', 'Refunded']),
  transactionId: z.string().trim().max(160).optional().nullable(),
});

export const inventoryAdjustSchema = z.object({
  productId: z.coerce.number().int().positive(),
  type: z.enum(['stock_in', 'stock_out', 'adjustment', 'return']),
  quantity: z.coerce.number().int().refine((v) => v !== 0, 'Quantity cannot be zero'),
  reference: z.string().trim().max(120).optional().nullable(),
  remarks: z.string().trim().max(500).optional().nullable(),
});

export const inventoryEventSchema = z.object({
  title: z.string().trim().min(2).max(200),
  start: z.string().trim().min(4),
  end: z.string().trim().optional().nullable(),
  type: z.enum(['restock', 'stocktake', 'supplier', 'promotion', 'audit']).optional().default('restock'),
  productId: z.union([z.coerce.number().int().positive(), z.literal('').transform(() => null), z.null()]).optional(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export const contactSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  subject: z.string().trim().min(3).max(200),
  message: z.string().trim().min(10).max(3000),
});

export const notificationSchema = z.object({
  title: z.string().trim().min(2).max(200),
  message: z.string().trim().min(2).max(1000),
  type: z.enum(['order', 'stock', 'review', 'payment', 'system', 'customer']).optional().default('system'),
  userId: z.union([z.coerce.number().int().positive(), z.literal('').transform(() => null), z.null()]).optional(),
  link: z.string().trim().max(300).optional().nullable(),
});
