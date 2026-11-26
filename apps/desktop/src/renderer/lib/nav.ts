/** Left navigation. A node is shown only when the user holds its permission (null = always shown). */

export interface NavItem {
  /** i18n key under nav.* */
  key: string;
  path: string;
  permission: string | null;
  /** Screens not yet built render the "coming soon" placeholder. */
  implemented: boolean;
}

export interface NavSection {
  key: string;
  items: NavItem[];
}

export const NAV: NavSection[] = [
  { key: 'overview', items: [{ key: 'overview', path: '/overview', permission: null, implemented: true }] },
  {
    key: 'sales',
    items: [
      { key: 'quotes', path: '/sales/quotes', permission: 'quote.read', implemented: false },
      { key: 'invoices', path: '/sales/invoices', permission: 'invoice.read', implemented: true },
      { key: 'creditNotes', path: '/sales/credit-notes', permission: 'creditnote.read', implemented: false },
      { key: 'receipts', path: '/sales/receipts', permission: 'payment.read', implemented: false },
      { key: 'customers', path: '/sales/customers', permission: 'customer.read', implemented: false },
      { key: 'items', path: '/sales/items', permission: 'item.read', implemented: false },
    ],
  },
  {
    key: 'accounting',
    items: [
      { key: 'journals', path: '/accounting/journals', permission: 'journal.read', implemented: false },
      { key: 'chartOfAccounts', path: '/accounting/accounts', permission: 'account.read', implemented: false },
      { key: 'periods', path: '/accounting/periods', permission: 'period.read', implemented: false },
    ],
  },
  { key: 'reports', items: [{ key: 'reports', path: '/reports', permission: 'report.read', implemented: false }] },
  {
    key: 'settings',
    items: [
      { key: 'company', path: '/settings/company', permission: 'company.read', implemented: false },
      { key: 'branches', path: '/settings/branches', permission: 'branch.read', implemented: false },
      { key: 'usersRoles', path: '/settings/users', permission: 'user.read', implemented: false },
      { key: 'taxCodes', path: '/settings/tax-codes', permission: 'taxcode.read', implemented: false },
      { key: 'numbering', path: '/settings/numbering', permission: 'company.update', implemented: false },
      { key: 'devices', path: '/settings/devices', permission: 'device.read', implemented: false },
      { key: 'health', path: '/settings/health', permission: 'backup.read', implemented: true },
      { key: 'backup', path: '/settings/backup', permission: 'backup.read', implemented: true },
      { key: 'export', path: '/settings/export', permission: 'backup.export', implemented: true },
      { key: 'license', path: '/settings/license', permission: 'license.read', implemented: true },
      { key: 'help', path: '/settings/help', permission: 'backup.read', implemented: true },
    ],
  },
];

export function canSee(permissions: ReadonlySet<string>, required: string | null): boolean {
  return required === null || permissions.has(required);
}

/** Sections and items the user may open. Empty sections are dropped entirely. */
export function visibleNav(permissions: ReadonlySet<string>, nav: NavSection[] = NAV): NavSection[] {
  return nav
    .map((s) => ({ ...s, items: s.items.filter((i) => canSee(permissions, i.permission)) }))
    .filter((s) => s.items.length > 0);
}
