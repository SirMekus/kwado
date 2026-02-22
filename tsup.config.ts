import { defineConfig } from 'tsup';

export default defineConfig({
  entry:      ['src/index.ts'],
  format:     ['cjs', 'esm'],
  dts:        true,
  clean:      true,
  sourcemap:  true,
  treeshake:  true,
  external: [
    'react',
    'react-hook-form',
    '@hookform/resolvers',
    '@hookform/resolvers/zod',
    'zod',
    '@sirmekus/oku',
  ],
});
