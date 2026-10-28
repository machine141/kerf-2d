import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
// Single self-contained HTML build (works offline, publishable as one page).
export default defineConfig({
  plugins: [viteSingleFile()],
  build: { target: 'es2022', assetsInlineLimit: 100000000, cssCodeSplit: false },
  test: { globals: true, environment: 'happy-dom', include: ['tests/**/*.test.ts'] },
});
