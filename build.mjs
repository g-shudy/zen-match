import esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const forTest = process.argv.includes('--test');

const browserConfig = {
  entryPoints: ['src/main.ts'],
  outdir: 'dist',
  entryNames: 'app',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  sourcemap: true,
  loader: {
    '.css': 'css'
  }
};

const engineConfig = {
  entryPoints: ['src/engine/index.ts'],
  outdir: 'dist',
  entryNames: 'engine',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2020',
  sourcemap: true
};

if (watch) {
  const browserCtx = await esbuild.context(browserConfig);
  const engineCtx = await esbuild.context(engineConfig);
  await browserCtx.watch();
  await engineCtx.watch();
  console.log('Watching for changes...');
} else {
  await esbuild.build(browserConfig);
  if (forTest) {
    await esbuild.build(engineConfig);
  } else {
    // Still build engine for local debugging; comment out if you want minimal output
    await esbuild.build(engineConfig);
  }
}
