// Build script: produces build/bundle/server.cjs (single-file CommonJS bundle)
// plus a sibling production node_modules tree containing only node-notifier
// (which can't be bundled cleanly because it loads vendor binaries at runtime).
//
// Layout produced:
//   build/bundle/server.cjs
//   build/bundle/node_modules/node-notifier/...
//   build/bundle/snoretoast/snoretoast-x64.exe   (for reference; not the live copy)
import { build } from 'esbuild';
import { mkdirSync, copyFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const outDir = join(projectRoot, 'build', 'bundle');

if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

// 1. Bundle TS sources.
await build({
  entryPoints: [join(projectRoot, 'src', 'server.ts')],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outfile: join(outDir, 'server.cjs'),
  // node-notifier dynamically resolves vendor binaries; bundling breaks that.
  // systray2 ships a pre-compiled Go binary (traybin/); same issue.
  external: ['node-notifier', 'systray2'],
  logLevel: 'info',
  treeShaking: true
});

// 2. Write a tiny package.json next to the bundle and `npm install` only
//    node-notifier into it. This produces a minimal production tree.
const stubPkgPath = join(outDir, 'package.json');
writeFileSync(stubPkgPath, JSON.stringify({
  name: 'ghent-runtime',
  version: '0.0.0',
  private: true,
  dependencies: {
    'node-notifier': '^10.0.1',
    'systray2': '^2.1.4'
  }
}, null, 2));

console.log('Installing production node_modules into bundle...');
execSync('npm install --omit=dev --no-audit --no-fund --silent', {
  cwd: outDir,
  stdio: 'inherit',
  shell: true
});

// Drop the package-lock — not needed at runtime.
const lockPath = join(outDir, 'package-lock.json');
if (existsSync(lockPath)) rmSync(lockPath);

// 3. Copy snoretoast next to the bundle for reference / debugging.
const snoreSrc = join(outDir, 'node_modules', 'node-notifier', 'vendor', 'snoreToast', 'snoretoast-x64.exe');
const snoreDir = join(outDir, 'snoretoast');
mkdirSync(snoreDir, { recursive: true });
copyFileSync(snoreSrc, join(snoreDir, 'snoretoast-x64.exe'));

// 4. Copy src/assets/ (icon.png + icon.svg + icon.ico) next to the bundle.
const assetsDir = join(outDir, 'assets');
mkdirSync(assetsDir, { recursive: true });
for (const name of ['icon.png', 'icon.svg', 'icon.ico']) {
  const src = join(projectRoot, 'src', 'assets', name);
  if (existsSync(src)) copyFileSync(src, join(assetsDir, name));
}

console.log('Bundle written to', outDir);
