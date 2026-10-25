import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 15_000,
  fullyParallel: true,
  workers: 2,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3101',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --hostname 127.0.0.1 --port 3101',
    url: 'http://127.0.0.1:3101',
    reuseExistingServer: false,
    env: {
      NODE_ENV: 'development',
      NEXT_DIST_DIR: '.next-e2e',
      NL_API_MODE: 'mock',
      NL_API_KEY: '',
      NL_API_CACHE_TTL_MS: '0',
      OCR_SPACE_API_KEY: '',
      TAVILY_API_KEY: '',
      SERPAPI_API_KEY: '',
      YES24_API_KEY: '',
      GEMINI_API_KEY: '',
      AZURE_FOUNDRY_ENDPOINT: '',
      AZURE_FOUNDRY_API_KEY: '',
    },
    timeout: 120_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'] } },
  ],
});
