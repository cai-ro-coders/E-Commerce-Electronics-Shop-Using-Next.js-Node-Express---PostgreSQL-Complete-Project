"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCustomerSchema = exports.createStaffSchema = exports.updateUserSchema = exports.profileSchema = exports.changePasswordSchema = exports.resetSchema = exports.forgotSchema = exports.registerSchema = exports.loginSchema = void 0;
const zod_1 = require("zod");
const common_1 = require("./common");
exports.loginSchema = zod_1.z.object({
    email: common_1.emailSchema,
    password: zod_1.z.string().min(1, 'Password is required'),
    remember: zod_1.z.boolean().optional().default(false),
});
exports.registerSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(2, 'Name is required').max(120),
    email: common_1.emailSchema,
    password: common_1.passwordSchema,
    phone: zod_1.z.string().trim().max(40).optional().nullable(),
});
exports.forgotSchema = zod_1.z.object({ email: common_1.emailSchema });
exports.resetSchema = zod_1.z.object({
    token: zod_1.z.string().min(20, 'Invalid reset token'),
    password: common_1.passwordSchema,
});
exports.changePasswordSchema = zod_1.z.object({
    currentPassword: zod_1.z.string().min(1, 'Current password is required'),
    newPassword: common_1.passwordSchema,
});
exports.profileSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(2, 'Name is required').max(120).optional(),
    phone: zod_1.z.string().trim().max(40).optional().nullable(),
    avatar: zod_1.z.string().trim().max(500).optional().nullable(),
});
exports.updateUserSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(2).max(120).optional(),
    email: common_1.emailSchema.optional(),
    password: common_1.passwordSchema.optional(),
    phone: zod_1.z.string().trim().max(40).optional().nullable(),
    avatar: zod_1.z.string().trim().max(500).optional().nullable(),
    role: zod_1.z.enum(['admin', 'staff', 'customer']).optional(),
    status: zod_1.z.enum(['active', 'inactive', 'suspended']).optional(),
    permissions: zod_1.z.array(zod_1.z.string().max(60)).max(50).optional(),
});
exports.createStaffSchema = exports.updateUserSchema.extend({
    name: zod_1.z.string().trim().min(2, 'Name is required').max(120),
    email: common_1.emailSchema,
    password: common_1.passwordSchema,
    role: zod_1.z.enum(['admin', 'staff']).default('staff'),
});
exports.createCustomerSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(2, 'Name is required').max(120),
    email: common_1.emailSchema,
    password: common_1.passwordSchema.optional().default('password123'),
    phone: zod_1.z.string().trim().max(40).optional().nullable(),
    status: zod_1.z.enum(['active', 'inactive', 'suspended']).optional().default('active'),
    avatar: zod_1.z.string().trim().max(500).optional().nullable(),
});
