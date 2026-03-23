import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    exclude: ["**/node_modules/**", "dist/**"],
    typecheck: {
      tsconfig: "./tsconfig.test.json",
    },
    coverage: {
      include: [
        "src/shared.ts",
        "src/log.ts",
        "src/test.ts",
        "src/client/index.ts",
        "src/component/mutations.ts",
        "src/component/queries.ts",
        "src/component/validators.ts",
        "src/component/schema.ts",
        "example/convex/example.ts",
      ],
    },
  },
});
