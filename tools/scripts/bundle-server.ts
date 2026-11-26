import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
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
  console.log(`bundled to ${out}`);
}

void main();
