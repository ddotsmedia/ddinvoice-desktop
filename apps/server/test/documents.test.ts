import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scoped } from '@ddinvoice/db';
import { FONT_DIR, money, renderDocument } from '@ddinvoice/documents';
import { ChromePdfRenderer, type PdfRenderer } from '../src/documents/pdf-renderer';
import { createDocumentRenderHandler } from '../src/documents/document-render.handler';
import type { PrismaService } from '../src/core/prisma.service';
import { creditNoteFixture, fixtures, SELLER } from './documents.fixtures';
import request from 'supertest';
import { createCustomer, createDraftInvoice, createTenant, http, type Tenant } from './helpers';

const CHROME =
  process.env.DD_CHROME_PATH ?? resolve(__dirname, '../../../vendor/chrome/chrome-headless-shell-win64/chrome-headless-shell.exe');
const LANGS = ['en', 'ar', 'bi'] as const;
/** Chrome is vendored by tools/scripts/fetch-chrome.ts (Windows CI and dev machines); the Linux DB job skips these suites. */
const HAS_CHROME = existsSync(CHROME);

/** Extracts text per page with pdfjs-dist (legacy build runs in Node without canvas). */
async function pdfPages(buf: Buffer): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), disableFontFace: true }).promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    out.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' '));
  }
  return out;
}

describe.skipIf(!HAS_CHROME)('archived PDFs rendered from IssueSnapshot', () => {
  let renderer: PdfRenderer;
  beforeAll(() => {
    if (!existsSync(CHROME)) throw new Error(`chrome-headless-shell missing at ${CHROME}; run pnpm vendor or set DD_CHROME_PATH`);
    renderer = new ChromePdfRenderer(CHROME);
  });
  afterAll(async () => {
    await renderer.close();
  });

  it.each(fixtures().flatMap((f) => LANGS.map((lang) => ({ ...f, lang }))))(
    '$name / $lang renders a PDF with number, TRN and total',
    async ({ payload, lang }) => {
      const { html } = renderDocument(payload, { lang });
      const pdf = await renderer.render(html, FONT_DIR);
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      const text = (await pdfPages(pdf)).join('\n');
      expect(text).toContain(payload.number);
      expect(text).toContain(SELLER.trn);
      expect(text).toContain(money(payload.totals.total));
    },
    60_000,
  );

  it('200-line invoice spans pages, repeats the table header and puts totals on the last page', async () => {
    const long = fixtures().find((f) => f.name === 'long-200')!;
    const { html } = renderDocument(long.payload, { lang: 'en' });
    const pages = await pdfPages(await renderer.render(html, FONT_DIR));
    expect(pages.length).toBeGreaterThan(1);
    for (const p of pages.slice(0, -1)) expect(p).toContain('Description');
    expect(pages[pages.length - 1]).toContain(money(long.payload.totals.total));
    expect(pages[0]).not.toContain(money(long.payload.totals.total));
    expect(pages[pages.length - 1]).toContain(`Page ${pages.length} of ${pages.length}`);
  }, 60_000);

  it('credit note shows the original invoice reference and reason', async () => {
    const cn = creditNoteFixture();
    const { html } = renderDocument(cn.payload, { lang: 'en' });
    const text = (await pdfPages(await renderer.render(html, FONT_DIR))).join(' ');
    expect(text).toContain('INV-2026-0001');
    expect(text).toContain('Partial refund');
  }, 60_000);
});

