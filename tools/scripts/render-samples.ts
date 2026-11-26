import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FONT_DIR, renderDocument } from '@ddinvoice/documents';
import { ChromePdfRenderer } from '../../apps/server/src/documents/pdf-renderer';
import { creditNoteFixture, fixtures } from '../../apps/server/test/documents.fixtures';

/** Writes fictional sample PDFs (all fixtures x en/ar/bi, plus a credit note) to docs/samples. */
async function main(): Promise<void> {
  const root = resolve(__dirname, '..', '..');
  const exe = process.env.DD_CHROME_PATH ?? join(root, 'vendor', 'chrome', 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');
  const out = join(root, 'docs', 'samples');
  mkdirSync(out, { recursive: true });
  const renderer = new ChromePdfRenderer(exe);
  try {
    const all = [...fixtures(), creditNoteFixture()];
    for (const f of all) {
      for (const lang of ['en', 'ar', 'bi'] as const) {
        const { html } = renderDocument(f.payload, { lang });
        const pdf = await renderer.render(html, FONT_DIR);
        writeFileSync(join(out, `${f.name}-${lang}.pdf`), pdf);
        console.log(`${f.name}-${lang}.pdf ${pdf.length} bytes`);
      }
    }
  } finally {
    await renderer.close();
  }
}

void main();
