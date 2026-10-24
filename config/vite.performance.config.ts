import { defineConfig, mergeConfig } from 'vite';
import { cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import appConfig from './vite.config.ts';

// Keep the actual product assets intact. The measurement entry is built
// separately, then the preceding product build is copied alongside it.
export default mergeConfig(
  appConfig,
  defineConfig({
    build: {
      outDir: 'cache/performance-dist',
      rolldownOptions: {
        input: fileURLToPath(
          new URL('../tests/browser/performance.html', import.meta.url),
        ),
      },
    },
    plugins: [
      {
        name: 'copy-product-for-performance',
        apply: 'build',
        closeBundle() {
          cpSync('dist', 'cache/performance-dist', { recursive: true });
        },
      },
    ],
  }),
);
