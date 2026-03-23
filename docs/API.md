# API Reference

Full API reference for `@vllnt/convex-api-keys`.

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

Create a new API key. Returns the raw key once — only the hash is stored.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | yes | Display name |
| `ownerId` | `string` | yes | Tenant/org/user ID |
| `type` | `"secret" \| "publishable"` | no | Key type (default from config) |
| `scopes` | `string[]` | no | Permission scopes |
| `tags` | `string[]` | no | Filterable tags |
| `env` | `string` | no | Environment (default: `"live"`) |
| `metadata` | `Record<string, unknown>` | no | Arbitrary JSON |
| `remaining` | `number` | no | Finite-use counter |
| `expiresAt` | `number` | no | Expiry timestamp (ms) |

**Returns:** `{ keyId: string, key: string }`

### validate(ctx, { key })

Validate a key and track usage. Decrements `remaining`, checks rate limits.

**Returns:** `{ valid: true, keyId, ownerId, type, env, scopes, tags, metadata, remaining }` or `{ valid: false, reason, retryAfter? }`

**Rejection reasons:** `"malformed"`, `"not_found"`, `"revoked"`, `"disabled"`, `"expired"`, `"exhausted"`, `"rate_limited"`

### revoke(ctx, { keyId })

Permanently revoke a key. Idempotent.

### revokeByTag(ctx, { ownerId, tag })

Bulk revoke all active keys matching a tag.

**Returns:** `{ revokedCount: number }`

### rotate(ctx, { keyId, gracePeriodMs? })

Create a new key and put the old key in grace period. Both keys validate during the grace period.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `gracePeriodMs` | `number` | `3600000` (1h) | Grace period duration |

**Returns:** `{ newKeyId, newKey, oldKeyExpiresAt }`

### list(ctx, { ownerId, env?, status? })

List keys for an owner. No secrets exposed.

### listByTag(ctx, { ownerId, tag })

List keys matching a specific tag.

### update(ctx, { keyId, name?, scopes?, tags?, metadata? })

Update key metadata in-place without rotation.

### disable(ctx, { keyId })

Temporarily disable a key. Reversible via `enable()`.

### enable(ctx, { keyId })

Re-enable a disabled key.

### getUsage(ctx, { keyId, period? })

Get usage analytics for a key.

**Returns:** `{ total: number, remaining?: number, lastUsedAt?: number }`

### configure(ctx, { cleanupIntervalMs?, defaultExpiryMs? })

Set runtime configuration for the component.
