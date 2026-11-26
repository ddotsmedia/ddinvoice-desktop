import { resolve, join } from 'node:path';
import { downloadVerified } from './lib/download';

export const NODE_VERSION = '22.23.4';
export const NODE_URL = `https://nodejs.org/dist/v${NODE_VERSION}/win-x64/node.exe`;
export const NODE_SHA256 = 'dccc52de28d8df2ee22d2062424f8c563070d95d8ad70c54c4bf01d590dec14f';

/** Vendors the pinned Node 22 LTS node.exe into <root>/vendor/node. */
export async function fetchNode(root = resolve(__dirname, '..', '..')): Promise<string> {
  const dest = join(root, 'vendor', 'node', 'node.exe');
  await downloadVerified(NODE_URL, dest, NODE_SHA256);
  return dest;
}

if (require.main === module) fetchNode().then((p) => console.log(`Node ready: ${p}`));
