import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = resolve(__dirname, '..', '..');
const out = join(root, 'dist');
const rootReq = (id: string, from: string) => dirname(require.resolve(`${id}/package.json`, { paths: [from] }));

// Optional Nest peers (lazy-required in try/catch) and the native argon2 addon stay external.
const external = [
  'argon2',
  '@nestjs/microservices', '@nestjs/microservices/*', '@nestjs/websockets', '@nestjs/websockets/*',
  '@nestjs/platform-fastify', 'class-validator', 'class-transformer', 'cache-manager', '@fastify/static', 'bufferutil', 'utf-8-validate',
];

/** Node-style lookup of a package root (works when exports/main hide package.json): walk up from `from`, also checking pnpm's sibling layout. */
function pkgDirOf(name: string, from: string): string {
  let dir = realpathSync(from);
  for (let i = 0; i < 12; i++) {
    for (const c of [join(dir, 'node_modules', name), join(dir, name)]) {
      if (existsSync(join(c, 'package.json')) && (JSON.parse(readFileSync(join(c, 'package.json'), 'utf8')) as { name?: string }).name === name) return realpathSync(c);
    }
    dir = dirname(dir);
  }
  throw new Error(`cannot locate package root for ${name}`);
}

async function main(): Promise<void> {
  mkdirSync(out, { recursive: true });
  for (const name of ['server', 'worker', 'setup']) {
    await build({
      entryPoints: [join(root, 'apps', 'server', 'src', name === 'setup' ? 'setup/cli.ts' : name === 'server' ? 'main.ts' : 'worker.ts')],
      outfile: join(out, `${name}.cjs`),
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node22',
      sourcemap: false,
      external,
      tsconfig: join(root, 'apps', 'server', 'tsconfig.json'),
      logLevel: 'warning',
    });
  }

  // Prisma query engine + schema next to the bundles.
  const dbDir = join(root, 'packages', 'db');
  const clientDir = join(rootReq('@prisma/client', dbDir), '..', '..', '.prisma', 'client');
  const gen = existsSync(clientDir) ? clientDir : join(rootReq('@prisma/client', dbDir), '.prisma', 'client');
  for (const f of readdirSync(gen)) if (/^query_engine-windows.*\.node$/.test(f) || f === 'schema.prisma') cpSync(join(gen, f), join(out, f));

  // argon2 native addon (+ runtime deps) as a real node_modules folder beside the bundles.
  const argonDir = rootReq('argon2', dbDir);
  const nm = join(out, 'node_modules');
  cpSync(argonDir, join(nm, 'argon2'), { recursive: true });
  for (const dep of ['@phc/format', 'node-gyp-build', 'node-addon-api']) cpSync(rootReq(dep, argonDir), join(nm, dep), { recursive: true });
  // Document renderer: templates and fonts (packages/documents) and the pinned Chrome build (vendor/chrome).
  const docsDir = join(root, 'packages', 'documents');
  cpSync(join(docsDir, 'templates'), join(out, 'documents', 'templates'), { recursive: true });
  cpSync(join(docsDir, 'fonts'), join(out, 'documents', 'fonts'), { recursive: true });
  const chromeDir = join(root, 'vendor', 'chrome', 'chrome-headless-shell-win64');
  if (!existsSync(chromeDir)) throw new Error('chrome-headless-shell is not vendored; run pnpm vendor');
  cpSync(chromeDir, join(out, 'chrome'), { recursive: true });
  // Prisma CLI + schema engine + migrations so a packaged install can run migrate deploy without the repo.
  // Flat node_modules holding prisma and its runtime dependency closure (pnpm's store is symlinked, so resolve each dep from its parent).
  const cliNm = join(out, 'prisma-cli', 'node_modules');
  // Hoist to the root when free or same version; nest under the requiring package on a version conflict.
  const placed = new Map<string, string>(); // root-level name -> version
  const addPkg = (name: string, from: string, targetNm: string): void => {
    const dir = pkgDirOf(name, from);
    const pj = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version: string; dependencies?: Record<string, string> };
    const rootHas = placed.get(name);
    let dest: string;
    if (rootHas === undefined) {
      placed.set(name, pj.version);
      dest = join(cliNm, name);
    } else if (rootHas === pj.version) return;
    else dest = join(targetNm, name);
    cpSync(dir, dest, { recursive: true, dereference: true, filter: (p) => !/[\/]node_modules([\/]|$)/.test(p.slice(dir.length)) });
    for (const d of Object.keys(pj.dependencies ?? {})) addPkg(d, dir, join(dest, 'node_modules'));
  };
  addPkg('prisma', dbDir, cliNm);
  cpSync(join(dbDir, 'prisma'), join(out, 'prisma'), { recursive: true });
  console.log(`bundled to ${out}`);
}

void main();
