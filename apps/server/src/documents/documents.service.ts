import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { Inject, Injectable, StreamableFile, type OnModuleDestroy } from '@nestjs/common';
import { FONT_DIR, renderDocument, type DocType, type Lang } from '@ddinvoice/documents';
import { ApiException } from '../common/api-exception';
import { businessDate, isoDate } from '../common/business-date';
import { CONFIG } from '../core/tokens';
import type { ServerConfig } from '../config';
import { PrismaService } from '../core/prisma.service';
import { computeDocument, type ComputedDocument } from './lines';
import { buyerParty, resolveStoredLines, sellerParty, snapshotLines } from './stored';
import { PDF_RENDERER, type PdfRenderer } from './pdf-renderer';
import type { PreviewInput } from './documents.schemas';

const totalsData = (c: ComputedDocument) => ({
  subtotal: c.subtotal.toFixed(4),
  discountTotal: c.discountTotal.toFixed(4),
  taxTotal: c.taxTotal.toFixed(4),
  total: c.total.toFixed(4),
  totalAed: c.totalAed.toFixed(4),
});

@Injectable()
export class DocumentsService implements OnModuleDestroy {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CONFIG) private readonly config: ServerConfig,
    @Inject(PDF_RENDERER) private readonly renderer: PdfRenderer,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.renderer.close();
  }

  /** Streams the archived PDF. 409 PDF_PENDING while the worker has not rendered this language yet. */
  async archived(docType: DocType, docId: string, lang: Lang): Promise<StreamableFile> {
    const db = this.prisma.scoped(this.config.companyId);
    const doc = await db.document.findFirst({ where: { docType, docId, language: lang }, orderBy: { createdAt: 'desc' } });
    if (!doc) {
      const issued = await db.issueSnapshot.count({ where: { docType, docId } });
      if (issued === 0) throw ApiException.notFound('Document');
      throw ApiException.conflict('PDF_PENDING', 'PDF is not archived yet');
    }
    const name = doc.path.split('/').pop() ?? 'document.pdf';
    return new StreamableFile(createReadStream(join(this.config.dataDir, doc.path)), {
      type: 'application/pdf',
      length: doc.bytes,
      disposition: `inline; filename="${name}"`,
    });
  }

  /** Renders a draft invoice with the DRAFT watermark. Nothing is archived or stored. */
  async preview(input: PreviewInput): Promise<StreamableFile> {
    const db = this.prisma.scoped(this.config.companyId);
    const inv = await db.invoice.findFirst({ where: { id: input.docId }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    if (!inv) throw ApiException.notFound('Invoice');
    if (inv.lines.length === 0) throw ApiException.validation('Invoice has no lines', { lines: 'required' });
    const customer = await db.customer.findFirstOrThrow({ where: { id: inv.customerId } });
    const company = await this.prisma.client.company.findUniqueOrThrow({ where: { id: this.config.companyId } });

    const resolved = await resolveStoredLines(db, inv.lines);
    const fxRate = inv.currency === 'AED' ? '1' : inv.fxRate.toString();
    const computed = computeDocument(resolved, fxRate);
    const { html } = renderDocument(
      {
        docType: 'INVOICE',
        number: inv.number ?? 'DRAFT',
        issueDate: isoDate(businessDate()),
        dueDate: isoDate(inv.dueDate),
        supplyDate: inv.supplyDate ? isoDate(inv.supplyDate) : null,
        currency: inv.currency,
        fxRate,
        seller: sellerParty(company),
        buyer: buyerParty(customer),
        lines: snapshotLines(resolved, computed.lines),
        totals: totalsData(computed),
      },
      { lang: input.lang, draft: true },
    );
    const pdf = await this.renderer.render(html, FONT_DIR);
    return new StreamableFile(pdf, { type: 'application/pdf' });
  }
}

