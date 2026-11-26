import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import Handlebars from 'handlebars';
import { buildViewModel, type SnapshotPayload, type ViewModel } from './model';
import type { DocType, Lang } from './labels';

/** Bump when any template or label changes output; saved on each IssueSnapshot. */
export const TEMPLATE_VERSION = 'v1';

/**
 * Assets live in packages/documents (src/.. or dist/.. in dev and tests) or, in the server bundle, in <bundle>/documents.
 * The bundle has no packages/ folder, so the bundled layout is checked first.
 */
function assetRoot(): string {
  const bundled = join(__dirname, 'documents');
  if (existsSync(join(bundled, 'templates'))) return bundled;
  return resolve(__dirname, '..');
}
const PKG_ROOT = assetRoot();
export const FONT_DIR = join(PKG_ROOT, 'fonts');
const TEMPLATE_DIR = join(PKG_ROOT, 'templates', TEMPLATE_VERSION);

function loadEngine() {
  const hb = Handlebars.create();
  const partialDir = join(TEMPLATE_DIR, 'partials');
  for (const f of readdirSync(partialDir)) {
    if (f.endsWith('.hbs')) hb.registerPartial(basename(f, '.hbs'), readFileSync(join(partialDir, f), 'utf8'));
  }
  const compile = (file: string) => hb.compile(readFileSync(join(TEMPLATE_DIR, file), 'utf8'), { strict: true });
  return {
    INVOICE: compile('invoice.hbs'),
    CREDIT_NOTE: compile('credit-note.hbs'),
  };
}

let engine: ReturnType<typeof loadEngine> | undefined;
const templates = () => (engine ??= loadEngine());

/** file:// base for @font-face; a trailing slash so template paths join cleanly. */
export function fontBaseUrl(): string {
  return `${pathToFileURL(FONT_DIR).href}/`;
}

export interface RenderOptions {
  lang: Lang;
  draft?: boolean;
}

/** Pure: snapshot payload + language → HTML. No I/O besides the compiled templates. */
export function renderDocument(payload: SnapshotPayload, opts: RenderOptions): { html: string; view: ViewModel } {
  const view = buildViewModel(payload, {
    lang: opts.lang,
    templateVersion: TEMPLATE_VERSION,
    fontBase: fontBaseUrl(),
    ...(opts.draft !== undefined ? { draft: opts.draft } : {}),
  });
  const t = templates();
  const docType: DocType = payload.docType;
  return { html: t[docType](view), view };
}

export { buildViewModel, type SnapshotPayload, type ViewModel } from './model';
export { LABELS, type DocType, type Lang } from './labels';
