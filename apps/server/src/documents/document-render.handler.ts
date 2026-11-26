import { createHash } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { renderDocument, FONT_DIR, type SnapshotPayload } from '@ddinvoice/documents';
import { z } from 'zod';
import type { OutboxHandler, OutboxJob } from '../outbox/outbox.worker';
import type { PrismaService } from '../core/prisma.service';
import type { PdfRenderer } from './pdf-renderer';

/** Outbox payload written at issue time (one job per language). */
export const RenderJobSchema = z.object({
  docType: z.enum(['INVOICE', 'CREDIT_NOTE']),
  docId: z.string().min(1),
  snapshotId: z.string().min(1),
  lang: z.enum(['en', 'ar', 'bi']),
});
export type RenderJob = z.infer<typeof RenderJobSchema>;

/** Archive path relative to dataDir: documents/<yyyy>/<docType>/<number>-<lang>.pdf */
export function archivePath(p: { docType: string; number: string; issueDate: string; lang: string }): string {
  const year = p.issueDate.slice(0, 4);
  const safe = p.number.replace(/[^A-Za-z0-9._-]/g, '_');
  return ['documents', year, p.docType, `${safe}-${p.lang}.pdf`].join('/');
}

export interface DocumentRenderDeps {
  prisma: PrismaService;
  companyId: string;
  dataDir: string;
  renderer: PdfRenderer;
}

/**
 * Renders one archived PDF from the IssueSnapshot (never live records) and records a Document row.
 * Idempotent: if a Document exists for this snapshot and language, the job is a no-op.
 * Throws on failure so the outbox retries with backoff.
 */
export function createDocumentRenderHandler(deps: DocumentRenderDeps): OutboxHandler {
  return async (job: OutboxJob) => {
    const parsed = RenderJobSchema.parse(job.payload);
    const db = deps.prisma.scoped(deps.companyId);

    const existing = await db.document.findFirst({
      where: { docType: parsed.docType, docId: parsed.docId, snapshotId: parsed.snapshotId, language: parsed.lang },
    });
    if (existing) return;

    const snap = await db.issueSnapshot.findFirst({
      where: { id: parsed.snapshotId, docType: parsed.docType, docId: parsed.docId },
    });
    if (!snap) throw new Error(`IssueSnapshot ${parsed.snapshotId} not found`);
    const payload = snap.payload as unknown as SnapshotPayload;

    const { html } = renderDocument(payload, { lang: parsed.lang });
    const pdf = await deps.renderer.render(html, FONT_DIR);

    const rel = archivePath({ docType: parsed.docType, number: payload.number, issueDate: payload.issueDate, lang: parsed.lang });
    const abs = join(deps.dataDir, rel);
    await mkdir(dirname(abs), { recursive: true });
    const tmp = `${abs}.part`;
    await writeFile(tmp, pdf);
    await rename(tmp, abs);

    await db.document.create({
      data: {
        companyId: deps.companyId,
        docType: parsed.docType,
        docId: parsed.docId,
        snapshotId: parsed.snapshotId,
        kind: 'PDF',
        language: parsed.lang,
        path: rel,
        sha256: createHash('sha256').update(pdf).digest('hex'),
        bytes: pdf.length,
      },
    });
  };
}
