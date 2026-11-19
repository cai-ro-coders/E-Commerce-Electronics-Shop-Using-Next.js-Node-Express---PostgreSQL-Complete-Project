"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reviewQuery = exports.reviewUpdateSchema = exports.reviewSchema = exports.brandSchema = exports.categorySchema = exports.productQuery = exports.productUpdateSchema = exports.productSchema = exports.specificationSchema = exports.productImageSchema = void 0;
const zod_1 = require("zod");
const common_1 = require("./common");
exports.productImageSchema = zod_1.z.object({
    image: zod_1.z.string().trim().min(1).max(2000),
    isPrimary: zod_1.z.boolean().optional().default(false),
    sortOrder: zod_1.z.coerce.number().int().min(0).optional().default(0),
});
exports.specificationSchema = zod_1.z.object({
    attributeName: zod_1.z.string().trim().min(1, 'Attribute name is required').max(120),
    attributeValue: zod_1.z.string().trim().min(1, 'Attribute value is required').max(500),
});
exports.productSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(2, 'Product name is required').max(240),
    slug: zod_1.z.string().trim().max(260).optional(),
    sku: zod_1.z.string().trim().min(2, 'SKU is required').max(80).optional(),
    categoryId: zod_1.z.coerce.number().int().positive('Select a category'),
    brandId: zod_1.z.coerce.number().int().positive('Select a brand'),
    shortDescription: zod_1.z.string().trim().max(1000).optional().nullable(),
    description: zod_1.z.string().trim().max(20000).optional().nullable(),
    price: zod_1.z.coerce.number().min(0, 'Price must be positive').max(10000000),
    salePrice: zod_1.z.union([zod_1.z.coerce.number().min(0).max(10000000), zod_1.z.literal('').transform(() => null), zod_1.z.null()]).optional(),
    costPrice: zod_1.z.union([zod_1.z.coerce.number().min(0).max(10000000), zod_1.z.literal('').transform(() => null), zod_1.z.null()]).optional(),
    weight: zod_1.z.string().trim().max(60).optional().nullable(),
    dimensions: zod_1.z.string().trim().max(120).optional().nullable(),
    stockQuantity: zod_1.z.coerce.number().int().min(0).optional().default(0),
    minimumStock: zod_1.z.coerce.number().int().min(0).optional().default(5),
    featured: common_1.optionalBooleanish,
    status: zod_1.z.enum(['active', 'draft', 'inactive']).optional().default('active'),
    images: zod_1.z.array(exports.productImageSchema).max(12).optional(),
    specifications: zod_1.z.array(exports.specificationSchema).max(40).optional(),
});
exports.productUpdateSchema = exports.productSchema.partial();
exports.productQuery = zod_1.z.object({
    page: zod_1.z.coerce.number().int().min(1).optional().default(1),
    limit: zod_1.z.coerce.number().int().min(1).max(2000).optional().default(12),
    search: zod_1.z.string().trim().max(200).optional().default(''),
    category: zod_1.z.string().trim().max(160).optional(),
    brand: zod_1.z.string().trim().max(160).optional(),
    minPrice: zod_1.z.coerce.number().min(0).optional(),
    maxPrice: zod_1.z.coerce.number().min(0).optional(),
    status: zod_1.z.string().trim().max(30).optional(),
    featured: common_1.optionalBooleanish,
    onSale: common_1.optionalBooleanish,
    lowStock: common_1.optionalBooleanish,
    sort: zod_1.z.enum(['newest', 'oldest', 'price_asc', 'price_desc', 'rating', 'popular', 'name_asc']).optional().default('newest'),
    sortBy: zod_1.z.string().trim().max(60).optional(),
    sortDir: zod_1.z.enum(['asc', 'desc']).optional(),
});
exports.categorySchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(2, 'Category name is required').max(160),
    slug: zod_1.z.string().trim().max(180).optional(),
    parentId: zod_1.z.union([zod_1.z.coerce.number().int().positive(), zod_1.z.literal('').transform(() => null), zod_1.z.null()]).optional(),
    image: zod_1.z.string().trim().max(1000).optional().nullable(),
    description: zod_1.z.string().trim().max(2000).optional().nullable(),
    status: zod_1.z.enum(['active', 'inactive']).optional().default('active'),
});
exports.brandSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(2, 'Brand name is required').max(160),
    slug: zod_1.z.string().trim().max(180).optional(),
    logo: zod_1.z.string().trim().max(1000).optional().nullable(),
    description: zod_1.z.string().trim().max(2000).optional().nullable(),
    status: zod_1.z.enum(['active', 'inactive']).optional().default('active'),
});
exports.reviewSchema = zod_1.z.object({
    productId: zod_1.z.coerce.number().int().positive(),
    rating: zod_1.z.coerce.number().int().min(1).max(5),
    title: zod_1.z.string().trim().max(160).optional().nullable(),
    comment: zod_1.z.string().trim().min(3, 'Please write a few words').max(3000),
});
exports.reviewUpdateSchema = zod_1.z.object({
    rating: zod_1.z.coerce.number().int().min(1).max(5).optional(),
    title: zod_1.z.string().trim().max(160).optional().nullable(),
    comment: zod_1.z.string().trim().max(3000).optional().nullable(),
    status: zod_1.z.enum(['pending', 'approved', 'rejected']).optional(),
});
exports.reviewQuery = zod_1.z.object({
    page: zod_1.z.coerce.number().int().min(1).optional().default(1),
    limit: zod_1.z.coerce.number().int().min(1).max(200).optional().default(10),
    search: zod_1.z.string().trim().max(200).optional().default(''),
    status: zod_1.z.string().trim().max(30).optional(),
    rating: zod_1.z.coerce.number().int().min(1).max(5).optional(),
    productId: zod_1.z.coerce.number().int().positive().optional(),
    sortBy: zod_1.z.string().trim().max(60).optional(),
    sortDir: zod_1.z.enum(['asc', 'desc']).optional().default('desc'),
});
