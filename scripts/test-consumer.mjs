import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Install the packed tarball in a clean pnpm project outside the repo, as a
// consumer would, and fail when an entry point does not load or type-check.
// Run by `pnpm test:package`, so CI's Test job and the publish quality gate
// run it before every release. One install; no test runner.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

// Pin each tool to the exact version the repo's lockfile installed.
function pin(name) {
  const spec = pkg.devDependencies[name];
  const { version } = JSON.parse(
    readFileSync(join(ROOT, "node_modules", name, "package.json"), "utf8"),
  );
  return spec.startsWith("npm:") ? spec.replace(/@[^@/]+$/, `@${version}`) : version;
}

// Runtime entry points. `./_generated/component(.js)` export types only, and
// `./test` is source that calls Vite's `import.meta.glob`, which only a Vite
// or Vitest transform defines, so those three are type-checked, not imported.
// `./convex.config(.js)` only evaluates inside the Convex CLI bundler, which
// sets the `componentDefinitionPath` that `component.use()` needs, so node
// resolves it and its child component from inside the package instead.
const RUNTIME = `
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { ApiKeys } from "${pkg.name}";

const installed = createRequire(import.meta.url)("${pkg.name}/package.json");
assert.equal(installed.version, "${pkg.version}", "installed package.json version");
assert.ok(new ApiKeys({}) instanceof ApiKeys, "ApiKeys is an exported class");

const config = fileURLToPath(import.meta.resolve("${pkg.name}/convex.config"));
const configJs = fileURLToPath(import.meta.resolve("${pkg.name}/convex.config.js"));
assert.ok(existsSync(config), "convex.config is in the tarball");
assert.equal(configJs, config, "convex.config.js resolves to the same file");
createRequire(config).resolve("@convex-dev/sharded-counter/convex.config.js");
`;

// A host app that uses every entry point under `strict: true`.
const CONSUMER = `
import {
  ApiKeys,
  type ApiKeysConfig,
  type KeyMetadata,
  type KeyStatus,
  type ValidationResult,
} from "${pkg.name}";
import apiKeys from "${pkg.name}/convex.config";
import apiKeysJs from "${pkg.name}/convex.config.js";
import apiKeysTest, { register } from "${pkg.name}/test";
import type { ComponentApi } from "${pkg.name}/_generated/component";
import type { ComponentApi as ComponentApiJs } from "${pkg.name}/_generated/component.js";
import {
  actionGeneric,
  defineApp,
  httpActionGeneric,
  httpRouter,
  mutationGeneric,
  queryGeneric,
} from "convex/server";
import { v } from "convex/values";
import { convexTest } from "convex-test";

const app = defineApp();
app.use(apiKeys);
app.use(apiKeysJs, { name: "serviceKeys" });
export default app;

// What \`convex codegen\` writes to convex/_generated/api.d.ts for these mounts.
declare const components: {
  apiKeys: ComponentApi<"apiKeys">;
  serviceKeys: ComponentApiJs<"serviceKeys">;
};

const config: ApiKeysConfig = { prefix: "app", defaultType: "secret" };
const keys = new ApiKeys(components.apiKeys, config);
const serviceKeys = new ApiKeys(components.serviceKeys);

export const createKey = mutationGeneric({
  args: { ownerId: v.string() },
  handler: async (ctx, { ownerId }): Promise<{ keyId: string; valid: boolean }> => {
    const { keyId, key } = await keys.create(ctx, { name: "default", ownerId });
    const result: ValidationResult = await keys.validate(ctx, { key });
    return { keyId, valid: result.valid };
  },
});

export const listKeys = queryGeneric({
  args: { ownerId: v.string() },
  handler: async (ctx, { ownerId }): Promise<KeyMetadata[]> => await keys.list(ctx, { ownerId }),
});

export const rotateKey = actionGeneric({
  args: { keyId: v.string(), ownerId: v.string() },
  handler: async (ctx, args): Promise<KeyStatus | null> => {
    const { newKey } = await serviceKeys.rotate(ctx, args);
    return await serviceKeys.matchStatus(ctx, { key: newKey });
  },
});

export const me = httpActionGeneric(async (ctx, request) => {
  const key = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const result = await keys.validate(ctx, { key });
  if (!result.valid) return new Response(result.reason, { status: 401 });
  return Response.json({ ownerId: result.ownerId, scopes: result.scopes });
});

export const http = httpRouter();
http.route({ path: "/me", method: "GET", handler: me });

export function setupTest() {
  const t = convexTest();
  register(t);
  apiKeysTest.register(t, "serviceKeys");
  return t;
}
`;

