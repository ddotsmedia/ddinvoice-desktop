import createClient from 'openapi-fetch';
import type { paths } from './schema';

export type { paths, components } from './schema';

/** Typed client for the Local API (generated types in ./schema.ts; regenerate with pnpm --filter @ddinvoice/server gen:client). */
export function createApiClient(baseUrl: string, accessToken?: string) {
  return createClient<paths>({
    baseUrl,
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
  });
}
