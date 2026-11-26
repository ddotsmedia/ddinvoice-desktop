import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AppConfig, Tokens } from '../../shared/ipc';
import { Api, ApiError, CLOCK_SKEW_LIMIT_MS, clockSkewMs, versionGateFor, type VersionGate } from './api';

export type Connection = 'connected' | 'reconnecting' | 'offline';

export interface Me {
  id: string;
  companyId: string;
  email: string;
  nameEn: string;
  nameAr: string;
  locale: 'en' | 'ar';
  permissions: string[];
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface SessionValue {
  config: AppConfig;
  api: Api | null;
  connection: Connection;
  /** null until /system/version has been read for the paired server. */
  versionGate: VersionGate | null;
  appVersion: string;
  serverVersion: { version: string; minClient: string } | null;
  /** Local clock minus server clock in ms, when it exceeds 5 min; null otherwise. */
  clockSkew: number | null;
  me: Me | null;
  permissions: ReadonlySet<string>;
  authState: 'loading' | 'signedOut' | 'signedIn';
  /** Writes non-binding settings (locale, role) to the main-process config. */
  updateConfig: (patch: Partial<Pick<AppConfig, 'locale' | 'role' | 'setupDone'>>) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error('useSession must be used inside SessionProvider');
  return v;
}

const HEALTH_MS = 15_000;

/** Owns config, tokens, the API client, the connection monitor and the version gate. */
export function SessionProvider({ initialConfig, appVersion, children }: { initialConfig: AppConfig; appVersion: string; children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig>(initialConfig);
  const [tokens, setTokens] = useState<Tokens | null>(null);
  const [tokensLoaded, setTokensLoaded] = useState(false);
  const [connection, setConnection] = useState<Connection>('reconnecting');
  const [serverVersion, setServerVersion] = useState<SessionValue['serverVersion']>(null);
  const [versionFailed, setVersionFailed] = useState(false);
  const [clockSkew, setClockSkew] = useState<number | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const tokenRef = useRef<Tokens | null>(null);

  useEffect(() => {
    void window.ddi.auth.load().then((t) => {
      tokenRef.current = t;
      setTokens(t);
      setTokensLoaded(true);
    });
  }, []);

  const api = useMemo(() => {
    if (!config.serverOrigin || !config.deviceId) return null;
    const client: Api = new Api({
      origin: config.serverOrigin,
      deviceId: config.deviceId,
      getAccessToken: () => tokenRef.current?.accessToken ?? null,
      refresh: async () => {
        const rt = tokenRef.current?.refreshToken;
        if (!rt) return false;
        try {
          const next = await fetchTokens(client, rt);
          tokenRef.current = next;
          setTokens(next);
          await window.ddi.auth.storeTokens(next);
          return true;
        } catch {
          tokenRef.current = null;
          setTokens(null);
          await window.ddi.auth.clear();
          return false;
        }
      },
    });
    return client;
  }, [config.serverOrigin, config.deviceId]);

  // Connection monitor: /health every 15s. One failure shows "reconnecting"; repeated failures show "offline".
  useEffect(() => {
    if (!api) return;
    let failures = 0;
    let stopped = false;
    const probe = async () => {
      try {
        await api.get('/health');
        failures = 0;
        if (!stopped) setConnection('connected');
      } catch {
        failures += 1;
        if (!stopped) setConnection(failures > 1 ? 'offline' : 'reconnecting');
      }
    };
    void probe();
    const timer = setInterval(() => void probe(), HEALTH_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [api]);

  // Version gate: read from the paired server. If the server is down the gate is skipped (the offline banner shows)
  // and the read is retried whenever the connection state changes.
  useEffect(() => {
    if (!api || serverVersion) return;
    let cancelled = false;
    const started = Date.now();
    api
      .get<{ version: string; minClient: string; serverTime: string }>('/system/version')
      .then((v) => {
        if (cancelled) return;
        setServerVersion(v);
        setVersionFailed(false);
        const skew = clockSkewMs(v.serverTime, started, Date.now());
        setClockSkew(Math.abs(skew) > CLOCK_SKEW_LIMIT_MS ? skew : null);
      })
      .catch(() => {
        if (!cancelled) setVersionFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [api, connection, serverVersion]);

  // Current user (and permissions) when a token exists.
  useEffect(() => {
    if (!api || !tokens) {
      setMe(null);
      return;
    }
    let cancelled = false;
    void api
      .get<Me>('/auth/me')
      .then((u) => !cancelled && setMe(u))
      .catch(async () => {
        // The token is unusable (refresh already failed inside Api): fall back to the sign-in screen.
        if (cancelled) return;
        tokenRef.current = null;
        setTokens(null);
        await window.ddi.auth.clear();
      });
    return () => {
      cancelled = true;
    };
  }, [api, tokens]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      if (!api || !config.deviceId) throw new ApiError(0, 'NOT_PAIRED', 'Not paired');
      const pair = await api.post<TokenPair>('/auth/login', { body: { email, password, deviceId: config.deviceId, appVersion } });
      const next: Tokens = { accessToken: pair.accessToken, refreshToken: pair.refreshToken };
      tokenRef.current = next;
      setTokens(next);
      await window.ddi.auth.storeTokens(next);
    },
    [api, config.deviceId, appVersion],
  );

  const signOut = useCallback(async () => {
    try {
      if (api && tokenRef.current) await api.post('/auth/logout');
    } catch {
      // Local sign-out must succeed even when the server is unreachable.
    }
    tokenRef.current = null;
    setTokens(null);
    setMe(null);
    await window.ddi.auth.clear();
  }, [api]);

  const updateConfig = useCallback(async (patch: Partial<Pick<AppConfig, 'locale' | 'role' | 'setupDone'>>) => {
    setConfig(await window.ddi.config.set(patch));
  }, []);

  const versionGate: SessionValue['versionGate'] = serverVersion
    ? versionGateFor(appVersion, serverVersion)
    : versionFailed
      ? 'ok'
      : null;

  const value: SessionValue = {
    config,
    api,
    connection,
    versionGate,
    clockSkew,
    appVersion,
    serverVersion,
    me,
    permissions: new Set(me?.permissions ?? []),
    authState: tokens ? (me ? 'signedIn' : 'loading') : 'signedOut',
    updateConfig,
    signIn,
    signOut,
  };

  if (!tokensLoaded) return null;
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

async function fetchTokens(api: Api, refreshToken: string): Promise<Tokens> {
  const pair = await api.post<TokenPair>('/auth/refresh', { body: { refreshToken } });
  return { accessToken: pair.accessToken, refreshToken: pair.refreshToken };
}
