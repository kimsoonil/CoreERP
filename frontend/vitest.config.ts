import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    clearMocks: true,
    testTimeout: 10000,
    coverage: {
      provider: "v8",
      thresholds: { lines: 95, statements: 80, branches: 80, functions: 80 },
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/test/**", "src/vite-env.d.ts"],
      reporter: ["text", "html", "json-summary", "json"],
    },
  },
});
