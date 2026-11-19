import { Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../config/prisma';
import { comparePassword, hashPassword } from '../utils/password';
import { signToken } from '../utils/jwt';
import { AuthRequest } from '../middleware/auth';
import { loginSchema, registerSchema, forgotSchema, resetSchema, changePasswordSchema, profileSchema } from '../validators/auth';
import { ApiError, ok } from '../utils/http';
import { permissionsForRole } from '../utils/permissions';
import { sanitizeText } from '../utils/sanitize';
import { notify, recordActivity } from '../utils/audit';

function setAuthCookie(res: Response, token: string, remember?: boolean) {
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: remember ? 30 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

function publicUser(user: any) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    phone: user.phone,
    avatar: user.avatar,
    permissions: permissionsForRole(user.role, user.permissions ?? []),
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}

async function logLogin(req: AuthRequest, userId: number, status: 'success' | 'failed') {
  await prisma.loginHistory
    .create({ data: { userId, ip: req.ip, userAgent: String(req.headers['user-agent'] || '').slice(0, 300), status } })
    .catch(() => undefined);
}

export async function register(req: AuthRequest, res: Response) {
  const data = registerSchema.parse(req.body);
  const exists = await prisma.user.findUnique({ where: { email: data.email } });
  if (exists) throw new ApiError(409, 'An account with this email already exists');
  const user = await prisma.user.create({
    data: {
      name: sanitizeText(data.name)!,
      email: data.email,
      phone: data.phone ? sanitizeText(data.phone) : null,
      password: await hashPassword(data.password),
      role: 'customer',
      status: 'active',
    },
  });
  await prisma.cart.create({ data: { userId: user.id } }).catch(() => undefined);
  await logLogin(req, user.id, 'success');
  await notify({ userId: user.id, title: 'Welcome to ElectroShop', message: 'Your account is ready. Explore new arrivals and exclusive member offers.', type: 'system', link: '/products' });
  await notify({ userId: null, title: 'New customer registered', message: `${user.name} (${user.email}) joined the store.`, type: 'customer', link: '/admin/customers' });
  await recordActivity({ userId: user.id, action: 'auth.register', entity: 'User', entityId: user.id, details: 'Created a customer account', ip: req.ip });
  const token = signToken({ id: user.id, role: user.role, email: user.email });
  setAuthCookie(res, token, false);
  return res.status(201).json({ success: true, message: 'Account created successfully', data: { user: publicUser(user), token } });
}

export async function login(req: AuthRequest, res: Response) {
  const data = loginSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: data.email } });
  if (!user || !(await comparePassword(data.password, user.password))) {
    if (user) await logLogin(req, user.id, 'failed');
    throw new ApiError(401, 'Invalid email or password');
  }
  if (user.status !== 'active') throw new ApiError(403, 'This account has been deactivated. Contact support for help.');
  await logLogin(req, user.id, 'success');
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  if (data.remember) {
    await prisma.user.update({ where: { id: user.id }, data: { rememberToken: crypto.randomBytes(24).toString('hex') } });
  }
  const token = signToken({ id: user.id, role: user.role, email: user.email }, data.remember ? '30d' : '7d');
  setAuthCookie(res, token, data.remember);
  await recordActivity({ userId: user.id, action: 'auth.login', entity: 'Session', details: 'Signed in', ip: req.ip });
  return ok(res, { user: publicUser(user), token }, undefined, 'Welcome back');
}

export async function me(req: AuthRequest, res: Response) {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: {
      id: true, name: true, email: true, role: true, phone: true, avatar: true,
      status: true, permissions: true, lastLoginAt: true, createdAt: true,
    },
  });
  if (!user) throw new ApiError(404, 'User not found');
  return ok(res, publicUser(user));
}

export async function logout(req: AuthRequest, res: Response) {
  if (req.user) {
    await prisma.user.update({ where: { id: req.user.id }, data: { rememberToken: null } }).catch(() => undefined);
    await recordActivity({ userId: req.user.id, action: 'auth.logout', entity: 'Session', details: 'Signed out', ip: req.ip });
  }
  res.clearCookie('token', { path: '/' });
  return ok(res, null, undefined, 'Signed out successfully');
}

export async function forgotPassword(req: AuthRequest, res: Response) {
  const { email } = forgotSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email } });
  let resetToken: string | undefined;
  if (user) {
    resetToken = crypto.randomBytes(32).toString('hex');
    await prisma.passwordResetToken.create({
      data: { token: resetToken, userId: user.id, expiresAt: new Date(Date.now() + 30 * 60 * 1000) },
    });
    await notify({ userId: user.id, title: 'Password reset requested', message: 'A password reset link was generated for your account. It expires in 30 minutes.', type: 'system' });
  }
  return ok(
    res,
    resetToken && process.env.NODE_ENV !== 'production' ? { resetToken } : null,
    undefined,
    'If an account exists for this email, password reset instructions have been generated.',
  );
}

export async function resetPassword(req: AuthRequest, res: Response) {
  const { token, password } = resetSchema.parse(req.body);
  const entry = await prisma.passwordResetToken.findUnique({ where: { token } });
  if (!entry || entry.used || entry.expiresAt.getTime() < Date.now()) {
    throw new ApiError(400, 'This reset link is invalid or has expired');
  }
  await prisma.$transaction([
    prisma.user.update({ where: { id: entry.userId }, data: { password: await hashPassword(password), rememberToken: null } }),
    prisma.passwordResetToken.update({ where: { id: entry.id }, data: { used: true } }),
  ]);
  await recordActivity({ userId: entry.userId, action: 'auth.password_reset', entity: 'User', entityId: entry.userId, details: 'Reset password via email token', ip: req.ip });
  return ok(res, null, undefined, 'Password reset successfully. You can now sign in.');
}

export async function changePassword(req: AuthRequest, res: Response) {
  const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user || !(await comparePassword(currentPassword, user.password))) {
    throw new ApiError(400, 'Your current password is incorrect');
  }
  if (await bcrypt.compare(newPassword, user.password)) throw new ApiError(400, 'Choose a password different from your current one');
  await prisma.user.update({ where: { id: user.id }, data: { password: await hashPassword(newPassword) } });
  await notify({ userId: user.id, title: 'Password changed', message: 'Your account password was updated successfully.', type: 'system' });
  await recordActivity({ userId: user.id, action: 'auth.password_changed', entity: 'User', entityId: user.id, details: 'Changed account password', ip: req.ip });
  return ok(res, null, undefined, 'Password changed successfully');
}

export async function updateProfile(req: AuthRequest, res: Response) {
  const data = profileSchema.parse(req.body);
  const user = await prisma.user.update({
    where: { id: req.user!.id },
    data: {
      ...(data.name !== undefined ? { name: sanitizeText(data.name)! } : {}),
      ...(data.phone !== undefined ? { phone: data.phone ? sanitizeText(data.phone) : null } : {}),
      ...(data.avatar !== undefined ? { avatar: data.avatar } : {}),
    },
    select: { id: true, name: true, email: true, role: true, phone: true, avatar: true, status: true, permissions: true, createdAt: true },
  });
  await recordActivity({ userId: user.id, action: 'profile.updated', entity: 'User', entityId: user.id, details: 'Updated profile information', ip: req.ip });
  return ok(res, publicUser(user), undefined, 'Profile updated');
}

export async function loginHistory(req: AuthRequest, res: Response) {
  const userId = req.user!.role === 'admin' && req.query.userId ? Number(req.query.userId) : req.user!.id;
  const items = await prisma.loginHistory.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 });
  return ok(res, items);
}
