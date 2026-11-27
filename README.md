# @vllnt/convex-api-keys

A [Convex component](https://docs.convex.dev/components) that creates,
validates, revokes and rotates API keys, stored as SHA-256 hashes and scoped to
an owner.

## For coding agents

`node_modules/@vllnt/convex-api-keys/` holds `docs/API.md`, `CHANGELOG.md`,
`llms.txt` and the TypeScript source in `src/`, all matching the installed
version. Read them before writing code against this package.

## When to use

- Use it when a Convex app issues API keys to its users or organizations and
  checks them on each request.
- Use it when keys need scopes, tags, an environment, an expiry, a use limit,
  rotation with a grace period, or per-key usage counts.
- Use it when one deployment holds keys for many tenants and every admin call
  must match the key's `ownerId`.
- Do not use it when the token is short-lived and shown once (invite or reset
  links): use
  [`@vllnt/convex-tokens`](https://oss.vllnt.com/packages/convex-tokens).
- Do not use it when you need user sign-in sessions or OAuth: use
  [Convex Auth](https://labs.convex.dev/auth) or your identity provider.
- Do not use it when you need request rate limiting: use
  [`@convex-dev/rate-limiter`](https://www.npmjs.com/package/@convex-dev/rate-limiter);
  this package has none.

## Install

```bash
npm install convex @vllnt/convex-api-keys
```

## Quick start

Mount the component, then create and check keys from your own functions.

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import apiKeys from "@vllnt/convex-api-keys/convex.config";

const app = defineApp();
app.use(apiKeys);

export default app;
```

```ts
// convex/keys.ts
import { v } from "convex/values";
import { ApiKeys } from "@vllnt/convex-api-keys";
import { components } from "./_generated/api";
import { mutation } from "./_generated/server";

const apiKeys = new ApiKeys(components.apiKeys, { prefix: "myapp" });

export const createKey = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    // `key` is returned only here; the component stores its SHA-256 hash.
    return await apiKeys.create(ctx, {
      name,
      ownerId: identity.tokenIdentifier,
    });
  },
});

export const checkKey = mutation({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const result = await apiKeys.validate(ctx, { key });
    if (!result.valid) return { ok: false as const, reason: result.reason };
    return {
      ok: true as const,
      ownerId: result.ownerId,
      scopes: result.scopes,
    };
  },
});
```

Run `npx convex dev` once after adding the component so `components.apiKeys`
exists in `convex/_generated/api`.

## API

Full reference: [docs/API.md](./docs/API.md).

| Export                                                                                                      | Import path                                   | What it is                                                              |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------- |
| [`ApiKeys`](./docs/API.md#apikeys-class)                                                                    | `@vllnt/convex-api-keys`                      | Client class; `new ApiKeys(components.apiKeys, config?)`                |
| [`create(ctx, options)`](./docs/API.md#createctx-options)                                                   | method                                        | Mutation: new key, returns `{ keyId, key }` once                        |
| [`validate(ctx, { key })`](./docs/API.md#validatectx--key-)                                                 | method                                        | Mutation: check a key, count one use, return `ValidationResult`         |
| [`matchStatus(ctx, { key })`](./docs/API.md#matchstatusctx--key-)                                           | method                                        | Query: stored status or `null`; writes nothing                          |
| [`revoke(ctx, { keyId, ownerId })`](./docs/API.md#revokectx--keyid-ownerid-)                                | method                                        | Mutation: make a key `revoked` (no-op for final keys)                   |
| [`revokeByTag(ctx, { ownerId, tag })`](./docs/API.md#revokebytagctx--ownerid-tag-)                          | method                                        | Mutation: revoke an owner's keys with a tag, returns `{ revokedCount }` |
| [`rotate(ctx, { keyId, ownerId, gracePeriodMs? })`](./docs/API.md#rotatectx--keyid-ownerid-graceperiodms-)  | method                                        | Mutation: new key; old key valid for the grace period                   |
| [`update(ctx, { keyId, ownerId, ... })`](./docs/API.md#updatectx--keyid-ownerid-name-scopes-tags-metadata-) | method                                        | Mutation: change `name`, `scopes`, `tags`, `metadata`                   |
| [`disable(ctx, { keyId, ownerId })`](./docs/API.md#disablectx--keyid-ownerid-)                              | method                                        | Mutation: pause an `active` key                                         |
| [`enable(ctx, { keyId, ownerId })`](./docs/API.md#enablectx--keyid-ownerid-)                                | method                                        | Mutation: resume a `disabled` key                                       |
| [`list(ctx, { ownerId, env?, status?, limit? })`](./docs/API.md#listctx--ownerid-env-status-limit-)         | method                                        | Query: up to `limit` (default 100) keys, no cursor                      |
| [`listByTag(ctx, { ownerId, tag, limit? })`](./docs/API.md#listbytagctx--ownerid-tag-limit-)                | method                                        | Query: up to `limit` (default 100) keys with a tag, no cursor           |
| [`getUsage(ctx, { keyId, ownerId })`](./docs/API.md#getusagectx--keyid-ownerid-)                            | method                                        | Query: `{ total, remaining? }`                                          |
| [`configure(ctx, { ... })`](./docs/API.md#configurectx--cleanupintervalms-defaultexpiryms-)                 | method                                        | Mutation: store config values (currently unused)                        |
| [`ApiKeysConfig`](./docs/API.md#types)                                                                      | `@vllnt/convex-api-keys`                      | Type: `{ prefix?, defaultType? }`                                       |
| [`CreateKeyOptions`](./docs/API.md#types)                                                                   | `@vllnt/convex-api-keys`                      | Type: options of `create`                                               |
| [`CreateKeyResult`](./docs/API.md#types)                                                                    | `@vllnt/convex-api-keys`                      | Type: `{ keyId, key }`                                                  |
| [`ValidationResult`](./docs/API.md#types)                                                                   | `@vllnt/convex-api-keys`                      | Type: result of `validate`, narrow on `valid`                           |
| [`ValidationFailureReason`](./docs/API.md#types)                                                            | `@vllnt/convex-api-keys`                      | Type: `reason` when `valid` is `false`                                  |
| [`KeyMetadata`](./docs/API.md#types)                                                                        | `@vllnt/convex-api-keys`                      | Type: one entry of `list` / `listByTag`                                 |
| [`UsageStats`](./docs/API.md#types)                                                                         | `@vllnt/convex-api-keys`                      | Type: result of `getUsage`                                              |
| [`RotateResult`](./docs/API.md#types)                                                                       | `@vllnt/convex-api-keys`                      | Type: `{ newKeyId, newKey, oldKeyExpiresAt }`                           |
| [`KeyType`](./docs/API.md#types)                                                                            | `@vllnt/convex-api-keys`                      | Type: `"secret" \| "publishable"`                                       |
| [`KeyStatus`](./docs/API.md#types)                                                                          | `@vllnt/convex-api-keys`                      | Type: the six stored statuses                                           |
| [`RunMutationCtx`](./docs/API.md#types)                                                                     | `@vllnt/convex-api-keys`                      | Type: any ctx with `runMutation`                                        |
| [`RunQueryCtx`](./docs/API.md#types)                                                                        | `@vllnt/convex-api-keys`                      | Type: any ctx with `runQuery`                                           |
| [default export](./docs/API.md#package-exports)                                                             | `@vllnt/convex-api-keys/convex.config`        | Component definition for `app.use()`                                    |
| [`register(t, name?)`](./docs/API.md#package-exports)                                                       | `@vllnt/convex-api-keys/test`                 | Mount the component in `convex-test`                                    |
| [default export](./docs/API.md#package-exports)                                                             | `@vllnt/convex-api-keys/test`                 | `{ register, schema, modules }`                                         |
| [`ComponentApi`](./docs/API.md#package-exports)                                                             | `@vllnt/convex-api-keys/_generated/component` | Type of `components.apiKeys`                                            |

## Common tasks

### Check a bearer key in an HTTP action

```ts
// convex/http.ts
import { httpRouter } from "convex/server";
import { ApiKeys } from "@vllnt/convex-api-keys";
import { components } from "./_generated/api";
import { httpAction } from "./_generated/server";

