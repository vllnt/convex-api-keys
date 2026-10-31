# Changelog

## [0.3.0] - Unreleased

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
