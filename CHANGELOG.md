# Changelog

## [Unreleased]

## [0.4.0] - 2026-11-27

### Added

- The npm package now ships `docs/API.md`, `CHANGELOG.md` and `llms.txt`, so
  coding agents can read docs that match the installed version from
  `node_modules/@vllnt/convex-api-keys/`. `llms.txt` links shipped files by
  relative path. `pnpm test:package` (run by `pnpm test` and
  `pnpm test:coverage`) fails when one of them is missing from the tarball.
- `docs/API.md` documents the package entry points and exported types.
- Every public export and `ApiKeys` method has a TSDoc summary, shipped in the
  `.d.ts` files; `ApiKeys` links its package page with `@see`.
- `pnpm test:package` runs `scripts/check-docs.mjs`. It fails when a README
  section is missing or out of order, a code block has no language, a relative
  link or anchor breaks, an export or error message is undocumented, a README
  TypeScript example does not type-check against the built package, or the
  vllnt footer, `llms.txt` ecosystem block or package metadata drift.

### Changed

- **Behaviour change: `revoke()` keeps a final status final.** On a key whose
  stored status is `expired` or `exhausted` it now does nothing, as it already
  did for a `revoked` key: the status and `revokedAt` stay as they are and no
  `key.revoked` log entry is written. Before, it changed the status to `revoked`
  and set `revokedAt`. It still returns without error. If your app read
  `status === "revoked"` or `revokedAt` to mean "revoke was called", also treat
  `expired` and `exhausted` as final.
- Canary releases publish on every push to `main` that touches the package or
  its shipped docs; a repository variable no longer gates them.
- `homepage` points to https://oss.vllnt.com/packages/convex-api-keys.
- Update `@convex-dev/sharded-counter` to `^0.2.4`.
- The README is organised for coding agents: When to use, Install, Quick
  start, an API table of every export, Common tasks, an Errors and fixes table
  of every message and `validate` reason, Limits and gotchas, and
  Compatibility. `llms.txt` carries the same summary and links.
- `package.json` `description` and `keywords` describe what the package does.

### Fixed

- `package.json` `repository.url` uses the form npm expects, so publishing no
  longer prints an auto-correction warning. `pnpm test:package` fails when
  `npm pkg fix` would rewrite any field.
- `RunMutationCtx` and `RunQueryCtx` accept action and HTTP action contexts.
  They were `Pick`s of the mutation and query context types, which an action
  `ctx` does not satisfy (checked with `convex` 1.45.0 and 1.51.0), so calling
  `ApiKeys` methods from an action or HTTP action failed to type-check. They
  are now interfaces with only the `runMutation` / `runQuery` call, for public
  and internal function references.

## [0.3.0] - 2026-11-26

### Added

- `matchStatus` query (component `queries.matchStatus` and client
  `matchStatus(ctx, { key })`): the stored status of the key matching a key
  string, or `null` for a malformed or unknown key. Read-only, so a caller can
  refuse revoked, disabled, expired or exhausted keys without running the
  `validate` mutation. `validate` and `matchStatus` share one key lookup.

### Fixed

- Reject `NaN` and `Infinity` for `expiresAt`, and `NaN`, `Infinity`, fractional
  values for `remaining`. They previously compared as "not expired" and "not
  exhausted", producing keys that never expired or never ran out.
- Reject a `NaN` `gracePeriodMs` in `rotate()`. It previously slipped past the
  range check and left the old key valid forever.
- Reject non-finite `cleanupIntervalMs` and `defaultExpiryMs` in `configure()`.
- Reject an empty `ownerId` or `name` in `create()`, an empty `name` in
  `update()`, and an empty or malformed `tag` in `revokeByTag()`.
- Reject a non-positive or non-integer `limit` in `list()` and `listByTag()`.
- Keep expired keys terminal across repeated validation, restrict rotation to
  active unlimited-use keys, and cap the old key's grace window at its absolute
  expiry.
- Stop shipping unit-test files in the npm package.

### Changed

- `listByTag` stops reading once it has `limit` matches instead of collecting every key the
  owner ever had (including revoked and expired history) before filtering.
- **Peer range**: requires `convex@^1.45.0` (0.2.0 required `^1.36.1`).
- **License**: relicensed from Apache-2.0 to MIT.
- Enforce the documented 100% statement, branch, function, and line coverage
  gate.
- Treat Convex `_generated` output as CLI-owned, exclude it from formatting, and
  expose a dedicated codegen script.
- Update `@convex-dev/sharded-counter` to `^0.2.3`.
- README documents installing the stable release, how to use `/test` in a
  consuming app (`convex-test` and `vitest` are required there), and that scope
  and rate-limit enforcement belong to the host.
