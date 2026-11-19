import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma';
import { verifyToken } from '../utils/jwt';
import { permissionsForRole } from '../utils/permissions';

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: string;
  status: string;
  avatar?: string | null;
  permissions: string[];
}

export interface AuthRequest extends Request {
  user?: AuthUser;
}

async function resolveUser(token: string): Promise<AuthUser | null> {
  try {
    const payload = verifyToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.id },
      select: { id: true, name: true, email: true, role: true, status: true, avatar: true, permissions: true },
    });
    if (!user) return null;
    return {
      ...user,
      permissions: permissionsForRole(user.role, user.permissions),
    };
  } catch {
    return null;
  }
}

function tokenFrom(req: Request): string | undefined {
  return req.cookies?.token || req.headers.authorization?.replace(/^Bearer\s+/i, '');
}

export async function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const token = tokenFrom(req);
  if (!token) return res.status(401).json({ success: false, message: 'Authentication required' });
  const user = await resolveUser(token);
  if (!user) return res.status(401).json({ success: false, message: 'Invalid or expired session' });
  if (user.status !== 'active') return res.status(403).json({ success: false, message: 'This account has been deactivated' });
  req.user = user;
  next();
}

export async function optionalAuth(req: AuthRequest, _res: Response, next: NextFunction) {
  const token = tokenFrom(req);
  if (token) {
    const user = await resolveUser(token);
    if (user && user.status === 'active') req.user = user;
  }
  next();
}

export function authorize(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ success: false, message: 'Authentication required' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'You do not have permission to perform this action' });
    }
    next();
  };
}

export function requirePermission(permission: string) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ success: false, message: 'Authentication required' });
    if (req.user.role !== 'admin' && !req.user.permissions.includes(permission)) {
      return res.status(403).json({ success: false, message: 'You do not have permission to perform this action' });
    }
    next();
  };
}

export function adminOrStaff(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user || !['admin', 'staff'].includes(req.user.role)) {
    return res.status(req.user ? 403 : 401).json({ success: false, message: 'Admin access required' });
  }
  next();
}
