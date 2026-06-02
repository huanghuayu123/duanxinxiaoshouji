import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist', 'local-phone');
const sourceBundle = path.join(root, '.codex-tavern-dist-phone', 'dist', '小手机', 'index.js');
const targetBundle = path.join(dist, 'phone-original.js');
const piniaCdnUrl = 'https://testingcf.jsdelivr.net/npm/pinia/+esm';

async function copyFile(from, to) {
  await cp(path.join(root, from), path.join(dist, to), { force: true });
}

async function main() {
  await mkdir(dist, { recursive: true });

  await copyFile('node_modules/vue/dist/vue.global.prod.js', 'vue.global.prod.js');
  await copyFile('node_modules/jquery/dist/jquery.min.js', 'jquery.min.js');
  await copyFile('node_modules/lodash/lodash.min.js', 'lodash.min.js');
  await copyFile('node_modules/pinia/dist/pinia.iife.prod.js', 'pinia.iife.prod.js');

  await rm(path.join(dist, 'zod'), { force: true, recursive: true });
  await cp(path.join(root, 'node_modules', 'zod'), path.join(dist, 'zod'), {
    dereference: true,
    force: true,
    recursive: true,
  });

  await writeFile(
    path.join(dist, 'pinia-shim.js'),
    `const pinia = window.Pinia;
if (!pinia) {
  throw new Error('Pinia runtime is not loaded');
}
export const createPinia = pinia.createPinia;
export const defineStore = pinia.defineStore;
export const acceptHMRUpdate = pinia.acceptHMRUpdate;
export const disposePinia = pinia.disposePinia;
export const getActivePinia = pinia.getActivePinia;
export const mapActions = pinia.mapActions;
export const mapGetters = pinia.mapGetters;
export const mapState = pinia.mapState;
export const mapStores = pinia.mapStores;
export const mapWritableState = pinia.mapWritableState;
export const setActivePinia = pinia.setActivePinia;
export const setMapStoreSuffix = pinia.setMapStoreSuffix;
export const shouldHydrate = pinia.shouldHydrate;
export const skipHydrate = pinia.skipHydrate;
export const storeToRefs = pinia.storeToRefs;
`,
    'utf8',
  );

  await writeFile(
    path.join(dist, 'zod-global.js'),
    `import * as zod from './zod/index.js';
window.z = zod;
`,
    'utf8',
  );

  const source = await readFile(sourceBundle, 'utf8');
  if (!source.includes(piniaCdnUrl)) {
    throw new Error(`Pinia CDN import not found in ${sourceBundle}`);
  }
  await writeFile(targetBundle, source.replace(piniaCdnUrl, './pinia-shim.js'), 'utf8');

  console.log(`Prepared local phone runtime at ${dist}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
