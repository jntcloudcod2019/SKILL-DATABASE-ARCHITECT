import { defineConfig } from '@playwright/test';

// E2E specs live in tests/e2e and start their own Studio server (see tests/e2e/studio.spec.ts).
export default defineConfig({ testDir: 'tests/e2e', timeout: 60_000, use: { headless: true } });
