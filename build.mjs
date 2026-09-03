import esbuild from 'esbuild';
import { readFileSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const forTest = process.argv.includes('--test');

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const define = { __APP_VERSION__: JSON.stringify(pkg.version) };

const browserConfig = {
  entryPoints: ['src/main.ts'],
  outdir: 'dist',
  entryNames: 'app',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  sourcemap: true,
  define,
  loader: {
    '.css': 'css'
  }
};

// Pure modules bundled for node so the tests can import them without a DOM.
// Named entries: with bare paths esbuild keys output on the common ancestor
// directory and writes dist/engine/index.js, which the tests do not import.
const nodeConfig = {
  entryPoints: { engine: 'src/engine/index.ts', storage: 'src/storage.ts', hold: 'src/hold.ts' },
  outdir: 'dist',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2020',
  sourcemap: true,
  define
};

if (watch) {
  const browserCtx = await esbuild.context(browserConfig);
  const nodeCtx = await esbuild.context(nodeConfig);
  await browserCtx.watch();
  await nodeCtx.watch();
  console.log('Watching for changes...');
} else {
  await esbuild.build(browserConfig);
  // Always emitted: cheap, and handy for local debugging even outside --test.
  await esbuild.build(nodeConfig);
  if (forTest) {
    // Nothing extra yet; the flag is kept so `npm test` stays explicit about intent.
  }
}
