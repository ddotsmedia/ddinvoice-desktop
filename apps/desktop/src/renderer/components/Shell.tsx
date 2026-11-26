import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router';
import { Button } from '@ddinvoice/ui';
import { useSession } from '../lib/session';
import { LiveProvider } from '../lib/live';
import { visibleNav } from '../lib/nav';
import { useOpsBanners } from '../lib/ops';
import { ConnectionBadge } from './ConnectionBadge';
import { LanguageToggle } from './LanguageToggle';

/** Left navigation (filtered by permission), top bar, and the offline banner. */
export function Shell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { connection, permissions, me, signOut, clockSkew } = useSession();
  const sections = useMemo(() => visibleNav(permissions), [permissions]);
  const [menuOpen, setMenuOpen] = useState(false);
  const ops = useOpsBanners();

  return (
    <div className="flex h-full text-body">
      <aside className="flex w-52 shrink-0 flex-col border-e border-surface-line bg-surface">
        <div className="px-3 py-3 text-[15px] font-semibold text-navy">{t('common.appName')}</div>
        <nav className="flex-1 overflow-y-auto px-2 pb-3" aria-label={t('common.appName')}>
          {sections.map((section) => (
            <div key={section.key} className="mt-3">
              {section.key === 'overview' ? null : (
                <div className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-navy-muted">{t(`nav.${section.key}`, { defaultValue: section.key })}</div>
              )}
              <ul className="space-y-0.5">
                {section.items.map((item) => (
                  <li key={item.path}>
                    <NavLink
                      to={item.path}
                      className={({ isActive }) =>
                        `block rounded-md px-2 py-1 ${isActive ? 'bg-cobalt-soft font-medium text-cobalt' : 'text-navy hover:bg-surface-muted'}`
                      }
                    >
                      {t(`nav.${item.key}`)}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-10 shrink-0 items-center gap-3 border-b border-surface-line bg-surface px-3">
          <div className="ms-auto flex items-center gap-2">
            <ConnectionBadge state={connection} />
            <LanguageToggle />
            <div className="relative">
              <Button variant="ghost" aria-label={t('topbar.userMenu')} aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
                {me ? <bdi>{me.email}</bdi> : null}
              </Button>
              {menuOpen ? (
                <div role="menu" className="absolute end-0 top-8 z-10 w-40 rounded-md border border-surface-line bg-surface py-1 shadow-md">
                  <button role="menuitem" className="block w-full px-3 py-1 text-start hover:bg-surface-muted" onClick={() => void signOut()}>
                    {t('topbar.signOut')}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        {connection === 'offline' ? (
          <div role="alert" className="border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-amber-900">
            {t('banner.offline')}
          </div>
        ) : null}

        {clockSkew !== null ? (
          <div role="alert" className="border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-amber-900">
            {t('banner.clockSkew')}
          </div>
        ) : null}

        {ops.recoveryMode ? (
          <div role="alert" className="border-b border-red-200 bg-red-50 px-3 py-1.5 text-red-900">{t('banner.recovery')}</div>
        ) : null}

        {ops.backupStale ? (
          <div role="alert" className="border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-amber-900">{t('banner.backupStale')}</div>
        ) : null}

        {ops.readOnly ? (
          <div role="alert" className="border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-amber-900">{t('banner.readOnly')}</div>
        ) : null}

        <main className="min-h-0 flex-1 overflow-auto">
          <LiveProvider>{children}</LiveProvider>
        </main>
      </div>
    </div>
  );
}
