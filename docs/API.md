# API Reference — @vllnt/convex-api-keys

**Compatibility:** requires `convex@^1.45.0` (0.2.0 required `^1.36.1`, 0.1.0
`^1.33.0`).

## Package exports

| Import path                                           | Exports                                                                                                                                                                                                                            |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@vllnt/convex-api-keys`                              | `ApiKeys` class; types `ApiKeysConfig`, `CreateKeyOptions`, `CreateKeyResult`, `ValidationResult`, `ValidationFailureReason`, `KeyMetadata`, `UsageStats`, `RotateResult`, `KeyType`, `KeyStatus`, `RunMutationCtx`, `RunQueryCtx` |
| `@vllnt/convex-api-keys/convex.config` (`.js`)        | default: the component definition, passed to `app.use()`                                                                                                                                                                           |
| `@vllnt/convex-api-keys/test`                         | `register(t, name = "apiKeys")` to mount the component in `convex-test`, plus a default export `{ register, schema, modules }` (TypeScript source; needs Vite's `import.meta.glob`)                                                |
| `@vllnt/convex-api-keys/_generated/component` (`.js`) | type `ComponentApi` (the type of `components.apiKeys`)                                                                                                                                                                             |
| `@vllnt/convex-api-keys/package.json`                 | the package manifest, for tools that read the installed version                                                                                                                                                                    |

`RunMutationCtx` is any context with `runMutation` (mutation, action or HTTP
action); `RunQueryCtx` is any context with `runQuery` (query, mutation, action
or HTTP action).

## ApiKeys Class

```ts
import { ApiKeys } from "@vllnt/convex-api-keys";
import { components } from "./_generated/api";

