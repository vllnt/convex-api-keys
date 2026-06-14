<!-- Badges -->
[![Convex Component](https://img.shields.io/badge/convex-component-EE342F.svg)](https://www.convex.dev/components)
[![npm version](https://img.shields.io/npm/v/@vllnt/convex-api-keys.svg)](https://www.npmjs.com/package/@vllnt/convex-api-keys)
[![CI](https://github.com/vllnt/convex-api-keys/actions/workflows/ci.yml/badge.svg)](https://github.com/vllnt/convex-api-keys/actions/workflows/ci.yml)
[![License](https://img.shields.io/npm/l/@vllnt/convex-api-keys.svg)](./LICENSE)

# @vllnt/convex-api-keys

Secure API key management as a [Convex component](https://docs.convex.dev/components) — create, validate, revoke, rotate, and track usage with built-in auth boundaries and structured audit logging.

```ts
const apiKeys = new ApiKeys(components.apiKeys, { prefix: "myapp" });
const { key, keyId } = await apiKeys.create(ctx, { name: "SDK Key", ownerId: orgId });
const result = await apiKeys.validate(ctx, { key: bearerToken });
// result.valid → { keyId, ownerId, scopes, ... } | result.reason
```

## Features

- **Secure by default** — SHA-256 hashed storage, constant-time comparison, prefix-indexed O(1) lookup, server-side secret generation.
- **Auth boundary** — `ownerId` required on all admin mutations; prevents cross-tenant access.
- **Key types** — `secret` and `publishable` keys with type-encoded prefixes.
- **Finite-use keys** — `remaining` counter with atomic decrement for one-time-use tokens.
- **Disable / enable** — reversible pause without revoking.
- **Rotation** — configurable grace period (60s–30d) where both old and new keys are valid.
- **Bulk revoke by tag, tags & environments, multi-tenant scoping, usage tracking, input validation, structured audit logging.**

## Installation

Peer dependency: `convex@^1.36.1`

```bash
npm install convex@^1.36.1 @vllnt/convex-api-keys
```

Register in your `convex/convex.config.ts`:

```ts
import { defineApp } from "convex/server";
import apiKeys from "@vllnt/convex-api-keys/convex.config";

const app = defineApp();
app.use(apiKeys);
export default app;
```

> **Rate limiting** is your responsibility — add `@convex-dev/rate-limiter` at your HTTP action/mutation layer where you have real caller context (IP, auth, plan tier). The component has none.

## Usage

```ts
import { ApiKeys } from "@vllnt/convex-api-keys";
import { components } from "./_generated/api";

const apiKeys = new ApiKeys(components.apiKeys, {
  prefix: "myapp",       // key prefix (default: "vk")
  defaultType: "secret",
});

// Create — secret material is generated server-side, returned once.
const { key, keyId } = await apiKeys.create(ctx, {
  name: "Production SDK Key",
  ownerId: orgId,
  type: "secret",
  scopes: ["read:users", "write:orders"],
  tags: ["sdk", "v2"],
  env: "live",
});
// key = "myapp_secret_live_a1b2c3d4_<64-char-hex>"

// Validate — track usage and narrow on `valid`.
const result = await apiKeys.validate(ctx, { key: bearerToken });
if (!result.valid) {
  // result.reason: "malformed" | "not_found" | "revoked" | "expired" | "exhausted" | "disabled"
  return new Response("Unauthorized", { status: 401 });
}
const { ownerId, scopes, tags, env, type, metadata, remaining } = result;
```

See [docs/API.md](docs/API.md) for the full method reference, key format, and lifecycle.

## API Reference

| Method | Ctx | Description |
|--------|-----|-------------|
| `create(ctx, options)` | mutation | Create a new API key |
| `validate(ctx, { key })` | mutation | Validate and track usage |
| `revoke(ctx, { keyId, ownerId })` | mutation | Permanently revoke a key |
| `revokeByTag(ctx, { ownerId, tag })` | mutation | Bulk revoke by tag |
| `rotate(ctx, { keyId, ownerId, gracePeriodMs? })` | mutation | Rotate with grace period |
| `update(ctx, { keyId, ownerId, name?, ... })` | mutation | Update metadata in-place |
| `disable(ctx, { keyId, ownerId })` | mutation | Temporarily disable |
| `enable(ctx, { keyId, ownerId })` | mutation | Re-enable a disabled key |
| `configure(ctx, { ... })` | mutation | Runtime config (admin-only) |
| `list(ctx, { ownerId, env?, status?, limit? })` | query | List keys (paginated, default 100) |
| `listByTag(ctx, { ownerId, tag, limit? })` | query | Filter by tag |
| `getUsage(ctx, { keyId, ownerId })` | query | Usage counter (O(1)) |

Full reference: [docs/API.md](docs/API.md).

## Security

- Protects against **accidental cross-tenant bugs in honest host apps** — the `ownerId` check does NOT defend against a compromised host passing a forged `ownerId`.
- Derive `ownerId` from your own auth layer (e.g. `ctx.auth.getUserIdentity()`) before passing it in.
- Raw keys are never stored — only the SHA-256 hash; the raw value is returned once at creation.

See [docs/API.md](docs/API.md).

## Testing

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

## Author

Built by [bntvllnt](https://github.com/bntvllnt) · [bntvllnt.com](https://bntvllnt.com) · [X @bntvllnt](https://x.com/bntvllnt)

Part of the [@vllnt](https://github.com/vllnt) Convex component fleet — [vllnt.com](https://vllnt.com)

If this is useful, [sponsor the work](https://github.com/sponsors/bntvllnt).

## License

MIT — see [LICENSE](LICENSE).
