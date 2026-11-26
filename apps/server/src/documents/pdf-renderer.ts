import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer, { type Browser } from 'puppeteer-core';
import { CONFIG } from '../core/tokens';
import type { ServerConfig } from '../config';

/** Injection token for the renderer; one Chrome per process, launched on first use. */
export const PDF_RENDERER = Symbol('PDF_RENDERER');

/** Browser is recycled after this many renders to bound Chrome memory growth. */
export const RESTART_EVERY = 200;

export interface PdfRenderer {
  render(html: string, fontDir: string): Promise<Buffer>;
  close(): Promise<void>;
}

const LAUNCH_ARGS = [
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--disable-background-networking',
  '--font-render-hinting=none',
];

/**
 * Renders HTML to PDF with the vendored chrome-headless-shell. Pages run with JavaScript off and
 * every network request blocked except file:// reads from the bundled font directory.
 */
export class ChromePdfRenderer implements PdfRenderer {
  private browser: Browser | undefined;
  private renders = 0;

  constructor(private readonly executablePath: string | undefined) {}

  private async session(): Promise<Browser> {
    if (!this.executablePath) throw new Error('chromePath is not configured (server.json or DD_CHROME_PATH)');
    if (!this.browser || this.renders >= RESTART_EVERY) {
      await this.close();
      this.browser = await puppeteer.launch({ executablePath: this.executablePath, headless: 'shell', args: LAUNCH_ARGS });
      this.renders = 0;
    }
    return this.browser;
  }

  async render(html: string, fontDir: string): Promise<Buffer> {
    const browser = await this.session();
    this.renders += 1;
    // about:blank cannot load file:// fonts, so the HTML is written to a private temp dir and opened as file://.
    const workDir = await mkdtemp(join(tmpdir(), 'ddinv-pdf-'));
    const pageFile = join(workDir, 'document.html');
    const page = await browser.newPage();
    try {
      await writeFile(pageFile, html, 'utf8');
      await page.setJavaScriptEnabled(false);
      await page.setRequestInterception(true);
      const allowed = pathToFileURL(fontDir).href.toLowerCase();
      const pageUrl = pathToFileURL(pageFile).href.toLowerCase();
      page.on('request', (req) => {
        const url = req.url().toLowerCase();
        if (url === pageUrl || (url.startsWith('file:') && url.startsWith(allowed))) void req.continue();
        else void req.abort('blockedbyclient');
      });
      await page.goto(pathToFileURL(pageFile).href, { waitUntil: 'load' });
      const bytes = await page.pdf({
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: '12mm', right: '12mm', bottom: '16mm', left: '12mm' },
      });
      return Buffer.from(bytes);
    } catch (e) {
      // A crashed browser must not poison later renders: drop it and let the next call relaunch.
      await this.close();
      throw e;
    } finally {
      await page.close().catch(() => undefined);
      await rm(workDir, { recursive: true, force: true });
    }
  }

  async close(): Promise<void> {
    const b = this.browser;
    this.browser = undefined;
    this.renders = 0;
    if (b) await b.close().catch(() => undefined);
  }
}

/** Renderer provider shared by the API (preview) and the worker (archive). Chrome is not started until a render runs. */
export const pdfRendererProvider = {
  provide: PDF_RENDERER,
  // Default: the Chrome copied beside the server bundle by tools/scripts/bundle-server.ts.
  useFactory: (cfg: ServerConfig): PdfRenderer => new ChromePdfRenderer(cfg.chromePath ?? join(__dirname, 'chrome', 'chrome-headless-shell.exe')),
  inject: [CONFIG],
};
