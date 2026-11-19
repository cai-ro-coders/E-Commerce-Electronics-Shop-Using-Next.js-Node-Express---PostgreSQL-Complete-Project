import { z } from 'zod';
import { emailSchema, passwordSchema } from './common';

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
  remember: z.boolean().optional().default(false),
});

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(120),
  email: emailSchema,
  password: passwordSchema,
  phone: z.string().trim().max(40).optional().nullable(),
});

export const forgotSchema = z.object({ email: emailSchema });

export const resetSchema = z.object({
  token: z.string().min(20, 'Invalid reset token'),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: passwordSchema,
});

export const profileSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(120).optional(),
  phone: z.string().trim().max(40).optional().nullable(),
  avatar: z.string().trim().max(500).optional().nullable(),
});

export const updateUserSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  email: emailSchema.optional(),
  password: passwordSchema.optional(),
  phone: z.string().trim().max(40).optional().nullable(),
  avatar: z.string().trim().max(500).optional().nullable(),
  role: z.enum(['admin', 'staff', 'customer']).optional(),
  status: z.enum(['active', 'inactive', 'suspended']).optional(),
  permissions: z.array(z.string().max(60)).max(50).optional(),
});

export const createStaffSchema = updateUserSchema.extend({
  name: z.string().trim().min(2, 'Name is required').max(120),
  email: emailSchema,
  password: passwordSchema,
  role: z.enum(['admin', 'staff']).default('staff'),
});

export const createCustomerSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(120),
  email: emailSchema,
  password: passwordSchema.optional().default('password123'),
  phone: z.string().trim().max(40).optional().nullable(),
  status: z.enum(['active', 'inactive', 'suspended']).optional().default('active'),
  avatar: z.string().trim().max(500).optional().nullable(),
});