const apiKeys = new ApiKeys(components.apiKeys, { prefix: "myapp" });
const http = httpRouter();

http.route({
  path: "/v1/orders",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const header = request.headers.get("Authorization") ?? "";
    const key = header.startsWith("Bearer ")
      ? header.slice("Bearer ".length)
      : "";
    const result = await apiKeys.validate(ctx, { key });
    if (!result.valid) return new Response("Unauthorized", { status: 401 });
    // The component returns scopes; enforcing them is up to you.
    if (!result.scopes.includes("read:orders")) {
      return new Response("Forbidden", { status: 403 });
    }
    return new Response(JSON.stringify({ ownerId: result.ownerId }), {
      headers: { "Content-Type": "application/json" },
    });
  }),
});

export default http;
```

### Manage an owner's keys

```ts
// convex/manageKeys.ts
import { v } from "convex/values";
import type { Auth } from "convex/server";
import { ApiKeys } from "@vllnt/convex-api-keys";
import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";

const apiKeys = new ApiKeys(components.apiKeys, { prefix: "myapp" });

async function ownerOf(ctx: { auth: Auth }): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthenticated");
  return identity.tokenIdentifier;
}

export const createLimitedKey = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) =>
    await apiKeys.create(ctx, {
      name,
      ownerId: await ownerOf(ctx),
      type: "secret",
      env: "test",
      scopes: ["read:orders"],
      tags: ["ci"],
      remaining: 1000,
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }),
});

