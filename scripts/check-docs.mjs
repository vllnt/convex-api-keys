import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";

// Agent-first docs check, run by `pnpm test:package` (and so by CI's Test job).
// Fails when the README loses a required section or its order, the install
// command or first example moves below line 40, a code block has no language
// or a `...` gap, a relative link or anchor breaks, a public export lacks TSDoc
// or a README/API entry, an error message is missing from "Errors and fixes",
// or a README TypeScript example stops type-checking against the built package.

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const read = (file) => readFileSync(join(ROOT, file), "utf8");
const errors = [];
const fail = (message) => errors.push(message);

const README = read("README.md");
const API = read("docs/API.md");
const LLMS = read("llms.txt");
const readmeLines = README.split("\n");

// ── Sections ─────────────────────────────────────────────────────────────────
const REQUIRED = [
  "For coding agents",
  "When to use",
  "Install",
  "Quick start",
  "API",
  "Common tasks",
  "Errors and fixes",
  "Limits and gotchas",
  "Compatibility",
];
const AFTER = [
  "Testing",
  "Security",
  "Related packages",
  "Contributing",
  "License",
];
const pkg = JSON.parse(read("package.json"));

function headings(markdown) {
  const out = [];
  let fenced = false;
  markdown.split("\n").forEach((line, index) => {
    if (line.startsWith("```")) fenced = !fenced;
    const match = !fenced && /^(#{1,6}) (.+)$/.exec(line);
    if (match)
      out.push({
        level: match[1].length,
        text: match[2].trim(),
        line: index + 1,
      });
  });
  return out;
}

const readmeHeadings = headings(README);
if (readmeLines[0] !== `# ${pkg.name}`)
  fail(`README line 1 must be "# ${pkg.name}"`);
const h2 = readmeHeadings.filter((h) => h.level === 2).map((h) => h.text);
if (JSON.stringify(h2.slice(0, REQUIRED.length)) !== JSON.stringify(REQUIRED)) {
  fail(
    `README must start with sections ${REQUIRED.join(" > ")}; found ${h2.slice(0, REQUIRED.length).join(" > ")}`,
  );
}
const rest = h2.slice(REQUIRED.length);
let cursor = -1;
for (const name of AFTER) {
  const at = rest.indexOf(name);
  if (at === -1) fail(`README is missing "## ${name}"`);
  else if (at < cursor) fail(`README "## ${name}" is out of order`);
  else cursor = at;
}

function section(markdown, name) {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => l === `## ${name}`);
  if (start === -1) return "";
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  return lines.slice(start + 1, end === -1 ? undefined : end).join("\n");
}

const agentsNote = section(README, "For coding agents")
  .trim()
  .split("\n")
  .filter(Boolean);
if (agentsNote.length === 0 || agentsNote.length > 3)
  fail(`"For coding agents" must be 1 to 3 lines (has ${agentsNote.length})`);
const whenToUse = section(README, "When to use");
const useBullets = (whenToUse.match(/^- Use it when /gm) ?? []).length;
const avoidBullets = (whenToUse.match(/^- Do not use it when /gm) ?? []).length;
if (useBullets < 2 || useBullets > 4)
  fail(
    `"When to use" needs 2 to 4 "- Use it when" bullets (has ${useBullets})`,
  );
if (avoidBullets < 1 || avoidBullets > 3)
  fail(
    `"When to use" needs 1 to 3 "- Do not use it when" bullets (has ${avoidBullets})`,
  );

const installLine =
  readmeLines.findIndex((l) =>
    /^(npm|pnpm) (install|add) .*@vllnt\/convex-api-keys/.test(l),
  ) + 1;
if (installLine === 0 || installLine > 40)
  fail(
    `the install command must be within README lines 1-40 (line ${installLine || "none"})`,
  );
const quickStart = readmeHeadings.find((h) => h.text === "Quick start");
const firstExample =
  quickStart &&
  readmeLines.findIndex(
    (l, i) => i >= quickStart.line && l.startsWith("```ts"),
  ) + 1;
if (!firstExample || firstExample > 40)
  fail(
    `the first Quick start example must start within README lines 1-40 (line ${firstExample || "none"})`,
  );
const badge =
  readmeLines.findIndex(
    (l) => l.includes("img.shields.io") || l.includes("badge.svg"),
  ) + 1;
const apiHeading = readmeHeadings.find((h) => h.text === "API");
if (badge && apiHeading && badge < apiHeading.line)
  fail(`badges must sit below the Quick start (line ${badge})`);

// ── package.json metadata ───────────────────────────────────────────────────
if (typeof pkg.description !== "string" || pkg.description.length > 160)
  fail(
    "package.json description must be one sentence of at most 160 characters",
  );