const apiKeys = new ApiKeys(components.apiKeys, {
  prefix: "myapp", // key prefix (default: "vk")
  defaultType: "secret", // "secret" | "publishable" (default: "secret")
});
```

`apiKeys.component` is the mounted `ComponentApi` passed to the constructor
(`components.apiKeys`).

## Methods

### create(ctx, options)

Create a new API key. Secret material is generated server-side. Returns the raw
key once — only the hash is stored.

| Param       | Type                        | Required | Description                                                   |
| ----------- | --------------------------- | -------- | ------------------------------------------------------------- |
| `name`      | `string`                    | yes      | Display name (max 256 chars)                                  |
| `ownerId`   | `string`                    | yes      | Tenant/org/user ID                                            |
| `type`      | `"secret" \| "publishable"` | no       | Key type (default from config)                                |
| `scopes`    | `string[]`                  | no       | Permission scopes (max 50)                                    |
| `tags`      | `string[]`                  | no       | Filterable tags (max 20)                                      |
| `env`       | `string`                    | no       | Environment (default: `"live"`, must match `^[a-zA-Z0-9-]+$`) |
| `metadata`  | `Record<string, unknown>`   | no       | Arbitrary JSON (max 4096 characters of JSON)                  |
| `remaining` | `number`                    | no       | Finite-use counter                                            |
| `expiresAt` | `number`                    | no       | Expiry timestamp (ms)                                         |

**Returns:** `{ keyId: string, key: string }`

### validate(ctx, { key })

Validate a key and track usage. Decrements `remaining` if set.

**Returns:**
`{ valid: true, keyId, ownerId, type, env, scopes, tags, metadata, remaining }`
or `{ valid: false, reason }`

**Rejection reasons:** `"malformed"`, `"not_found"`, `"revoked"`, `"disabled"`,
`"expired"`, `"exhausted"`

### revoke(ctx, { keyId, ownerId })

Permanently revoke a key. Requires `ownerId` for auth boundary. An `active`,
`disabled` or `rotating` key becomes `revoked`. A key that is already final
(`revoked`, `expired` or `exhausted`) keeps its status and `revokedAt`; the call
does nothing and does not throw. It checks the stored status: a key past
`expiresAt` (or a rotating key past its grace window) is stored as `active` /
`rotating` until `validate()` marks it expired, so revoking it first makes it
`revoked`.

### revokeByTag(ctx, { ownerId, tag })

Bulk revoke all keys matching a tag. Covers `active`, `rotating`, and `disabled`
statuses; it reads every key of the owner in those statuses, so an owner with
very many keys can hit Convex read limits. `revoked`, `expired` and `exhausted`
keys are not counted. Like `revoke()`, it checks the stored status, so a key past its expiry
that `validate()` has not marked `expired` yet is revoked.

**Returns:** `{ revokedCount: number }`

### rotate(ctx, { keyId, ownerId, gracePeriodMs? })

Create a new key and put the old key in grace period. Both keys validate during
the grace period, capped by the old key's absolute expiry. Rotation requires an
active unlimited-use key; finite-use keys must be replaced explicitly so their
quota cannot be duplicated. Secret material is generated server-side.

The new key gets the old key's `name`, `scopes`, `tags`, `metadata`,
`expiresAt`, `env`, type and prefix, so a later `revokeByTag` with one of those
tags also revokes the replacement.

| Param           | Type     | Default        | Description                         |
| --------------- | -------- | -------------- | ----------------------------------- |
| `gracePeriodMs` | `number` | `3600000` (1h) | Grace period (min 60s, max 30 days) |

**Returns:** `{ newKeyId, newKey, oldKeyExpiresAt }`

### list(ctx, { ownerId, env?, status?, limit? })

Return a bounded array of keys for an owner (default limit 100), with no raw
keys or hashes. There is no cursor or continuation token.

Results come in index order: `(ownerId, status)` (with `env`:
`(ownerId, env, status)`), statuses sorted as strings, then creation time,
oldest first within a status. A status change moves a key, so the order and
the keys a `limit` returns change; repeating the call returns the same keys
only while no status changes.

**Returns:** `KeyMetadata[]` —
`{ keyId, name, lookupPrefix, type, env, scopes, tags, status, metadata?, remaining?, expiresAt?, createdAt, lastUsedAt? }`

### listByTag(ctx, { ownerId, tag, limit? })

Return a bounded array of keys matching a tag (default limit 100). There is no
cursor or continuation token; repeating the call does not advance a page. Same
order as `list` without `env`. It scans the owner's keys until it finds `limit`
matches.

`tag` is not validated: any string is accepted, and a tag no key can have
matches nothing. `revokeByTag` throws `Invalid tag` for the same string.

**Returns:** `KeyMetadata[]` (same shape as `list`)

### update(ctx, { keyId, ownerId, name?, scopes?, tags?, metadata? })

Update key metadata in-place without rotation. Requires `ownerId` for auth
boundary.

### disable(ctx, { keyId, ownerId })

Temporarily disable a key. Reversible via `enable()`. Requires `ownerId`.

### enable(ctx, { keyId, ownerId })

Re-enable a disabled key. Requires `ownerId`.

### matchStatus(ctx, { key })

Read-only lookup: the stored status of the key matching `key`
(`"active" | "disabled" | "revoked" | "rotating" | "expired" | "exhausted"`), or
`null` when `key` is malformed or matches no key. It writes nothing and does not
count usage. The stored status is not re-evaluated, so a key past `expiresAt`
(or a rotating key past its grace window) reads as `active` / `rotating` until
`validate()` marks it expired: treat those two values as "maybe valid" and call
`validate()` before trusting the key. Also available as the component query
`components.apiKeys.queries.matchStatus`.

**Returns:** `KeyStatus | null`

### getUsage(ctx, { keyId, ownerId })

Get usage for a key. `total` is the number of successful `validate()` calls for
it (failed validations are not counted); `remaining` is its remaining uses, if
set.

**Returns:** `{ total: number, remaining?: number }`

### configure(ctx, { cleanupIntervalMs?, defaultExpiryMs? })

Store runtime configuration. Admin-only surface — no ownerId scoping. Values
must be finite and > 0. In this version the values are only stored: no cleanup
job runs and `create()` does not apply `defaultExpiryMs`; pass `expiresAt` to
`create()` to set an expiry.

## Component functions

The component's functions can be called directly through
`components.apiKeys.mutations.*` (`create`, `validate`, `revoke`,
`revokeByTag`, `rotate`, `update`, `disable`, `enable`, `configure`) and
`components.apiKeys.queries.*` (`list`, `listByTag`, `matchStatus`,
`getUsage`). The `ApiKeys` client is the documented interface; the direct
calls take the same arguments, except that the direct `create` also takes
`keyPrefix` (the client passes its `prefix`). The direct `validate` returns
`reason: string` (see [Types](#types)).

## Types

All exported from `@vllnt/convex-api-keys`.

| Type                      | Shape                                                                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `ApiKeysConfig`           | `{ prefix?: string; defaultType?: KeyType }`                                                                                             |
| `CreateKeyOptions`        | `{ name; ownerId; type?; scopes?; tags?; env?; metadata?; remaining?; expiresAt? }` (see `create`)                                       |
| `CreateKeyResult`         | `{ keyId: string; key: string }`                                                                                                         |
| `ValidationResult`        | `{ valid: true; keyId; ownerId; type; env; scopes; tags; metadata?; remaining? }` or `{ valid: false; reason: ValidationFailureReason }` |
| `ValidationFailureReason` | `"malformed" \| "not_found" \| "revoked" \| "disabled" \| "expired" \| "exhausted"`                                                      |
| `KeyMetadata`             | `{ keyId; name; lookupPrefix; type; env; scopes; tags; status; metadata?; remaining?; expiresAt?; createdAt; lastUsedAt? }`              |
| `UsageStats`              | `{ total: number; remaining?: number }`                                                                                                  |
| `RotateResult`            | `{ newKeyId: string; newKey: string; oldKeyExpiresAt: number }`                                                                          |
| `KeyType`                 | `"secret" \| "publishable"`                                                                                                              |
| `KeyStatus`               | `"active" \| "disabled" \| "revoked" \| "rotating" \| "expired" \| "exhausted"`                                                          |
| `RunMutationCtx`          | `{ runMutation(ref, args) }`: the `ctx` of a mutation, action or HTTP action                                                             |
| `RunQueryCtx`             | `{ runQuery(ref, args) }`: the `ctx` of a query, mutation, action or HTTP action                                                         |

The component's own `validate` mutation returns `reason: string`; the client's
`validate()` narrows it to `ValidationFailureReason`.

## Errors

Every thrown message, its cause and its fix are listed in the README's
[Errors and fixes](../README.md#errors-and-fixes) table.

Methods that take `keyId` and `ownerId` throw `key not found` for an unknown key
and `unauthorized: key does not belong to owner` when `ownerId` does not match.
Status rules:

- `update()` throws `cannot update terminal key` for `revoked`, `expired` and
  `exhausted` keys.
- `revoke()` on a `revoked`, `expired` or `exhausted` key does nothing.
- `disable()` works on `active` keys only; disabling a `disabled` key does
  nothing.
- `enable()` works on `disabled` keys only; enabling an `active` key does
  nothing.
- `rotate()` works on `active` keys without `remaining` and not past
  `expiresAt`.

## Input Validation

| Field               | Constraint                                                                       |
| ------------------- | -------------------------------------------------------------------------------- |
| `keyPrefix`         | `^[a-zA-Z0-9]+$` (no underscores), max 256 characters                            |
| `env`               | `^[a-zA-Z0-9-]+$` (no underscores — would break key parsing), max 256 characters |
| `ownerId` (create)  | must not be empty (`ownerId must not be empty`); no length limit                 |
| `name`              | must not be empty, max 256 characters                                            |
| `metadata`          | max 4096 characters of `JSON.stringify` output (the error says `bytes`)          |
| `scopes`            | max 50 entries; no length limit per entry                                        |
| `tags`              | max 20 entries, each matching `^[a-zA-Z0-9][a-zA-Z0-9-]*$`; no length limit      |
| `gracePeriodMs`     | min 60,000 (60s), max 2,592,000,000 (30 days); NaN rejected                      |
| `tag` (revokeByTag) | same pattern as `tags`; empty is rejected (`Invalid tag`)                        |
| `tag` (listByTag)   | not validated; a string no key can have matches nothing                          |
| `remaining`         | finite integer > 0                                                               |
| `expiresAt`         | finite timestamp in the future (NaN/Infinity rejected)                           |
| `limit` (queries)   | positive integer (`limit must be a positive integer`)                            |
| `cleanupIntervalMs` | finite number > 0                                                                |
| `defaultExpiryMs`   | finite number > 0                                                                |

## Key Format

```text
{prefix}_{type}_{env}_{random8}_{secret64}

