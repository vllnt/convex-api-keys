<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `example/convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->

# @vllnt/convex-api-keys

Convex component for secure API key management.

## Quick Start

```bash
pnpm install
pnpm build:codegen
pnpm test
```

## Structure

- `src/client/index.ts` — `ApiKeys` class (consumer API): create, validate, rotate, revoke, list, update, disable, enable, getUsage, configure
- `src/component/mutations.ts` — Convex mutations (create, validate, revoke, revokeByTag, rotate, update, disable, enable, configure)
- `src/component/queries.ts` — Convex queries (list, listByTag, getUsage)
- `src/component/validators.ts` — Shared validators (jsonValue alias for v.any())
- `src/component/schema.ts` — Database schema (apiKeys, apiKeyEvents, config)
- `src/shared.ts` — Shared types, key parsing, crypto (sha256Hex, timingSafeEqual)
- `src/test.ts` — convex-test helper for registering the component

## Important Patterns

- Hash is computed **server-side** in `mutations.ts`, not in the client
- Mutations in `mutations.ts`, queries in `queries.ts` (enforced by eslint)
- No bare `v.any()` — aliased as `jsonValue` in `validators.ts`
- Keys are never stored raw — only SHA-256 hashes
- All queries are scoped by `ownerId` (multi-tenant)
- Terminal statuses (`revoked`, `expired`, `exhausted`) cannot be transitioned out of
- Use `convex-test` with `@edge-runtime/vm` for testing