if (
  !Array.isArray(pkg.keywords) ||
  pkg.keywords.length < 8 ||
  pkg.keywords.length > 12
)
  fail("package.json keywords must have 8 to 12 entries");
const NAME = pkg.name.replace(/^@[^/]+\//, "");
if (pkg.homepage !== `https://oss.vllnt.com/packages/${NAME}`)
  fail(`package.json homepage must be https://oss.vllnt.com/packages/${NAME}`);
if (
  pkg.author?.url !== "https://bntvllnt.com" ||
  !pkg.funding?.url ||
  pkg.bugs?.url !== `https://github.com/vllnt/${NAME}/issues`
) {
  fail(
    "package.json author.url, funding and bugs.url must match the vllnt package shape",
  );
}

// ── Backlinks ────────────────────────────────────────────────────────────────
const FOOTER = `---\n\nPart of [vllnt open source](https://oss.vllnt.com) · [Package page](https://oss.vllnt.com/packages/${NAME}) · [vllnt.com](https://vllnt.com) · Built by [bntvllnt](https://bntvllnt.com)\n`;
if (!README.endsWith(FOOTER))
  fail(
    'README must end with the vllnt footer (--- then the "Part of [vllnt open source]..." line)',
  );
const LLMS_ECOSYSTEM = `## Ecosystem\n\n- [Package page](https://oss.vllnt.com/packages/${NAME})\n- [All @vllnt packages](https://oss.vllnt.com/llms.txt)\n- [vllnt](https://vllnt.com/llms.txt)\n- [Author](https://bntvllnt.com)\n`;
if (!LLMS.endsWith(LLMS_ECOSYSTEM))
  fail("llms.txt must end with the vllnt Ecosystem block");
if (LLMS.split("https://oss.vllnt.com/llms.txt").length !== 2)
  fail("llms.txt must link https://oss.vllnt.com/llms.txt exactly once");
for (const file of ["README.md", "docs/API.md", "llms.txt", "CHANGELOG.md"]) {
  for (const [, label, url] of read(file).matchAll(
    /\[`?(@vllnt\/[a-z0-9-]+)`?\]\(([^)]+)\)/g,
  )) {
    if (label === pkg.name) continue;
    const other = label.slice("@vllnt/".length);
    if (
      url !== `https://oss.vllnt.com/packages/${other}` &&
      url !== `https://www.npmjs.com/package/${label}`
    ) {
      fail(
        `${file}: ${label} must link https://oss.vllnt.com/packages/${other}`,
      );
    }
  }
}

// ── Code blocks ──────────────────────────────────────────────────────────────
const LANGUAGES = new Set(["ts", "bash", "text"]);
function codeBlocks(markdown, file) {
  const blocks = [];
  const lines = markdown.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("```")) continue;
    const lang = lines[i].slice(3).trim();
    const end = lines.findIndex((l, j) => j > i && l.startsWith("```"));
    if (end === -1) {
      fail(`${file}:${i + 1} code block is not closed`);
      break;
    }
    blocks.push({
      lang,
      code: lines.slice(i + 1, end).join("\n"),
      line: i + 1,
      file,
    });
    i = end;
  }
  return blocks;
}
const mentions = (text, name) =>
  [`\`${name}\``, `\`${name}(`, `\`${name}<`].some((n) => text.includes(n));