// The compiler options `npx convex dev` writes to convex/tsconfig.json.
const TSCONFIG = {
  compilerOptions: {
    strict: true,
    target: "ESNext",
    lib: ["ES2023", "dom"],
    module: "ESNext",
    moduleResolution: "Bundler",
    isolatedModules: true,
    forceConsistentCasingInFileNames: true,
    skipLibCheck: true,
    noEmit: true,
  },
  include: ["consumer.ts"],
};

// Every `exports` subpath must be imported, resolved or type-checked above:
// collect the package specifiers RUNTIME and CONSUMER use and compare.
const specifier = new RegExp(`["']${pkg.name}(/[^"']+)?["']`, "g");
const covered = new Set(
  [...(RUNTIME + CONSUMER).matchAll(specifier)].map(([, sub]) => (sub ? `.${sub}` : ".")),
);
const exported = new Set(Object.keys(pkg.exports));
const gaps = [
  ...[...exported].filter((sub) => !covered.has(sub)).map((sub) => `exports subpath ${sub} is not covered`),
  ...[...covered].filter((sub) => !exported.has(sub)).map((sub) => `${sub} is covered but not in exports`),
];
if (gaps.length > 0) {
  for (const gap of gaps) console.error(`FAIL consumer: ${gap}`);
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), "consumer-"));
let step = "build";
try {
  execFileSync(join(ROOT, "node_modules/.bin/tsc"), ["--project", "tsconfig.build.json"], {
    cwd: ROOT,
    stdio: "inherit",
  });
  step = "pnpm pack";
  execFileSync("pnpm", ["pack", "--pack-destination", dir], { cwd: ROOT, stdio: "ignore" });
  const tarball = readdirSync(dir).find((file) => file.endsWith(".tgz"));

  step = "pnpm install";
  const manifest = {
    name: "consumer",
    private: true,
    type: "module",
    dependencies: { [pkg.name]: `file:./${tarball}`, convex: pin("convex") },
    devDependencies: {
      "convex-test": pin("convex-test"),
      // The `tsc` that `pnpm build` and `pnpm typecheck` run.
      typescript: pin("@typescript/native"),
      vite: pin("vite"),
    },
    // Same release-age, override and build-script policy as the repo.
    pnpm: pkg.pnpm,
  };
  writeFileSync(join(dir, "package.json"), JSON.stringify(manifest, null, 2));
  execFileSync("pnpm", ["install", "--no-frozen-lockfile", "--reporter=silent"], {
    cwd: dir,
    stdio: "inherit",
  });

  step = "runtime import";
  writeFileSync(join(dir, "runtime.mjs"), RUNTIME);
  execFileSync(process.execPath, ["runtime.mjs"], { cwd: dir, stdio: "inherit" });

  step = "type-check";
  writeFileSync(join(dir, "consumer.ts"), CONSUMER);
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify(TSCONFIG, null, 2));
  execFileSync(join(dir, "node_modules/.bin/tsc"), ["--project", "tsconfig.json"], {
    cwd: dir,
    stdio: "inherit",
  });
} catch (error) {
  console.error(`FAIL consumer: ${step} failed in a clean project with the packed tarball`);
  console.error(`      ${String(error.message).split("\n")[0]}`);
  process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
if (process.exitCode !== 1) {
  console.log("OK    consumer: packed tarball installs, imports and type-checks in a clean project");
}
