import { defineConfig, mergeConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import appConfig from './vite.config.ts';

export default mergeConfig(
  appConfig,
  defineConfig({
    build: {
      outDir: 'cache/verification-dist',
      rolldownOptions: {
        input: {
          calculation: fileURLToPath(
            new URL('../tests/browser/calculation.html', import.meta.url),
          ),
          m1: fileURLToPath(
            new URL('../tests/browser/m1.html', import.meta.url),
          ),
        },
      },
    },
  }),
);
