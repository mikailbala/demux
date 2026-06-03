import { build } from 'esbuild';
import { chmod, readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf-8'));

await build({
  entryPoints: ['src/bin/demux.js'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'dist/demux.mjs',
  define: {
    __DEMUX_VERSION__: JSON.stringify(pkg.version),
  },
  banner: {
    js: [
      '#!/usr/bin/env node',
      "import { createRequire as __createRequire } from 'node:module';",
      'const require = __createRequire(import.meta.url);',
    ].join('\n'),
  },
});

await chmod('dist/demux.mjs', 0o755);
console.log(`built dist/demux.mjs (v${pkg.version})`);
