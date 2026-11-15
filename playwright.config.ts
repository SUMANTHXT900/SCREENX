import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30000,
  workers: 1,
  use: {
    headless: false,
    viewport: { width: 1280, height: 800 },
  },
});
