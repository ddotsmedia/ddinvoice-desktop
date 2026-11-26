/** Permission strings: `resource.action`. */
export const RESOURCES = [
  'company', 'branch', 'user', 'role', 'device', 'account', 'period', 'taxcode', 'customer', 'item',
  'quote', 'invoice', 'creditnote', 'payment', 'journal', 'report', 'document', 'audit', 'backup', 'license', 'sync',
] as const;
export const ACTIONS = ['read', 'create', 'update', 'delete', 'issue', 'post', 'export'] as const;

export type Permission = `${(typeof RESOURCES)[number]}.${(typeof ACTIONS)[number]}`;

export const ALL_PERMISSIONS: readonly Permission[] = RESOURCES.flatMap((r) => ACTIONS.map((a) => `${r}.${a}` as Permission));

const pick = (resources: readonly string[], actions: readonly string[]): Permission[] =>
  ALL_PERMISSIONS.filter((p) => {
    const [r, a] = p.split('.');
    return resources.includes(r as string) && actions.includes(a as string);
  });

export const ROLE_PERMISSIONS: Record<'owner' | 'accountant' | 'sales' | 'auditor', Permission[]> = {
  owner: [...ALL_PERMISSIONS],
  accountant: [
    ...pick(['account', 'period', 'taxcode', 'journal', 'payment', 'invoice', 'creditnote', 'customer', 'report', 'document'], ['read', 'create', 'update', 'issue', 'post', 'export']),
    ...pick(['company', 'item', 'quote', 'audit'], ['read']),
  ],
  sales: [
    ...pick(['customer', 'item', 'quote', 'invoice', 'document'], ['read', 'create', 'update', 'export']),
    ...pick(['invoice'], ['issue']),
    ...pick(['taxcode', 'company'], ['read']),
  ],
  auditor: pick(RESOURCES, ['read', 'export']),
};
