# @vllnt/convex-api-keys

Secure API key management as a [Convex component](https://docs.convex.dev/components). Create, validate, revoke, rotate, rate-limit, and track usage — all backed by battle-tested `@convex-dev/*` ecosystem components.

## Features

- **Secure by default** — SHA-256 hashed storage, constant-time comparison, prefix-indexed O(1) lookup
- **Key types** — `secret` and `publishable` keys with type-encoded prefixes
- **Finite-use keys** — `remaining` counter with atomic decrement (verification tokens, one-time-use)
- **Disable / Enable** — reversible pause without revoking
- **Rotation** — configurable grace period where both old and new keys are valid
- **Bulk revoke** — revoke all keys matching a tag in one call
- **Tags & environments** — filter keys by tags and environment strings
- **Multi-tenant** — every query scoped by `ownerId`, no cross-tenant leakage
- **Usage tracking** — audit event log + per-key usage analytics
- **Extensible** — custom metadata, configurable prefix, event callbacks

## Architecture

```
Your App → @vllnt/convex-api-keys
               ├── @convex-dev/rate-limiter   (per-key rate limiting)
               ├── @convex-dev/sharded-counter (high-throughput counters)
               ├── @convex-dev/aggregate       (O(log n) analytics)
               └── @convex-dev/crons           (scheduled cleanup)
```

You install one package. Child components are internal — they don't appear in your `convex.config.ts`.

## Installation

```bash
npm install @vllnt/convex-api-keys
```

Register in your `convex/convex.config.ts`:

```ts
import { defineApp } from "convex/server";
import apiKeys from "@vllnt/convex-api-keys/convex.config";

const app = defineApp();
app.use(apiKeys);

// Optional: multiple isolated instances
app.use(apiKeys, { name: "serviceKeys" });

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
  type: "secret",                          // "secret" | "publishable"
  scopes: ["read:users", "write:orders"],
  tags: ["sdk", "v2"],
  env: "live",                             // any string
  metadata: { plan: "enterprise" },
  expiresAt: Date.now() + 90 * 24 * 60 * 60 * 1000,
  remaining: 100000,                       // optional: finite-use
});
// key = "myapp_secret_live_a1b2c3d4_<64-char-hex>"
```

### Validate a key

```ts
const result = await apiKeys.validate(ctx, { key: bearerToken });

if (!result.valid) {
  // result.reason: "malformed" | "not_found" | "revoked" | "expired"
  //                | "exhausted" | "disabled" | "rate_limited"
  return new Response("Unauthorized", { status: 401 });
}

// result.valid === true
const { keyId, ownerId, scopes, tags, env, type, metadata, remaining } = result;
```

### List keys

```ts
const allKeys = await apiKeys.list(ctx, { ownerId: orgId });
const prodKeys = await apiKeys.list(ctx, { ownerId: orgId, env: "live" });
const taggedKeys = await apiKeys.listByTag(ctx, { ownerId: orgId, tag: "sdk" });
```

### Update metadata (without rotation)

```ts
await apiKeys.update(ctx, {
  keyId,
  name: "Renamed Key",
  scopes: ["read:users"],
  tags: ["sdk", "v3"],
  metadata: { plan: "pro" },
});
```

### Disable / Enable

```ts
await apiKeys.disable(ctx, { keyId });
// validate() → { valid: false, reason: "disabled" }

await apiKeys.enable(ctx, { keyId });
// validate() → { valid: true, ... }
```

### Revoke

```ts
await apiKeys.revoke(ctx, { keyId });

// Bulk revoke by tag
await apiKeys.revokeByTag(ctx, { ownerId: orgId, tag: "compromised" });
```

### Rotate

```ts
const { newKey, newKeyId, oldKeyExpiresAt } = await apiKeys.rotate(ctx, {
  keyId,
  gracePeriodMs: 3600000, // 1 hour — both keys valid
});
```

### Usage analytics

```ts
const usage = await apiKeys.getUsage(ctx, {
  keyId,
  period: { start: startOfMonth, end: Date.now() },
});
// { total: 42000, remaining: 58000, lastUsedAt: 1711036800000 }
```

### Finite-use keys (verification tokens)

```ts
const { key } = await apiKeys.create(ctx, {
  name: "Email Verification",
  ownerId: userId,
  remaining: 1,
  expiresAt: Date.now() + 24 * 60 * 60 * 1000,
});
// First validate: { valid: true, remaining: 0 }
// Second validate: { valid: false, reason: "exhausted" }
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
| `revoke(ctx, { keyId })` | mutation | Permanently revoke a key |
| `revokeByTag(ctx, { ownerId, tag })` | mutation | Bulk revoke by tag |
| `rotate(ctx, { keyId, gracePeriodMs? })` | mutation | Rotate with grace period |
| `list(ctx, { ownerId, env?, status? })` | query | List keys (no secrets exposed) |
| `listByTag(ctx, { ownerId, tag })` | query | Filter by tag |
| `update(ctx, { keyId, name?, scopes?, tags?, metadata? })` | mutation | Update metadata in-place |
| `disable(ctx, { keyId })` | mutation | Temporarily disable |
| `enable(ctx, { keyId })` | mutation | Re-enable disabled key |
| `getUsage(ctx, { keyId, period? })` | query | Usage analytics |
| `configure(ctx, { ... })` | mutation | Runtime config |

## Testing

For testing with `convex-test`:

```ts
import { convexTest } from "convex-test";
import { register } from "@vllnt/convex-api-keys/test";

const t = convexTest(schema, modules);
register(t, "apiKeys");
```

## License

Apache-2.0
