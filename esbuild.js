import esbuild from 'esbuild'

esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  outdir: 'dist',
  platform: 'node',
  target: ['node18'],
  format: 'esm',  // Keep ESM format
  sourcemap: true,
  minify: false,
  packages: 'external', // This marks all node_modules as external
  loader: {
    '.ts': 'ts'
  },
  tsconfig: './tsconfig.json'
}).catch(() => process.exit(1));
