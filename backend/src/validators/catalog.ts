import { z } from 'zod';
import { booleanish, optionalBooleanish } from './common';

export const productImageSchema = z.object({
  image: z.string().trim().min(1).max(2000),
  isPrimary: z.boolean().optional().default(false),
  sortOrder: z.coerce.number().int().min(0).optional().default(0),
});

export const specificationSchema = z.object({
  attributeName: z.string().trim().min(1, 'Attribute name is required').max(120),
  attributeValue: z.string().trim().min(1, 'Attribute value is required').max(500),
});

export const productSchema = z.object({
  name: z.string().trim().min(2, 'Product name is required').max(240),
  slug: z.string().trim().max(260).optional(),
  sku: z.string().trim().min(2, 'SKU is required').max(80).optional(),
  categoryId: z.coerce.number().int().positive('Select a category'),
  brandId: z.coerce.number().int().positive('Select a brand'),
  shortDescription: z.string().trim().max(1000).optional().nullable(),
  description: z.string().trim().max(20000).optional().nullable(),
  price: z.coerce.number().min(0, 'Price must be positive').max(10000000),
  salePrice: z.union([z.coerce.number().min(0).max(10000000), z.literal('').transform(() => null), z.null()]).optional(),
  costPrice: z.union([z.coerce.number().min(0).max(10000000), z.literal('').transform(() => null), z.null()]).optional(),
  weight: z.string().trim().max(60).optional().nullable(),
  dimensions: z.string().trim().max(120).optional().nullable(),
  stockQuantity: z.coerce.number().int().min(0).optional().default(0),
  minimumStock: z.coerce.number().int().min(0).optional().default(5),
  featured: optionalBooleanish,
  status: z.enum(['active', 'draft', 'inactive']).optional().default('active'),
  images: z.array(productImageSchema).max(12).optional(),
  specifications: z.array(specificationSchema).max(40).optional(),
});

export const productUpdateSchema = productSchema.partial();

export const productQuery = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(2000).optional().default(12),
  search: z.string().trim().max(200).optional().default(''),
  category: z.string().trim().max(160).optional(),
  brand: z.string().trim().max(160).optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  status: z.string().trim().max(30).optional(),
  featured: optionalBooleanish,
  onSale: optionalBooleanish,
  lowStock: optionalBooleanish,
  sort: z.enum(['newest', 'oldest', 'price_asc', 'price_desc', 'rating', 'popular', 'name_asc']).optional().default('newest'),
  sortBy: z.string().trim().max(60).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
});

export const categorySchema = z.object({
  name: z.string().trim().min(2, 'Category name is required').max(160),
  slug: z.string().trim().max(180).optional(),
  parentId: z.union([z.coerce.number().int().positive(), z.literal('').transform(() => null), z.null()]).optional(),
  image: z.string().trim().max(1000).optional().nullable(),
  description: z.string().trim().max(2000).optional().nullable(),
  status: z.enum(['active', 'inactive']).optional().default('active'),
});

export const brandSchema = z.object({
  name: z.string().trim().min(2, 'Brand name is required').max(160),
  slug: z.string().trim().max(180).optional(),
  logo: z.string().trim().max(1000).optional().nullable(),
  description: z.string().trim().max(2000).optional().nullable(),
  status: z.enum(['active', 'inactive']).optional().default('active'),
});

export const reviewSchema = z.object({
  productId: z.coerce.number().int().positive(),
  rating: z.coerce.number().int().min(1).max(5),
  title: z.string().trim().max(160).optional().nullable(),
  comment: z.string().trim().min(3, 'Please write a few words').max(3000),
});

export const reviewUpdateSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5).optional(),
  title: z.string().trim().max(160).optional().nullable(),
  comment: z.string().trim().max(3000).optional().nullable(),
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
});

export const reviewQuery = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(200).optional().default(10),
  search: z.string().trim().max(200).optional().default(''),
  status: z.string().trim().max(30).optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  productId: z.coerce.number().int().positive().optional(),
  sortBy: z.string().trim().max(60).optional(),
  sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
});
