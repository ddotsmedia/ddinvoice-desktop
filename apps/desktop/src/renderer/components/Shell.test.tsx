// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { initI18n } from '../i18n';

const session = {
  connection: 'connected' as 'connected' | 'reconnecting' | 'offline',
  permissions: new Set<string>(),
  me: { id: 'u1', companyId: 'c1', email: 'a@example.com', nameEn: 'A', nameAr: 'A', locale: 'en' as const, permissions: [] as string[] },
  signOut: vi.fn(),
  updateConfig: vi.fn(),
};

vi.mock('../lib/session', () => ({ useSession: () => session }));

const { Shell } = await import('./Shell');

function renderShell() {
  return render(
    <MemoryRouter>
      <Shell>
        <div />
      </Shell>
    </MemoryRouter>,
  );
}

describe('Shell navigation', () => {
  beforeAll(async () => {
    await initI18n('en');
  });
  afterEach(() => {
    cleanup();
    session.permissions = new Set();
    session.connection = 'connected';
  });

  it('shows only items the user has permission for', () => {
    session.permissions = new Set(['invoice.read', 'journal.read']);
    renderShell();
    expect(screen.getByRole('link', { name: 'Invoices' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Journals' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Credit notes' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Devices' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Users & roles' })).toBeNull();
  });

  it('shows the offline banner when the server is unreachable', () => {
    session.connection = 'offline';
    renderShell();
    expect(screen.getByRole('alert').textContent).toContain('unreachable');
  });
});
