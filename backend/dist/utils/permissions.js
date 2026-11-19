"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROLE_PERMISSIONS = exports.PERMISSION_CATALOG = void 0;
exports.permissionsForRole = permissionsForRole;
exports.hasPermission = hasPermission;
exports.PERMISSION_CATALOG = [
    { key: 'products.manage', label: 'Manage products', group: 'Catalog' },
    { key: 'categories.manage', label: 'Manage categories', group: 'Catalog' },
    { key: 'brands.manage', label: 'Manage brands', group: 'Catalog' },
    { key: 'orders.manage', label: 'Manage orders', group: 'Sales' },
    { key: 'customers.manage', label: 'Manage customers', group: 'Sales' },
    { key: 'reviews.manage', label: 'Moderate reviews', group: 'Sales' },
    { key: 'coupons.manage', label: 'Manage coupons', group: 'Marketing' },
    { key: 'inventory.manage', label: 'Manage inventory', group: 'Operations' },
    { key: 'files.manage', label: 'Manage files', group: 'Operations' },
    { key: 'reports.view', label: 'View reports', group: 'Analytics' },
    { key: 'settings.manage', label: 'Manage settings', group: 'Administration' },
    { key: 'users.manage', label: 'Manage users & roles', group: 'Administration' },
];
exports.ROLE_PERMISSIONS = {
    admin: exports.PERMISSION_CATALOG.map((p) => p.key),
    staff: [
        'products.manage',
        'categories.manage',
        'brands.manage',
        'orders.manage',
        'customers.manage',
        'reviews.manage',
        'inventory.manage',
        'files.manage',
        'reports.view',
    ],
    customer: [],
};
function permissionsForRole(role, explicit = []) {
    if (role === 'admin')
        return exports.PERMISSION_CATALOG.map((p) => p.key);
    const base = exports.ROLE_PERMISSIONS[role] ?? [];
    return Array.from(new Set([...base, ...explicit]));
}
function hasPermission(user, permission) {
    if (!user)
        return false;
    if (user.role === 'admin')
        return true;
    const perms = user.permissions?.length ? user.permissions : exports.ROLE_PERMISSIONS[user.role ?? ''] ?? [];
    return perms.includes(permission);
}
