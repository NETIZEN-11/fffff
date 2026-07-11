import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/**",
        "src/tests/**",
        "**/*.d.ts",
        "**/*.config.*",
        "prisma/**",
        ".next/**",
      ],
    },
    // Only pick up *.test.ts(x) files — Playwright uses *.spec.ts and has its own runner
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: [
      "node_modules",
      ".next",
      "src/tests/e2e/**",
      "playwright.config.ts",
    ],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
