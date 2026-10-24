import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'carrycheck-third-party-notices',
      apply: 'build',
      generateBundle() {
        // CSS と管理下の UI ソースは Vite の JS 依存収集に含まれない。
        this.emitFile({
          type: 'asset',
          fileName: 'LICENSE.md',
          source: readFileSync(
            new URL('../LICENSE.md', import.meta.url),
            'utf8',
          ),
        });
      },
    },
  ],
  build: { license: { fileName: 'THIRD_PARTY_LICENSES.md' } },
  resolve: {
    alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    fs: {
      // deny は既定値を置換するため、Vite 8 の既定の拒否対象も維持する。
      deny: [
        '.env',
        '.env.*',
        '*.{crt,pem,key,p12,pfx,cer,der}',
        '.npmrc',
        '.yarnrc.yml',
        '**/.git/**',
        // LAN での実機確認時にも、住宅資料やローカル作業状態を配信しない。
        '**/references/**',
        '**/cache/**',
        '**/.codex/**',
        '**/.claude/**',
        '**/.mcp.json',
        '**/*.local.*',
      ],
    },
  },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  worker: { format: 'es' },
});
