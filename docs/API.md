# API Reference

Full API reference for `@vllnt/convex-api-keys`.

**Compatibility:** `convex@^1.36.1`

## ApiKeys Class

```ts
import { ApiKeys } from "@vllnt/convex-api-keys";
import { components } from "./_generated/api";

const apiKeys = new ApiKeys(components.apiKeys, {
  prefix: "myapp",      // key prefix (default: "vk")
  defaultType: "secret", // "secret" | "publishable" (default: "secret")
});
```

## Methods

### create(ctx, options)

Create a new API key. Secret material is generated server-side. Returns the raw key once — only the hash is stored.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | yes | Display name (max 256 chars) |
| `ownerId` | `string` | yes | Tenant/org/user ID |
| `type` | `"secret" \| "publishable"` | no | Key type (default from config) |
| `scopes` | `string[]` | no | Permission scopes (max 50) |
| `tags` | `string[]` | no | Filterable tags (max 20) |
| `env` | `string` | no | Environment (default: `"live"`, must match `^[a-zA-Z0-9-]+$`) |
| `metadata` | `Record<string, unknown>` | no | Arbitrary JSON (max 4KB) |
| `remaining` | `number` | no | Finite-use counter |
| `expiresAt` | `number` | no | Expiry timestamp (ms) |

**Returns:** `{ keyId: string, key: string }`

### validate(ctx, { key })

Validate a key and track usage. Decrements `remaining` if set.

**Returns:** `{ valid: true, keyId, ownerId, type, env, scopes, tags, metadata, remaining }` or `{ valid: false, reason }`

**Rejection reasons:** `"malformed"`, `"not_found"`, `"revoked"`, `"disabled"`, `"expired"`, `"exhausted"`

### revoke(ctx, { keyId, ownerId })

Permanently revoke a key. Idempotent. Requires `ownerId` for auth boundary.

### revokeByTag(ctx, { ownerId, tag })

Bulk revoke all keys matching a tag. Covers `active`, `rotating`, and `disabled` statuses.

**Returns:** `{ revokedCount: number }`

### rotate(ctx, { keyId, ownerId, gracePeriodMs? })

Create a new key and put the old key in grace period. Both keys validate during the grace period. Secret material generated server-side.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `gracePeriodMs` | `number` | `3600000` (1h) | Grace period (min 60s, max 30 days) |

**Returns:** `{ newKeyId, newKey, oldKeyExpiresAt }`

### list(ctx, { ownerId, env?, status?, limit? })

List keys for an owner. No secrets exposed. Paginated (default 100).

### listByTag(ctx, { ownerId, tag, limit? })

List keys matching a specific tag. Paginated (default 100).

### update(ctx, { keyId, ownerId, name?, scopes?, tags?, metadata? })

Update key metadata in-place without rotation. Requires `ownerId` for auth boundary.

### disable(ctx, { keyId, ownerId })

Temporarily disable a key. Reversible via `enable()`. Requires `ownerId`.

### enable(ctx, { keyId, ownerId })

Re-enable a disabled key. Requires `ownerId`.

### getUsage(ctx, { keyId, ownerId })

Get usage count for a key. Returns O(1) counter value.

**Returns:** `{ total: number, remaining?: number }`

### configure(ctx, { cleanupIntervalMs?, defaultExpiryMs? })

Set runtime configuration. Admin-only surface — no ownerId scoping. Values must be > 0.

## Input Validation

| Field | Constraint |
|-------|-----------|
| `keyPrefix` | `^[a-zA-Z0-9]+$` (no underscores) |
| `env` | `^[a-zA-Z0-9-]+$` (no underscores — would break key parsing) |
| `name` | max 256 characters |
| `metadata` | max 4KB (JSON serialized) |
| `scopes` | max 50 entries |
| `tags` | max 20 entries, each matching `^[a-zA-Z0-9][a-zA-Z0-9-]*$` |
| `gracePeriodMs` | min 60,000 (60s), max 2,592,000,000 (30 days) |
| `remaining` | must be > 0 |
| `expiresAt` | must be in the future |
| `cleanupIntervalMs` | must be > 0 |
| `defaultExpiryMs` | must be > 0 |
