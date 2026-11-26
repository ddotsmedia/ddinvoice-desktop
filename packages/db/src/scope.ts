import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';

export class ScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScopeError';
  }
}

/** Models carrying a companyId column (derived from the Prisma datamodel). */
export const SCOPED_MODELS: ReadonlySet<string> = new Set(
  Prisma.dmmf.datamodel.models.filter((m) => m.fields.some((f) => f.name === 'companyId')).map((m) => m.name),
);

type Args = Record<string, unknown> & { where?: Record<string, unknown>; data?: unknown; create?: unknown; update?: unknown };

function assertSame(obj: Record<string, unknown>, companyId: string, op: string) {
  if ('companyId' in obj && obj.companyId !== companyId) throw new ScopeError(`${op}: companyId mismatch`);
}

function scopeData(data: unknown, companyId: string, op: string): unknown {
  if (Array.isArray(data)) return data.map((d) => scopeData(d, companyId, op));
  if (!data || typeof data !== 'object') throw new ScopeError(`${op}: data required`);
  assertSame(data as Record<string, unknown>, companyId, op);
  return { ...(data as object), companyId };
}

/**
 * Company-scope extension. Every query on a scoped model is forced to the given companyId:
 * where gets companyId, create data gets companyId; a conflicting explicit companyId throws.
 * Nested relation writes are not rewritten: write them through the scoped client per model.
 */
export function companyScope(companyId: string) {
  if (!companyId || typeof companyId !== 'string') throw new ScopeError('companyId is required');
  return Prisma.defineExtension({
    name: 'companyScope',
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          if (!SCOPED_MODELS.has(model)) return query(args);
          const a = { ...(args as Args) };
          const op = `${model}.${operation}`;
          if (a.where) assertSame(a.where, companyId, op);
          switch (operation) {
            case 'create':
            case 'createMany':
            case 'createManyAndReturn':
              a.data = scopeData(a.data, companyId, op);
              break;
            case 'upsert':
              a.where = { ...a.where, companyId };
              a.create = scopeData(a.create, companyId, op);
              if (a.update) assertSame(a.update as Record<string, unknown>, companyId, op);
              break;
            case 'findUnique':
            case 'findUniqueOrThrow':
            case 'findFirst':
            case 'findFirstOrThrow':
            case 'findMany':
            case 'count':
            case 'aggregate':
            case 'groupBy':
            case 'update':
            case 'updateMany':
            case 'updateManyAndReturn':
            case 'delete':
            case 'deleteMany':
              if (a.data && typeof a.data === 'object') assertSame(a.data as Record<string, unknown>, companyId, op);
              a.where = { ...a.where, companyId };
              break;
            default:
              throw new ScopeError(`${op}: operation not allowed on scoped model`);
          }
          return query(a as never);
        },
      },
    },
  });
}

export function scoped(prisma: PrismaClient, companyId: string) {
  return prisma.$extends(companyScope(companyId));
}
