import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    exclude: ["**/node_modules/**", "dist/**"],
    coverage: {
      include: [
        "src/shared.ts",
        "src/log.ts",
        "src/test.ts",
        "src/client/index.ts",
        "src/component/public.ts",
        "src/component/schema.ts",
        "example/convex/example.ts",
      ],
    },
  },
});
