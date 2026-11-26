import { useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router';
import type { AppConfig } from '../shared/ipc';
import { setLocale } from './i18n';
import { SessionProvider, useSession } from './lib/session';
import { Login } from './screens/auth/Login';
import { ComingSoon } from './screens/shared/ComingSoon';
import { UpdateRequired } from './screens/system/UpdateRequired';
import { ServerNeedsUpdate } from './screens/system/ServerNeedsUpdate';
import { SetupWizard } from './screens/setup/SetupWizard';
import { Overview } from './screens/overview/Overview';
import { InvoiceRegister } from './screens/invoices/InvoiceRegister';
import { InvoiceEditor } from './screens/invoices/InvoiceEditor';
import { Shell } from './components/Shell';
import { Loading } from './components/Loading';

interface Boot {
  config: AppConfig;
  version: string;
}

/** Reads persisted config and the app version once, then picks the first screen. */
export function App() {
  const [boot, setBoot] = useState<Boot | null>(null);

  useEffect(() => {
    void Promise.all([window.ddi.config.get(), window.ddi.app.version()]).then(async ([config, version]) => {
      await setLocale(config.locale);
      setBoot({ config, version });
    });
  }, []);

  if (!boot) return <Loading />;
  // Not paired yet: the wizard handles language, role, install/discovery and pairing, then reloads the window.
  if (!boot.config.serverOrigin || !boot.config.deviceId) return <SetupWizard />;

  return (
    <SessionProvider initialConfig={boot.config} appVersion={boot.version}>
      <Gate />
    </SessionProvider>
  );
}

function Gate() {
  const s = useSession();
  if (s.versionGate === 'updateRequired') return <UpdateRequired current={s.appVersion} required={s.serverVersion?.minClient ?? ''} />;
  if (s.versionGate === 'serverNeedsUpdate') return <ServerNeedsUpdate current={s.appVersion} server={s.serverVersion?.version ?? ''} />;
  if (s.versionGate === null) return <Loading />;
  if (s.authState === 'loading') return <Loading />;
  if (s.authState === 'signedOut') return <Login />;

  return (
    <HashRouter>
      <Shell>
        <Routes>
          <Route path="/" element={<Navigate to="/overview" replace />} />
          <Route path="/overview" element={<Overview />} />
          <Route path="/sales/invoices" element={<InvoiceRegister />} />
          <Route path="/sales/invoices/new" element={<InvoiceEditor />} />
          <Route path="/sales/invoices/:id" element={<InvoiceEditor />} />
          <Route path="*" element={<ComingSoon />} />
        </Routes>
      </Shell>
    </HashRouter>
  );
}