export const listKeys = query({
  args: {},
  handler: async (ctx) =>
    await apiKeys.list(ctx, { ownerId: await ownerOf(ctx), status: "active" }),
});

export const rotateKey = mutation({
  args: { keyId: v.string() },
  handler: async (ctx, { keyId }) =>
    await apiKeys.rotate(ctx, {
      keyId,
      ownerId: await ownerOf(ctx),
      gracePeriodMs: 24 * 60 * 60 * 1000,
    }),
});

export const revokeKey = mutation({
  args: { keyId: v.string() },
  handler: async (ctx, { keyId }) =>
    await apiKeys.revoke(ctx, { keyId, ownerId: await ownerOf(ctx) }),
});

export const revokeTag = mutation({
  args: { tag: v.string() },
  handler: async (ctx, { tag }) =>
    await apiKeys.revokeByTag(ctx, { ownerId: await ownerOf(ctx), tag }),
});

export const pauseKey = mutation({
  args: { keyId: v.string(), paused: v.boolean() },
  handler: async (ctx, { keyId, paused }) => {
    const ownerId = await ownerOf(ctx);
    if (paused) await apiKeys.disable(ctx, { keyId, ownerId });
    else await apiKeys.enable(ctx, { keyId, ownerId });
  },
});

export const renameKey = mutation({
  args: { keyId: v.string(), name: v.string() },
  handler: async (ctx, { keyId, name }) =>
    await apiKeys.update(ctx, { keyId, ownerId: await ownerOf(ctx), name }),
});

export const keyUsage = query({
  args: { keyId: v.string() },
  handler: async (ctx, { keyId }) =>
    await apiKeys.getUsage(ctx, { keyId, ownerId: await ownerOf(ctx) }),
});
```

### Read a key's status inside a query

`validate` is a mutation (it counts a use). In a query, use `matchStatus`; it
writes nothing and reads the stored status only.

```ts
// convex/keyStatus.ts
import { v } from "convex/values";
import { ApiKeys } from "@vllnt/convex-api-keys";
import { components } from "./_generated/api";
import { query } from "./_generated/server";

const apiKeys = new ApiKeys(components.apiKeys, { prefix: "myapp" });

