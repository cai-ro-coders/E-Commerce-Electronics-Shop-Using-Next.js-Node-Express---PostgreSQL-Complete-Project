import { z } from 'zod';

export const idParam = z.object({ id: z.coerce.number().int().positive() });

export const booleanish = z.preprocess((v) => {
  if (typeof v === 'string') return ['true', '1', 'yes', 'on'].includes(v.toLowerCase());
  return v;
}, z.boolean());

export const optionalBooleanish = z.preprocess((v) => {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'string') return ['true', '1', 'yes', 'on'].includes(v.toLowerCase());
  return v;
}, z.boolean().optional());

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(2000).optional().default(10),
  search: z.string().trim().max(200).optional().default(''),
  sortBy: z.string().trim().max(60).optional(),
  sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
});

export const nullableString = z.union([z.string().trim().max(5000), z.null()]).optional();
export const optionalText = z.union([z.string().trim().max(20000), z.null()]).optional();

export const statusSchema = z.enum(['active', 'inactive']);
export const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address').max(160);
export const passwordSchema = z.string().min(8, 'Password must be at least 8 characters').max(100);