Examples:
  myapp_secret_live_a1b2c3d4_<hex>    ← production secret
  myapp_pub_test_e5f6a7b8_<hex>       ← test publishable
```

## Key Lifecycle

```text
create() → ACTIVE ──→ DISABLED  (disable())
                  ──→ REVOKED   (terminal; revoke() or revokeByTag())
                  ──→ ROTATING  (rotate())
                  ──→ EXPIRED   (terminal; validate() after expiresAt)
                  ──→ EXHAUSTED (terminal; validate() uses the last of remaining)

DISABLED ──→ ACTIVE   (enable())
         ──→ REVOKED  (revoke() or revokeByTag())

ROTATING ──→ EXPIRED  (validate() after the grace period or expiresAt)
         ──→ REVOKED  (revoke() or revokeByTag())
```

## Security Model

This component protects against **accidental cross-tenant bugs in honest host
apps**. The `ownerId` check prevents a bug from operating on another tenant's
keys — it does NOT prevent a compromised host app from passing a forged
`ownerId`.

Integrators must derive `ownerId` from their own auth layer (e.g.,
`ctx.auth.getUserIdentity()`) before passing it to the component. Secret
material is generated server-side and only the SHA-256 hash is stored; the raw
key is returned once at creation and is irrecoverable afterward.