export const keyStatus = query({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const status = await apiKeys.matchStatus(ctx, { key });
    // "active" and "rotating" can be past their expiry until validate() runs.
    return status === "active" || status === "rotating"
      ? "maybe-valid"
      : (status ?? "unknown");
  },
});
```

## Errors and fixes

`validate` never throws for a bad key; it returns `{ valid: false, reason }`.
Every other method throws an `Error` with one of these messages.

| Error or `reason`                                                                             | Cause                                                                      | Fix                                                                  |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `reason: "malformed"`                                                                         | The string is not `{prefix}_{type}_{env}_{8 chars}_{64 hex}`               | Send the full key as returned by `create` or `rotate`                |
| `reason: "not_found"`                                                                         | No stored key has this prefix and hash                                     | The key was mistyped or never existed; ask for a new key             |
| `reason: "revoked"`                                                                           | The key was revoked                                                        | Issue a new key with `create`                                        |
| `reason: "disabled"`                                                                          | The key was paused with `disable`                                          | Call `enable`, or issue a new key                                    |
| `reason: "expired"`                                                                           | `expiresAt` passed, or a rotated key's grace period ended                  | Use the key returned by `rotate`, or issue a new key                 |
| `reason: "exhausted"`                                                                         | `remaining` reached 0                                                      | Issue a new key with a new `remaining`                               |
| `key not found`                                                                               | No key has this `keyId`                                                    | Pass a `keyId` from `create`, `rotate` or `list`                     |
| `unauthorized: key does not belong to owner`                                                  | `ownerId` differs from the key's owner                                     | Pass the same `ownerId` that created the key                         |
| `ownerId must not be empty`                                                                   | `create` got `ownerId: ""`                                                 | Derive `ownerId` from your auth layer                                |
| `name must not be empty`                                                                      | `create` or `update` got `name: ""`                                        | Pass a non-empty name                                                |
| `name must be <= 256 characters`                                                              | `name` is longer than 256 characters                                       | Shorten it                                                           |
| `Invalid keyPrefix "<prefix>": must match ^[a-zA-Z0-9]+$ (alphanumeric only, no underscores)` | `ApiKeysConfig.prefix` has other characters                                | Use letters and digits only                                          |
| `keyPrefix must be <= 256 characters`                                                         | `prefix` is longer than 256 characters                                     | Shorten it                                                           |
| `Invalid env "<env>": must match ^[a-zA-Z0-9-]+$ (no underscores — would break key parsing)`  | `env` has an underscore or other characters                                | Use letters, digits and `-`                                          |
| `env must be <= 256 characters`                                                               | `env` is longer than 256 characters                                        | Shorten it                                                           |
| `Invalid tag "<tag>": must be alphanumeric with hyphens, starting with alphanumeric`          | A tag (or `revokeByTag`'s `tag`) is empty or has other characters          | Use letters, digits and `-`, starting with a letter or digit         |
| `tags must have <= 20 entries (got <n>)`                                                      | More than 20 tags                                                          | Pass at most 20                                                      |
| `scopes must have <= 50 entries (got <n>)`                                                    | More than 50 scopes                                                        | Pass at most 50                                                      |
| `metadata must be <= 4096 bytes (got <n>)`                                                    | `JSON.stringify(metadata)` is longer than 4096 characters                  | Store less, or keep a reference to your own table                    |
| `expiresAt must be in the future (finite timestamp)`                                          | `expiresAt` is in the past, `NaN` or `Infinity`                            | Pass a future `Date.now()`-style timestamp in ms                     |
| `remaining must be > 0 (finite integer)`                                                      | `remaining` is 0, negative, fractional, `NaN` or `Infinity`                | Pass a positive integer, or leave it out for unlimited use           |
| `limit must be a positive integer`                                                            | `list` / `listByTag` got `limit` ≤ 0, fractional or `NaN`                  | Pass a positive integer, or leave it out (default 100)               |
| `cannot rotate a terminal key`                                                                | The key is `revoked`, `expired` or `exhausted`                             | Issue a new key with `create`                                        |
| `can only rotate active keys`                                                                 | The key is `disabled` or already `rotating`                                | `enable` it first, or rotate the newest key                          |
| `cannot rotate finite-use keys`                                                               | The key has `remaining`                                                    | Create a new key with the remaining quota, then `revoke` the old one |
| `cannot rotate an expired key`                                                                | The key is past `expiresAt` but not yet marked `expired`                   | Issue a new key with `create`                                        |
| `gracePeriodMs must be between 60000 (60s) and 2592000000 (30 days)`                          | `gracePeriodMs` is out of range or `NaN`                                   | Pass 60,000 to 2,592,000,000, or leave it out (default 1 hour)       |
| `cannot update terminal key`                                                                  | `update` on a `revoked`, `expired` or `exhausted` key                      | Issue a new key instead                                              |
| `can only disable active keys`                                                                | `disable` on a key that is not `active` or `disabled`                      | Only pause active keys                                               |
| `can only enable disabled keys`                                                               | `enable` on a key that is not `disabled` or `active`                       | Only resume disabled keys                                            |
| `cleanupIntervalMs must be > 0 (finite number)`                                               | `configure` got 0, negative, `NaN` or `Infinity`                           | Pass a positive finite number                                        |
| `defaultExpiryMs must be > 0 (finite number)`                                                 | `configure` got 0, negative, `NaN` or `Infinity`                           | Pass a positive finite number                                        |
| `ArgumentValidationError` (thrown by Convex)                                                  | An argument has the wrong type, e.g. a `keyId` that is not an `apiKeys` id | Pass `keyId` values returned by this component                       |

## Limits and gotchas

- The raw key is returned once, by `create` or `rotate`. Only its SHA-256 hash
  is stored; a lost key cannot be recovered.
- Defaults: `prefix` `"vk"`, `type` `"secret"`, `env` `"live"`, `gracePeriodMs`
  1 hour, `limit` 100.
- Limits: `name`, `prefix` and `env` 256 characters; `metadata` 4096 characters
  of JSON; 50 `scopes`; 20 `tags`; `gracePeriodMs` 60 seconds to 30 days.
- Key format: `{prefix}_{secret|pub}_{env}_{8 chars}_{64 hex}`. `prefix` and
  `env` cannot contain `_`.
- Expiry is checked by `validate`. Until it runs, a key past `expiresAt` (or a
  rotated key past its grace period) is stored as `active` / `rotating`, so
  `matchStatus` and `list` show that status, and `revoke` / `revokeByTag` still
  revoke it.
- `validate` is a mutation: it counts a use, decrements `remaining`, and updates
  `lastUsedAt` at most once a minute. Call it from a mutation, action or HTTP
  action, not a query.
- Does nothing, without an error: `revoke` on a `revoked`, `expired` or
  `exhausted` key; `disable` on a `disabled` key; `enable` on an `active` key.
- `configure` only stores `cleanupIntervalMs` and `defaultExpiryMs`. No cleanup
  job runs and `create` does not apply `defaultExpiryMs`; pass `expiresAt`
  instead.
- `list` and `listByTag` return at most `limit` keys and have no cursor; calling
  again returns the same keys.
- Rotation only works on `active` keys without `remaining`.
- The component has no rate limiting and does not enforce scopes: `validate`
  returns `scopes`, and your code decides.
- `ownerId` is an opaque string you pass in. The component checks that it
  matches the key's owner; it does not authenticate the caller.

## Compatibility

- Peer dependency: `convex@^1.45.0` (releases before 0.3.0 required `^1.36.1`).
- Runtime dependency: `@convex-dev/sharded-counter` (mounted as a child
  component for usage counts).
- The client works in Convex queries, mutations, actions and HTTP actions (any
  `ctx` with `runQuery` / `runMutation`). Component functions run in the Convex
  runtime.
- `@vllnt/convex-api-keys/test` is TypeScript source that needs `convex-test`,
  `vitest` with Vite's `import.meta.glob`, and `@convex-dev/sharded-counter`.
- ESM only. `engines.node`: `>=18`.

## Testing

`@vllnt/convex-api-keys/test` exports `register(t, name = "apiKeys")` to mount
the component in a `convex-test` instance. It needs `convex-test`, `vitest`
(with Vite's `import.meta.glob`) and `@convex-dev/sharded-counter` (for its
`/test` helper) installed in the consuming app:

```ts
// convex/keys.test.ts
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { register } from "@vllnt/convex-api-keys/test";
import shardedCounterTest from "@convex-dev/sharded-counter/test";
import schema from "./schema";

