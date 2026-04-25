[![npm version](https://img.shields.io/npm/v/@vllnt/convex-api-keys)](https://www.npmjs.com/package/@vllnt/convex-api-keys)
[![CI](https://github.com/vllnt/convex-api-keys/actions/workflows/ci.yml/badge.svg)](https://github.com/vllnt/convex-api-keys/actions/workflows/ci.yml)
[![License](https://img.shields.io/npm/l/@vllnt/convex-api-keys)](./LICENSE)

# @vllnt/convex-api-keys

Secure API key management as a [Convex component](https://docs.convex.dev/components). Create, validate, revoke, rotate, and track usage — all with built-in auth boundaries and structured audit logging.

## Features

- **Secure by default** — SHA-256 hashed storage, constant-time comparison, prefix-indexed O(1) lookup, server-side secret generation
- **Auth boundary** — `ownerId` required on all admin mutations — prevents cross-tenant access
- **Key types** — `secret` and `publishable` keys with type-encoded prefixes
- **Finite-use keys** — `remaining` counter with atomic decrement (verification tokens, one-time-use)
- **Disable / Enable** — reversible pause without revoking
- **Rotation** — configurable grace period (60s–30d) where both old and new keys are valid
- **Bulk revoke** — revoke all keys matching a tag (active, rotating, and disabled)
- **Tags & environments** — filter keys by tags and environment strings
- **Multi-tenant** — every query scoped by `ownerId`, no cross-tenant leakage
- **Usage tracking** — per-key usage counter via `@convex-dev/sharded-counter`
- **Input validation** — keyPrefix/env charset, metadata size (4KB), scopes (50), tags (20)
- **Structured logging** — audit trail via structured logs (Convex dashboard)

## Architecture

```
Your App → @vllnt/convex-api-keys
               └── @convex-dev/sharded-counter (high-throughput usage counters)
```

You install one package. The child component is internal — it doesn't appear in your `convex.config.ts`.

> **Rate limiting** is your responsibility. Add `@convex-dev/rate-limiter` at your HTTP action/mutation layer where you have real caller context (IP, auth, plan tier). The component has zero caller context and cannot make informed rate-limit decisions.

## Installation

Peer dependency: `convex@^1.36.1`

```bash
npm install convex@^1.36.1 @vllnt/convex-api-keys
```

If your app already depends on Convex, make sure it satisfies `^1.36.1`.

Register in your `convex/convex.config.ts`:

```ts
import { defineApp } from "convex/server";
import apiKeys from "@vllnt/convex-api-keys/convex.config";

const app = defineApp();
app.use(apiKeys);

export default app;
```

## Usage

### Setup

```ts
import { ApiKeys } from "@vllnt/convex-api-keys";
import { components } from "./_generated/api";

const apiKeys = new ApiKeys(components.apiKeys, {
  prefix: "myapp",      // key prefix (default: "vk")
  defaultType: "secret", // default key type
});
```

### Create a key

```ts
const { key, keyId } = await apiKeys.create(ctx, {
  name: "Production SDK Key",
  ownerId: orgId,
  type: "secret",
  scopes: ["read:users", "write:orders"],
  tags: ["sdk", "v2"],
  env: "live",
  metadata: { plan: "enterprise" },
  expiresAt: Date.now() + 90 * 24 * 60 * 60 * 1000,
  remaining: 100000,
});
// key = "myapp_secret_live_a1b2c3d4_<64-char-hex>"
// Secret material is generated server-side — never passed from client
```

### Validate a key

```ts
const result = await apiKeys.validate(ctx, { key: bearerToken });

if (!result.valid) {
  // result.reason: "malformed" | "not_found" | "revoked" | "expired"
  //                | "exhausted" | "disabled"
  return new Response("Unauthorized", { status: 401 });
}

const { keyId, ownerId, scopes, tags, env, type, metadata, remaining } = result;
```

### List keys

```ts
const keys = await apiKeys.list(ctx, { ownerId: orgId });
const firstTwenty = await apiKeys.list(ctx, { ownerId: orgId, limit: 20 });
const prodKeys = await apiKeys.list(ctx, { ownerId: orgId, env: "live" });
const taggedKeys = await apiKeys.listByTag(ctx, { ownerId: orgId, tag: "sdk", limit: 20 });
```

### Update metadata (without rotation)

```ts
await apiKeys.update(ctx, {
  keyId,
  ownerId: orgId,  // required — auth boundary
  name: "Renamed Key",
  scopes: ["read:users"],
  tags: ["sdk", "v3"],
  metadata: { plan: "pro" },
});
```

### Disable / Enable

```ts
await apiKeys.disable(ctx, { keyId, ownerId: orgId });
await apiKeys.enable(ctx, { keyId, ownerId: orgId });
```

### Revoke

```ts
await apiKeys.revoke(ctx, { keyId, ownerId: orgId });

// Bulk revoke by tag (catches active, rotating, and disabled keys)
await apiKeys.revokeByTag(ctx, { ownerId: orgId, tag: "compromised" });
```

### Rotate

```ts
const { newKey, newKeyId, oldKeyExpiresAt } = await apiKeys.rotate(ctx, {
  keyId,
  ownerId: orgId,       // required — auth boundary
  gracePeriodMs: 3600000, // 1 hour — both keys valid (min 60s, max 30d)
});
```

### Usage analytics

```ts
const usage = await apiKeys.getUsage(ctx, { keyId, ownerId: orgId });
// { total: 42000, remaining: 58000 }
```

## Key Format

```
{prefix}_{type}_{env}_{random8}_{secret64}

Examples:
  myapp_secret_live_a1b2c3d4_<hex>    ← production secret
  myapp_pub_test_e5f6g7h8_<hex>       ← test publishable
```

## Key Lifecycle

```
create() → ACTIVE ──→ DISABLED (reversible via enable())
                  ──→ REVOKED  (terminal)
                  ──→ ROTATING (grace period → EXPIRED)
                  ──→ EXPIRED  (terminal, time-based)
                  ──→ EXHAUSTED (terminal, remaining=0)
```

## API Reference

| Method | Ctx | Description |
|--------|-----|-------------|
| `create(ctx, options)` | mutation | Create a new API key |
| `validate(ctx, { key })` | mutation | Validate and track usage |
| `revoke(ctx, { keyId, ownerId })` | mutation | Permanently revoke a key |
| `revokeByTag(ctx, { ownerId, tag })` | mutation | Bulk revoke by tag |
| `rotate(ctx, { keyId, ownerId, gracePeriodMs? })` | mutation | Rotate with grace period |
| `list(ctx, { ownerId, env?, status?, limit? })` | query | List keys (paginated, default 100) |
| `listByTag(ctx, { ownerId, tag, limit? })` | query | Filter by tag |
| `update(ctx, { keyId, ownerId, name?, ... })` | mutation | Update metadata in-place |
| `disable(ctx, { keyId, ownerId })` | mutation | Temporarily disable |
| `enable(ctx, { keyId, ownerId })` | mutation | Re-enable disabled key |
| `getUsage(ctx, { keyId, ownerId })` | query | Usage counter (O(1)) |
| `configure(ctx, { ... })` | mutation | Runtime config (admin-only) |

## Security Model

This component protects against **accidental cross-tenant bugs in honest host apps**. The `ownerId` check prevents a bug from operating on another tenant's keys — it does NOT prevent a compromised host app from passing a forged `ownerId`.

Integrators must derive `ownerId` from their own auth layer (e.g., `ctx.auth.getUserIdentity()`) before passing it to the component.

## Testing

For testing with `convex-test`:

```ts
import { convexTest } from "convex-test";
import { register } from "@vllnt/convex-api-keys/test";
import shardedCounterTest from "@convex-dev/sharded-counter/test";

const t = convexTest(schema, modules);
register(t, "apiKeys");
shardedCounterTest.register(t, "apiKeys/shardedCounter");
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup, testing, and PR guidelines.

## License

Apache-2.0