describe.skipIf(!HAS_CHROME)('document.render handler', () => {
  let t: Tenant;
  let renderer: PdfRenderer;
  let renders = 0;
  let snapshotId: string;
  let docId: string;

  beforeAll(async () => {
    t = await createTenant();
    const real = new ChromePdfRenderer(CHROME);
    renderer = {
      render: (h, d) => {
        renders += 1;
        return real.render(h, d);
      },
      close: () => real.close(),
    };
    docId = randomUUID();
    const payload = fixtures()[0]!.payload;
    const snap = await t.prisma.issueSnapshot.create({
      data: {
        companyId: t.companyId,
        docType: 'INVOICE',
        docId,
        payload: payload as object,
        sha256: 'test',
        templateVersion: 'v1',
      },
    });
    snapshotId = snap.id;
  }, 120_000);

  afterAll(async () => {
    await renderer.close();
    await t.close();
  });

  const handler = () =>
    createDocumentRenderHandler({
      prisma: { scoped: (companyId: string) => scoped(t.prisma, companyId) } as unknown as PrismaService,
      companyId: t.companyId,
      dataDir: t.config.dataDir,
      renderer,
    });
  const job = (lang: 'en' | 'ar' | 'bi') => ({
    id: randomUUID(),
    topic: 'document.render',
    attempts: 0,
    payload: { docType: 'INVOICE', docId, snapshotId, lang },
  });

  it('renders once per snapshot and language; a second run is a no-op', async () => {
    await handler()(job('en'));
    await handler()(job('en'));
    const rows = await t.prisma.document.findMany({ where: { companyId: t.companyId, docId } });
    expect(rows).toHaveLength(1);
    expect(renders).toBe(1);
    expect(rows[0]!.language).toBe('en');
    expect(rows[0]!.kind).toBe('PDF');
  }, 120_000);

  it('archives the file and records its sha256; changing the company after issue leaves it unchanged', async () => {
    await handler()(job('ar'));
    const before = await t.prisma.document.findFirstOrThrow({ where: { companyId: t.companyId, docId, language: 'ar' } });
    const file = join(t.config.dataDir, before.path);
    const bytes = readFileSync(file);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(before.sha256);
    expect(before.bytes).toBe(bytes.length);

    await t.prisma.company.update({ where: { id: t.companyId }, data: { logoFileId: randomUUID(), legalNameEn: 'Renamed LLC' } });
    await handler()(job('ar'));
    const after = await t.prisma.document.findFirstOrThrow({ where: { companyId: t.companyId, docId, language: 'ar' } });
    expect(after.sha256).toBe(before.sha256);
    expect(after.id).toBe(before.id);
  }, 120_000);
});

describe.skipIf(!HAS_CHROME)('documents API', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await createTenant();
  }, 120_000);
  afterAll(async () => {
    await t.close();
  });

  const binaryParser = (res: request.Response, cb: (e: Error | null, body: Buffer) => void) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  };

  it('GET archived PDF requires a token; 409 PDF_PENDING before render; 200 once archived', async () => {
    const docId = randomUUID();
    const snap = await t.prisma.issueSnapshot.create({
      data: { companyId: t.companyId, docType: 'INVOICE', docId, payload: fixtures()[0]!.payload as object, sha256: 'x', templateVersion: 'v1' },
    });
    const url = `/documents/INVOICE/${docId}/pdf?lang=en`;
    const anon = await request(t.app.getHttpServer()).get(url);
    expect(anon.status).toBe(401);

    const pending = await http(t).get(url);
    expect(pending.status).toBe(409);
    expect(pending.body.error?.code ?? pending.body.code).toBe('PDF_PENDING');

    const renderer = new ChromePdfRenderer(process.env.DD_CHROME_PATH ?? resolve(__dirname, '../../../vendor/chrome/chrome-headless-shell-win64/chrome-headless-shell.exe'));
    try {
      await createDocumentRenderHandler({
        prisma: { scoped: (c: string) => scoped(t.prisma, c) } as unknown as PrismaService,
        companyId: t.companyId,
        dataDir: t.config.dataDir,
        renderer,
      })({ id: randomUUID(), topic: 'document.render', attempts: 0, payload: { docType: 'INVOICE', docId, snapshotId: snap.id, lang: 'en' } });
    } finally {
      await renderer.close();
    }

    const ok = await request(t.app.getHttpServer())
      .get(url)
      .set('Authorization', `Bearer ${t.token}`)
      .buffer(true)
      .parse(binaryParser);
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toContain('application/pdf');
    expect((ok.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  }, 120_000);

  it('POST preview renders a DRAFT watermarked PDF and archives nothing', async () => {
    const customerId = await createCustomer(t);
    const draft = await createDraftInvoice(t, customerId, '2', '100.00');
    const before = await t.prisma.document.count({ where: { companyId: t.companyId, docId: draft.id } });
    const res = await request(t.app.getHttpServer())
      .post('/documents/preview')
      .set('Authorization', `Bearer ${t.token}`)
      .send({ docType: 'INVOICE', docId: draft.id, lang: 'en' })
      .buffer(true)
      .parse(binaryParser);
    expect(res.status).toBe(201);
    expect(res.headers['content-type']).toContain('application/pdf');
    const text = (await pdfPages(res.body as Buffer)).join(' ');
    expect(text).toContain('DRAFT');
    expect(await t.prisma.document.count({ where: { companyId: t.companyId, docId: draft.id } })).toBe(before);
  }, 120_000);
});