test("mounts the component", async () => {
  const t = convexTest(schema, import.meta.glob("./**/*.ts"));
  register(t, "apiKeys");
  shardedCounterTest.register(t, "apiKeys/shardedCounter");
  expect(await t.run(async () => "ready")).toBe("ready");
});
```

## Security

- Protects against **accidental cross-tenant bugs in honest host apps** — the
  `ownerId` check does NOT defend against a compromised host passing a forged
  `ownerId`.
- Derive `ownerId` from your own auth layer (e.g. `ctx.auth.getUserIdentity()`)
  before passing it in.
- Raw keys are never stored — only the SHA-256 hash; the raw value is returned
  once at creation. Lookup uses an 8-character indexed prefix and a
  constant-time hash comparison.

See [docs/API.md](./docs/API.md#security-model).

## Related packages

- [`@vllnt/convex-tokens`](https://oss.vllnt.com/packages/convex-tokens) —
  short-lived tokens shown once, with a TTL that always expires and revoke (for
  example invite or reset links). Use convex-api-keys for long-lived keys with
  rotation, usage counts and per-owner listing.
- [`@vllnt/convex-permissions`](https://oss.vllnt.com/packages/convex-permissions)
  — role-based access control. Use it to decide what a validated key's owner may
  do; this package only returns the key's `scopes`.
- [`@vllnt/convex-quota`](https://oss.vllnt.com/packages/convex-quota) —
  allowances that reset on a schedule (per day, week, month). Use it for per-key
  plan limits; `remaining` here is a one-off counter that never resets.

## Contributing

See
[CONTRIBUTING.md](https://github.com/vllnt/convex-api-keys/blob/main/CONTRIBUTING.md)
for development setup, testing, and PR guidelines.

## Author

Built by [bntvllnt](https://github.com/bntvllnt) ·
[bntvllnt.com](https://bntvllnt.com) · [X @bntvllnt](https://x.com/bntvllnt)

If this is useful, [sponsor the work](https://github.com/sponsors/bntvllnt).

## License

MIT — see [LICENSE](./LICENSE).

---

Part of [vllnt open source](https://oss.vllnt.com) · [Package page](https://oss.vllnt.com/packages/convex-api-keys) · [vllnt.com](https://vllnt.com) · Built by [bntvllnt](https://bntvllnt.com)
