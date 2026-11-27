import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Fail when the npm tarball misses a file consumers and coding agents read from
// node_modules, ships a contributor-only file, or llms.txt links a shipped file
// by URL instead of a path inside the tarball. Needs no build; dist/ contents
// are checked by check-package-contents.sh in the publish jobs.
const REQUIRED = [
  "package.json",
  "README.md",
  "LICENSE",
  "CHANGELOG.md",
  "llms.txt",
  "docs/API.md",
  "src/client/index.ts",
  "src/test.ts",
];
const FORBIDDEN = [
  /^AGENTS\.md$/,
  /^CLAUDE\.md$/,
  /^docs\/(?!API\.md$)/,
  /^specs\//,
  /^scripts\//,
  /^example\//,
  /\.(test|spec)\.[cm]?[jt]sx?$/,
];
const REPO_BLOB = /^https:\/\/github\.com\/vllnt\/convex-api-keys\/blob\/[^/]+\/(.+)$/;

const output = execFileSync("pnpm", ["pack", "--dry-run", "--json"], { encoding: "utf8" });
const packed = new Set(JSON.parse(output).files.map((file) => file.path));

const errors = [];
for (const path of REQUIRED) {
  if (!packed.has(path)) errors.push(`missing from tarball: ${path}`);
}
for (const path of packed) {
  if (FORBIDDEN.some((pattern) => pattern.test(path))) errors.push(`must not ship: ${path}`);
}
for (const [, target] of readFileSync("llms.txt", "utf8").matchAll(/\]\(([^)\s]+)\)/g)) {
  const blob = REPO_BLOB.exec(target);
  if (blob && packed.has(blob[1])) {
    errors.push(`llms.txt: ${target} ships in the tarball; link ./${blob[1]}`);
  }
  if (/^[a-z]+:/i.test(target) || target.startsWith("#")) continue;
  const path = target.split("#")[0].replace(/^\.\//, "");
  if (!packed.has(path)) errors.push(`llms.txt: ${target} is not in the tarball`);
}

// npm publish rewrites package.json fields it considers malformed and warns
// about it; `npm pkg fix` applies the same normalisation. Run it on a copy.
const fixDir = mkdtempSync(join(tmpdir(), "pkg-fix-"));
try {
  copyFileSync("package.json", join(fixDir, "package.json"));
  execFileSync("npm", ["pkg", "fix"], { cwd: fixDir, stdio: "ignore" });
  const original = JSON.parse(readFileSync("package.json", "utf8"));
  const fixed = JSON.parse(readFileSync(join(fixDir, "package.json"), "utf8"));
  for (const key of new Set([...Object.keys(original), ...Object.keys(fixed)])) {
    if (JSON.stringify(original[key]) !== JSON.stringify(fixed[key])) {
      errors.push(`package.json: npm publish would rewrite "${key}" to ${JSON.stringify(fixed[key])}`);
    }
  }
} finally {
  rmSync(fixDir, { recursive: true, force: true });
}

if (errors.length > 0) {
  for (const error of errors) console.error(`FAIL ${error}`);
  process.exit(1);
}
console.log(`OK    package: ${packed.size} files, required docs present, llms.txt links resolve`);