- Releases are published from CI only (trusted publishing with provenance);
  stable versions come from `v*.*.*` tags.

## [0.2.0] - 2026-04-25

### Breaking Changes

- **Convex compatibility**: this release targets `convex@^1.36.1` and
  `convex-test@^0.0.50`.
- **`create()` / `rotate()`**: Secret material (lookupPrefix, secretHex, hash)
  now generated server-side. Remove these from client args.
- **Admin mutations** (`revoke`, `disable`, `enable`, `update`, `rotate`,
  `getUsage`): `ownerId` is now a required argument for auth boundary
  enforcement.
- **`apiKeyEvents` table removed**: Audit trail replaced with structured logging
  (Convex dashboard). Export existing event data before upgrading.
- **`@convex-dev/rate-limiter` removed**: Rate limiting is now the integrator's
  responsibility at their HTTP action/mutation layer. Remove
  `rateLimiterTest.register()` from test setup.
- **`@convex-dev/aggregate` and `@convex-dev/crons` removed**: Remove
  `aggregateTest.register()` and `cronsTest.register()` from test setup.
- **`getUsage()`**: `period` param removed (counter-only). `lastUsedAt` removed
  from return type.
- **`validate()`**: `retryAfter` removed from failure response (no internal rate
  limiting).
- **`list()` / `listByTag()`**: Now paginated with `limit` param (default 100).

### Migration Guide

```ts
// BEFORE (v0.1)
const { key } = await apiKeys.create(ctx, {
  name: "My Key",
  ownerId: "org_1",
  lookupPrefix,
  secretHex,
  hash, // ← REMOVE these
});
await apiKeys.revoke(ctx, { keyId });
await apiKeys.rotate(ctx, { keyId, lookupPrefix, secretHex });
const usage = await apiKeys.getUsage(ctx, { keyId, period: { start, end } });

// AFTER (v0.2)
const { key } = await apiKeys.create(ctx, {
  name: "My Key",
  ownerId: "org_1",
  // secret material generated server-side
});
await apiKeys.revoke(ctx, { keyId, ownerId: "org_1" }); // ← ADD ownerId
await apiKeys.rotate(ctx, { keyId, ownerId: "org_1" }); // ← ADD ownerId
const usage = await apiKeys.getUsage(ctx, { keyId, ownerId: "org_1" }); // ← ADD ownerId, REMOVE period
```

Test setup:

```ts
// BEFORE
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import aggregateTest from "@convex-dev/aggregate/test";
import cronsTest from "@convex-dev/crons/test";
rateLimiterTest.register(t, "apiKeys/rateLimiter");
aggregateTest.register(t, "apiKeys/usageAggregate");
cronsTest.register(t, "apiKeys/crons");

// AFTER — only shardedCounter remains
import shardedCounterTest from "@convex-dev/sharded-counter/test";
shardedCounterTest.register(t, "apiKeys/shardedCounter");
```

### New Features

- Public client wrapper now forwards optional `limit` to `list()` and
  `listByTag()`
- `ValidationFailure` no longer advertises the removed `retryAfter` field
- Auth boundary: `ownerId` cross-check on all admin mutations
- Server-side secret generation for `create()` and `rotate()`
- Input validation: keyPrefix charset, env charset, gracePeriodMs bounds
  (60s–30d), metadata size (4KB), scopes (50), tags (20)
- Configure bounds validation (reject negative/zero)
- Structured audit logging on all mutation outcomes
- lastUsedAt throttled to 60s (reduces OCC contention)
- Remaining decrement decoupled from lastUsedAt write (single merged patch)
- revokeByTag expanded to include `rotating` and `disabled` statuses
- Paginated list/listByTag with configurable limit

## 0.1.1

Not published to npm.

- CI fix: add --ignore-scripts to npm publish

## [0.1.0] - 2026-03-23

- Initial release
- Key creation with SHA-256 hashing, prefix-indexed lookup
- Key validation with status/expiry/remaining checks
- Key revocation (single + bulk by tag)
- Key rotation with configurable grace period
- Key listing by owner, tag, environment
- Key update (name, scopes, tags, metadata) without rotation
- Key disable/enable (reversible pause)
- Finite-use keys (remaining counter with atomic decrement)
- Key types (secret / publishable) with type-encoded prefix
- Environment-aware key format
- Multi-tenant isolation (ownerId-scoped queries)
- Audit event log (apiKeyEvents table)
- Usage analytics via event counting
- Child components: @convex-dev/rate-limiter, sharded-counter, aggregate, crons
