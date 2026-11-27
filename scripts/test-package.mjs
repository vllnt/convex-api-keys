import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

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

const output = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
  encoding: "utf8",
});
const packed = new Set(
  JSON.parse(output)[0].files.map((file) => file.path.replace(/^package\//, "")),
);

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

if (errors.length > 0) {
  for (const error of errors) console.error(`FAIL ${error}`);
  process.exit(1);
}
console.log(`OK    package: ${packed.size} files, required docs present, llms.txt links resolve`);
