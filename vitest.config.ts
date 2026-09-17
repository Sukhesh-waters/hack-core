import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // The real package throws outside an RSC bundler; under Vitest the
      // marker is meaningless, so it resolves to the stub.
      "server-only": path.resolve(__dirname, "src/test-utils/server-only.ts"),
    },
  },
});
