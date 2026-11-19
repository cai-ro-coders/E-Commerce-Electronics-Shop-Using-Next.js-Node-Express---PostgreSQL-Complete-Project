export const PERMISSION_CATALOG = [
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
] as const;

export type PermissionKey = (typeof PERMISSION_CATALOG)[number]['key'];

export const ROLE_PERMISSIONS: Record<string, PermissionKey[]> = {
  admin: PERMISSION_CATALOG.map((p) => p.key),
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

export function permissionsForRole(role: string, explicit: string[] = []): string[] {
  if (role === 'admin') return PERMISSION_CATALOG.map((p) => p.key);
  const base = ROLE_PERMISSIONS[role] ?? [];
  return Array.from(new Set([...base, ...explicit]));
}

export function hasPermission(
  user: { role?: string; permissions?: string[] } | undefined,
  permission: string,
): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const perms = user.permissions?.length ? user.permissions : ROLE_PERMISSIONS[user.role ?? ''] ?? [];
  return perms.includes(permission as PermissionKey);
}
