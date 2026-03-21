import convex from "@vllnt/eslint-config/convex";

export default [
  { ignores: ["example/**", "dist/**", "src/component/_generated/**"] },
  ...convex,
];
