import { defineConfig } from "@playwright/test";
import { BACKEND, E2E_DB } from "./e2e/helpers";

export default defineConfig({
  testDir: "e2e",
  outputDir: "e2e/test-results",
  reporter: "list",
  use: { baseURL: "http://localhost:5174" },
  webServer: [
    {
      command:
        "uv run -m backend.seed && uv run -m uvicorn backend.main:app --port 8001",
      url: `${BACKEND}/api/health`,
      env: { UNDERCOVER_DB: E2E_DB },
      reuseExistingServer: false,
    },
    {
      command: "npx vite dashboard --port 5174 --strictPort",
      url: "http://localhost:5174",
      env: { BACKEND_URL: BACKEND },
      reuseExistingServer: false,
    },
  ],
});
