# Changelog

## 0.2.0

### Breaking Changes

- **Convex compatibility**: this release targets `convex@^1.36.1` and `convex-test@^0.0.50`.
- **`create()` / `rotate()`**: Secret material (lookupPrefix, secretHex, hash) now generated server-side. Remove these from client args.
- **Admin mutations** (`revoke`, `disable`, `enable`, `update`, `rotate`, `getUsage`): `ownerId` is now a required argument for auth boundary enforcement.
- **`apiKeyEvents` table removed**: Audit trail replaced with structured logging (Convex dashboard). Export existing event data before upgrading.
- **`@convex-dev/rate-limiter` removed**: Rate limiting is now the integrator's responsibility at their HTTP action/mutation layer. Remove `rateLimiterTest.register()` from test setup.
- **`@convex-dev/aggregate` and `@convex-dev/crons` removed**: Remove `aggregateTest.register()` and `cronsTest.register()` from test setup.
- **`getUsage()`**: `period` param removed (counter-only). `lastUsedAt` removed from return type.
- **`validate()`**: `retryAfter` removed from failure response (no internal rate limiting).
- **`list()` / `listByTag()`**: Now paginated with `limit` param (default 100).

### Migration Guide

```ts
// BEFORE (v0.1)
const { key } = await apiKeys.create(ctx, {
  name: "My Key", ownerId: "org_1",
  lookupPrefix, secretHex, hash,  // ← REMOVE these
});
await apiKeys.revoke(ctx, { keyId });
await apiKeys.rotate(ctx, { keyId, lookupPrefix, secretHex });
const usage = await apiKeys.getUsage(ctx, { keyId, period: { start, end } });

// AFTER (v0.2)
const { key } = await apiKeys.create(ctx, {
  name: "My Key", ownerId: "org_1",
  // secret material generated server-side
});
await apiKeys.revoke(ctx, { keyId, ownerId: "org_1" });    // ← ADD ownerId
await apiKeys.rotate(ctx, { keyId, ownerId: "org_1" });    // ← ADD ownerId
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

- Public client wrapper now forwards optional `limit` to `list()` and `listByTag()`
- `ValidationFailure` no longer advertises the removed `retryAfter` field
- Auth boundary: `ownerId` cross-check on all admin mutations
- Server-side secret generation for `create()` and `rotate()`
- Input validation: keyPrefix charset, env charset, gracePeriodMs bounds (60s–30d), metadata size (4KB), scopes (50), tags (20)
- Configure bounds validation (reject negative/zero)
- Structured audit logging on all mutation outcomes
- lastUsedAt throttled to 60s (reduces OCC contention)
- Remaining decrement decoupled from lastUsedAt write (single merged patch)
- revokeByTag expanded to include `rotating` and `disabled` statuses
- Paginated list/listByTag with configurable limit

## 0.1.1

- CI fix: add --ignore-scripts to npm publish

## 0.1.0

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
