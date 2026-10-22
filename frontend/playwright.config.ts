import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5174',
    ...(process.env.CI ? {} : { channel: 'msedge' }),
    headless: true,
    viewport: { width: 1360, height: 840 },
    locale: 'es-PE',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `${process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'} exec vite --host localhost --port 5174 --strictPort`,
    url: 'http://localhost:5174',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
