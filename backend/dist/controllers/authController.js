"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.register = register;
exports.login = login;
exports.me = me;
exports.logout = logout;
exports.forgotPassword = forgotPassword;
exports.resetPassword = resetPassword;
exports.changePassword = changePassword;
exports.updateProfile = updateProfile;
exports.loginHistory = loginHistory;
const crypto_1 = __importDefault(require("crypto"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const prisma_1 = require("../config/prisma");
const password_1 = require("../utils/password");
const jwt_1 = require("../utils/jwt");
const auth_1 = require("../validators/auth");
const http_1 = require("../utils/http");
const permissions_1 = require("../utils/permissions");
const sanitize_1 = require("../utils/sanitize");
const audit_1 = require("../utils/audit");
function setAuthCookie(res, token, remember) {
    res.cookie('token', token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: remember ? 30 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000,
        path: '/',
    });
}
function publicUser(user) {
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        phone: user.phone,
        avatar: user.avatar,
        permissions: (0, permissions_1.permissionsForRole)(user.role, user.permissions ?? []),
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt,
    };
}
async function logLogin(req, userId, status) {
    await prisma_1.prisma.loginHistory
        .create({ data: { userId, ip: req.ip, userAgent: String(req.headers['user-agent'] || '').slice(0, 300), status } })
        .catch(() => undefined);
}
async function register(req, res) {
    const data = auth_1.registerSchema.parse(req.body);
    const exists = await prisma_1.prisma.user.findUnique({ where: { email: data.email } });
    if (exists)
        throw new http_1.ApiError(409, 'An account with this email already exists');
    const user = await prisma_1.prisma.user.create({
        data: {
            name: (0, sanitize_1.sanitizeText)(data.name),
            email: data.email,
            phone: data.phone ? (0, sanitize_1.sanitizeText)(data.phone) : null,
            password: await (0, password_1.hashPassword)(data.password),
            role: 'customer',
            status: 'active',
        },
    });
    await prisma_1.prisma.cart.create({ data: { userId: user.id } }).catch(() => undefined);
    await logLogin(req, user.id, 'success');
    await (0, audit_1.notify)({ userId: user.id, title: 'Welcome to ElectroShop', message: 'Your account is ready. Explore new arrivals and exclusive member offers.', type: 'system', link: '/products' });
    await (0, audit_1.notify)({ userId: null, title: 'New customer registered', message: `${user.name} (${user.email}) joined the store.`, type: 'customer', link: '/admin/customers' });
    await (0, audit_1.recordActivity)({ userId: user.id, action: 'auth.register', entity: 'User', entityId: user.id, details: 'Created a customer account', ip: req.ip });
    const token = (0, jwt_1.signToken)({ id: user.id, role: user.role, email: user.email });
    setAuthCookie(res, token, false);
    return res.status(201).json({ success: true, message: 'Account created successfully', data: { user: publicUser(user), token } });
}
async function login(req, res) {
    const data = auth_1.loginSchema.parse(req.body);
    const user = await prisma_1.prisma.user.findUnique({ where: { email: data.email } });
    if (!user || !(await (0, password_1.comparePassword)(data.password, user.password))) {
        if (user)
            await logLogin(req, user.id, 'failed');
        throw new http_1.ApiError(401, 'Invalid email or password');
    }
    if (user.status !== 'active')
        throw new http_1.ApiError(403, 'This account has been deactivated. Contact support for help.');
    await logLogin(req, user.id, 'success');
    await prisma_1.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    if (data.remember) {
        await prisma_1.prisma.user.update({ where: { id: user.id }, data: { rememberToken: crypto_1.default.randomBytes(24).toString('hex') } });
    }
    const token = (0, jwt_1.signToken)({ id: user.id, role: user.role, email: user.email }, data.remember ? '30d' : '7d');
    setAuthCookie(res, token, data.remember);
    await (0, audit_1.recordActivity)({ userId: user.id, action: 'auth.login', entity: 'Session', details: 'Signed in', ip: req.ip });
    return (0, http_1.ok)(res, { user: publicUser(user), token }, undefined, 'Welcome back');
}
async function me(req, res) {
    const user = await prisma_1.prisma.user.findUnique({
        where: { id: req.user.id },
        select: {
            id: true, name: true, email: true, role: true, phone: true, avatar: true,
            status: true, permissions: true, lastLoginAt: true, createdAt: true,
        },
    });
    if (!user)
        throw new http_1.ApiError(404, 'User not found');
    return (0, http_1.ok)(res, publicUser(user));
}
async function logout(req, res) {
    if (req.user) {
        await prisma_1.prisma.user.update({ where: { id: req.user.id }, data: { rememberToken: null } }).catch(() => undefined);
        await (0, audit_1.recordActivity)({ userId: req.user.id, action: 'auth.logout', entity: 'Session', details: 'Signed out', ip: req.ip });
    }
    res.clearCookie('token', { path: '/' });
    return (0, http_1.ok)(res, null, undefined, 'Signed out successfully');
}
async function forgotPassword(req, res) {
    const { email } = auth_1.forgotSchema.parse(req.body);
    const user = await prisma_1.prisma.user.findUnique({ where: { email } });
    let resetToken;
    if (user) {
        resetToken = crypto_1.default.randomBytes(32).toString('hex');
        await prisma_1.prisma.passwordResetToken.create({
            data: { token: resetToken, userId: user.id, expiresAt: new Date(Date.now() + 30 * 60 * 1000) },
        });
        await (0, audit_1.notify)({ userId: user.id, title: 'Password reset requested', message: 'A password reset link was generated for your account. It expires in 30 minutes.', type: 'system' });
    }
    return (0, http_1.ok)(res, resetToken && process.env.NODE_ENV !== 'production' ? { resetToken } : null, undefined, 'If an account exists for this email, password reset instructions have been generated.');
}
async function resetPassword(req, res) {
    const { token, password } = auth_1.resetSchema.parse(req.body);
    const entry = await prisma_1.prisma.passwordResetToken.findUnique({ where: { token } });
    if (!entry || entry.used || entry.expiresAt.getTime() < Date.now()) {
        throw new http_1.ApiError(400, 'This reset link is invalid or has expired');
    }
    await prisma_1.prisma.$transaction([
        prisma_1.prisma.user.update({ where: { id: entry.userId }, data: { password: await (0, password_1.hashPassword)(password), rememberToken: null } }),
        prisma_1.prisma.passwordResetToken.update({ where: { id: entry.id }, data: { used: true } }),
    ]);
    await (0, audit_1.recordActivity)({ userId: entry.userId, action: 'auth.password_reset', entity: 'User', entityId: entry.userId, details: 'Reset password via email token', ip: req.ip });
    return (0, http_1.ok)(res, null, undefined, 'Password reset successfully. You can now sign in.');
}
async function changePassword(req, res) {
    const { currentPassword, newPassword } = auth_1.changePasswordSchema.parse(req.body);
    const user = await prisma_1.prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user || !(await (0, password_1.comparePassword)(currentPassword, user.password))) {
        throw new http_1.ApiError(400, 'Your current password is incorrect');
    }
    if (await bcryptjs_1.default.compare(newPassword, user.password))
        throw new http_1.ApiError(400, 'Choose a password different from your current one');
    await prisma_1.prisma.user.update({ where: { id: user.id }, data: { password: await (0, password_1.hashPassword)(newPassword) } });
    await (0, audit_1.notify)({ userId: user.id, title: 'Password changed', message: 'Your account password was updated successfully.', type: 'system' });
    await (0, audit_1.recordActivity)({ userId: user.id, action: 'auth.password_changed', entity: 'User', entityId: user.id, details: 'Changed account password', ip: req.ip });
    return (0, http_1.ok)(res, null, undefined, 'Password changed successfully');
}
async function updateProfile(req, res) {
    const data = auth_1.profileSchema.parse(req.body);
    const user = await prisma_1.prisma.user.update({
        where: { id: req.user.id },
        data: {
            ...(data.name !== undefined ? { name: (0, sanitize_1.sanitizeText)(data.name) } : {}),
            ...(data.phone !== undefined ? { phone: data.phone ? (0, sanitize_1.sanitizeText)(data.phone) : null } : {}),
            ...(data.avatar !== undefined ? { avatar: data.avatar } : {}),
        },
        select: { id: true, name: true, email: true, role: true, phone: true, avatar: true, status: true, permissions: true, createdAt: true },
    });
    await (0, audit_1.recordActivity)({ userId: user.id, action: 'profile.updated', entity: 'User', entityId: user.id, details: 'Updated profile information', ip: req.ip });
    return (0, http_1.ok)(res, publicUser(user), undefined, 'Profile updated');
}
async function loginHistory(req, res) {
    const userId = req.user.role === 'admin' && req.query.userId ? Number(req.query.userId) : req.user.id;
    const items = await prisma_1.prisma.loginHistory.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 });
    return (0, http_1.ok)(res, items);
}
