"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticate = authenticate;
exports.optionalAuth = optionalAuth;
exports.authorize = authorize;
exports.requirePermission = requirePermission;
exports.adminOrStaff = adminOrStaff;
const prisma_1 = require("../config/prisma");
const jwt_1 = require("../utils/jwt");
const permissions_1 = require("../utils/permissions");
async function resolveUser(token) {
    try {
        const payload = (0, jwt_1.verifyToken)(token);
        const user = await prisma_1.prisma.user.findUnique({
            where: { id: payload.id },
            select: { id: true, name: true, email: true, role: true, status: true, avatar: true, permissions: true },
        });
        if (!user)
            return null;
        return {
            ...user,
            permissions: (0, permissions_1.permissionsForRole)(user.role, user.permissions),
        };
    }
    catch {
        return null;
    }
}
function tokenFrom(req) {
    return req.cookies?.token || req.headers.authorization?.replace(/^Bearer\s+/i, '');
}
async function authenticate(req, res, next) {
    const token = tokenFrom(req);
    if (!token)
        return res.status(401).json({ success: false, message: 'Authentication required' });
    const user = await resolveUser(token);
    if (!user)
        return res.status(401).json({ success: false, message: 'Invalid or expired session' });
    if (user.status !== 'active')
        return res.status(403).json({ success: false, message: 'This account has been deactivated' });
    req.user = user;
    next();
}
async function optionalAuth(req, _res, next) {
    const token = tokenFrom(req);
    if (token) {
        const user = await resolveUser(token);
        if (user && user.status === 'active')
            req.user = user;
    }
    next();
}
function authorize(...roles) {
    return (req, res, next) => {
        if (!req.user)
            return res.status(401).json({ success: false, message: 'Authentication required' });
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'You do not have permission to perform this action' });
        }
        next();
    };
}
function requirePermission(permission) {
    return (req, res, next) => {
        if (!req.user)
            return res.status(401).json({ success: false, message: 'Authentication required' });
        if (req.user.role !== 'admin' && !req.user.permissions.includes(permission)) {
            return res.status(403).json({ success: false, message: 'You do not have permission to perform this action' });
        }
        next();
    };
}
function adminOrStaff(req, res, next) {
    if (!req.user || !['admin', 'staff'].includes(req.user.role)) {
        return res.status(req.user ? 403 : 401).json({ success: false, message: 'Admin access required' });
    }
    next();
}