const blocks = [
  ...codeBlocks(README, "README.md"),
  ...codeBlocks(API, "docs/API.md"),
];
for (const block of blocks) {
  if (!LANGUAGES.has(block.lang))
    fail(
      `${block.file}:${block.line} code block needs a language tag (ts, bash or text), has "${block.lang}"`,
    );
  if (block.lang === "ts" && /\.\.\.(?![\w$({[])/.test(block.code))
    fail(`${block.file}:${block.line} code block has a "..." gap`);
}

// ── Links ────────────────────────────────────────────────────────────────────
const slug = (text) =>
  text
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .replace(/ /g, "-");
const anchorCache = new Map();
function anchors(file) {
  if (!anchorCache.has(file))
    anchorCache.set(
      file,
      new Set(headings(read(file)).map((h) => slug(h.text))),
    );
  return anchorCache.get(file);
}
for (const file of ["README.md", "docs/API.md", "llms.txt", "CHANGELOG.md"]) {
  const text = read(file).replace(/```[\s\S]*?```/g, "");
  for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^[a-z]+:/i.test(target)) continue;
    const [path, hash] = target.split("#");
    const dest = path ? join(dirname(file), path) : file;
    if (!existsSync(join(ROOT, dest)))
      fail(`${file}: link ${target} does not resolve`);
    else if (hash && dest.endsWith(".md") && !anchors(dest).has(hash))
      fail(`${file}: link ${target} has no heading #${hash}`);
  }
}

// ── llms.txt ─────────────────────────────────────────────────────────────────
for (const needle of [
  "## When to use",
  "](./docs/API.md",
  "](./README.md#errors-and-fixes)",
]) {
  if (!LLMS.includes(needle)) fail(`llms.txt must contain ${needle}`);
}

// ── Exports: TSDoc, README API table, docs/API.md ────────────────────────────
const ENTRIES = {
  "@vllnt/convex-api-keys": "src/client/index.ts",
  "@vllnt/convex-api-keys/convex.config": "src/component/convex.config.ts",
  "@vllnt/convex-api-keys/test": "src/test.ts",
  "@vllnt/convex-api-keys/_generated/component":
    "src/component/_generated/component.ts",
};
const GENERATED = /\/_generated\//;
const program = ts.createProgram(
  Object.values(ENTRIES).map((f) => join(ROOT, f)),
  {
    strict: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2022,
    types: ["vite/client"],
    skipLibCheck: true,
    noEmit: true,
  },
);
const checker = program.getTypeChecker();
const apiSection = section(README, "API");
const hasDoc = (symbol) =>
  ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim()
    .length > 0;

for (const [entry, file] of Object.entries(ENTRIES)) {
  const source = program.getSourceFile(join(ROOT, file));
  const moduleSymbol = source && checker.getSymbolAtLocation(source);
  if (!moduleSymbol) {
    fail(`cannot read exports of ${file}`);
    continue;
  }
  for (let symbol of checker.getExportsOfModule(moduleSymbol)) {
    const name = symbol.getName();
    const label =
      name === "default" ? `${entry} default export` : `${name} (${entry})`;
    if (symbol.flags & ts.SymbolFlags.Alias)
      symbol = checker.getAliasedSymbol(symbol);
    if (!GENERATED.test(file) && !hasDoc(symbol))
      fail(`TSDoc summary missing: ${label}`);
    const row = apiSection
      .split("\n")
      .find(
        (l) =>
          l.startsWith("|") &&
          (name === "default"
            ? l.includes(`\`${entry}\``)
            : mentions(l, name) &&
              (entry === "@vllnt/convex-api-keys" ||
                l.includes(`\`${entry}\``))),
      );
    if (!row) fail(`README "## API" table has no row for ${label}`);
    else if (!/\]\(\.\/docs\/API\.md#[^)]+\)/.test(row))
      fail(`README "## API" row for ${label} must link into docs/API.md`);
    if (
      name !== "default" &&
      !mentions(API, name) &&
      !API.includes(`### ${name}`)
    )
      fail(`docs/API.md does not document ${label}`);
    if (name === "ApiKeys") {
      for (const member of checker.getPropertiesOfType(
        checker.getDeclaredTypeOfSymbol(symbol),
      )) {
        const decl = member.valueDeclaration;
        const modifiers =
          decl && ts.canHaveModifiers(decl)
            ? (ts.getModifiers(decl) ?? [])
            : [];
        if (modifiers.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword))
          continue;
        const method = member.getName();
        if (!hasDoc(member)) fail(`TSDoc summary missing: ApiKeys.${method}`);
        if (
          !apiSection.includes(`\`${method}(`) &&
          !apiSection.includes(`\`apiKeys.${method}`) &&
          method !== "component"
        ) {
          fail(`README "## API" table has no row for ApiKeys.${method}`);
        }
        if (method !== "component" && !API.includes(`### ${method}(`))
          fail(`docs/API.md has no "### ${method}(" heading`);
      }
      const ctor = symbol.members?.get("__constructor");
      if (!ctor || !hasDoc(ctor))
        fail("TSDoc summary missing: ApiKeys constructor");
    }
  }
}

// ── Errors: every thrown message and validation reason is in the table ──────
const errorsTable = section(README, "Errors and fixes")
  .split("\n")
  .filter((l) => l.startsWith("|"));
const firstCells = errorsTable.map((l) => l.split("|")[1] ?? "");
const documented = firstCells.flatMap((cell) =>
  [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]),
);
function sourceFiles(dir) {
  return execFileSync("git", ["ls-files", dir], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter(
      (f) => f.endsWith(".ts") && !/\.test\.ts$/.test(f) && !GENERATED.test(f),
    );
}
const thrown = [];
for (const file of sourceFiles("src")) {
  const source = ts.createSourceFile(
    file,
    read(file),
    ts.ScriptTarget.ES2022,
    true,
  );
  const visit = (node) => {
    if (
      ts.isThrowStatement(node) &&
      node.expression &&
      ts.isNewExpression(node.expression)
    ) {
      const [arg] = node.expression.arguments ?? [];
      if (
        arg &&
        (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))
      )
        thrown.push({ file, text: arg.text, re: null });
      else if (arg && ts.isTemplateExpression(arg)) {
        const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const pattern =
          escape(arg.head.text) +
          arg.templateSpans.map((s) => ".+" + escape(s.literal.text)).join("");
        thrown.push({
          file,
          text: arg.getText(),
          re: new RegExp(`^${pattern}$`),
        });
      } else
        fail(
          `${file}: thrown error without a literal message: ${node.getText().slice(0, 60)}`,
        );
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}
for (const error of thrown) {
  const ok = error.re
    ? documented.some((d) => error.re.test(d))
    : documented.includes(error.text);
  if (!ok)
    fail(
      `README "## Errors and fixes" does not list ${error.text} (${error.file})`,
    );
}
const reasons = [
  ...read("src/client/types.ts").matchAll(/^\s+\| "([a-z_]+)"/gm),
].map((m) => m[1]);
for (const reason of new Set(reasons)) {
  if (!documented.includes(`reason: "${reason}"`))
    fail(
      `README "## Errors and fixes" does not list validate() reason: "${reason}"`,
    );
}

// ── README TypeScript examples type-check against the built package ─────────
execFileSync(
  join(ROOT, "node_modules/.bin/tsc"),
  ["--project", "tsconfig.build.json"],
  { cwd: ROOT, stdio: "inherit" },
);
const HOST = join(ROOT, "example/convex");
// A host app's schema, for examples that import "./schema" (the example app has none).
const HOST_SCHEMA = [
  'import { defineSchema, defineTable } from "convex/server";',
  'import { v } from "convex/values";',
  "export default defineSchema({ projects: defineTable({ name: v.string() }) });",
].join("\n");
const virtual = new Map();
virtual.set(join(HOST, "schema.ts"), HOST_SCHEMA);
const readmeTs = codeBlocks(README, "README.md").filter((b) => b.lang === "ts");
readmeTs.forEach((block, i) =>
  virtual.set(join(HOST, `readme_example_${i}.ts`), block.code + "\n"),
);
const options = {
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  target: ts.ScriptTarget.ES2022,
  lib: ["lib.es2023.d.ts", "lib.dom.d.ts"],
  types: ["vite/client"],
  isolatedModules: true,
};
const host = ts.createCompilerHost(options);
const { fileExists, readFile, getSourceFile } = host;
host.fileExists = (f) => virtual.has(f) || fileExists.call(host, f);
host.readFile = (f) => virtual.get(f) ?? readFile.call(host, f);
host.getSourceFile = (f, lang, ...rest) =>
  virtual.has(f)
    ? ts.createSourceFile(f, virtual.get(f), lang)
    : getSourceFile.call(host, f, lang, ...rest);
const examples = ts.createProgram(
  readmeTs.map((_, i) => join(HOST, `readme_example_${i}.ts`)),
  options,
  host,
);
for (const diagnostic of ts.getPreEmitDiagnostics(examples)) {
  const file = diagnostic.file?.fileName ?? "";
  const index = /readme_example_(\d+)\.ts$/.exec(file)?.[1];
  const where =
    index === undefined
      ? file
      : `README.md:${readmeTs[Number(index)].line + 1 + diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line}`;
  fail(
    `${where}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`,
  );
}

// ── Shipped files: no vllnt.ai, @see on the main entry ──────────────────────
const packed = JSON.parse(
  execFileSync("pnpm", ["pack", "--dry-run", "--json"], {
    cwd: ROOT,
    encoding: "utf8",
  }),
).files.map((f) => f.path);
for (const file of packed) {
  if (/vllnt\.ai/i.test(readFileSync(join(ROOT, file), "utf8")))
    fail(`${file} mentions vllnt.ai; use the vllnt.com URL`);
}
const SEE = `@see https://oss.vllnt.com/packages/${NAME}`;
if (!read("dist/client/index.d.ts").includes(SEE))
  fail(`dist/client/index.d.ts must carry "${SEE}" on the main export`);

if (errors.length > 0) {
  for (const message of errors) console.error(`FAIL ${message}`);
  process.exit(1);
}
console.log(
  `OK    docs: ${REQUIRED.length} README sections in order, ${blocks.length} code blocks, ${readmeTs.length} README examples type-check, ${thrown.length} errors documented`,
);
