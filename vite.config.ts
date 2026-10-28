import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

function version(): string {
  let sha = process.env.GITHUB_SHA?.slice(0, 7);
  if (!sha) {
    try {
      sha = execSync('git rev-parse --short HEAD').toString().trim();
    } catch {
      sha = 'local';
    }
  }
  return `${new Date().toISOString().slice(0, 10)} ${sha}`;
}

export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(version()) },
  // Older iPhones: translate newer syntax such as ?. and ?? as well.
  build: { target: ['es2019', 'safari13'], sourcemap: false, chunkSizeWarningLimit: 900 }, // big chunk = lazily loaded border data
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
} as any);
