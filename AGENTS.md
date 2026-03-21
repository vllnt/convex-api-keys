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
- `src/component/public.ts` — Convex mutations/queries backing the client
- `src/component/schema.ts` — Database schema (apiKeys, apiKeyEvents, config)
- `src/shared.ts` — Shared types, key parsing, crypto (sha256Hex, timingSafeEqual)
- `src/test.ts` — convex-test helper for registering the component

## Important Patterns

- Hash is computed **server-side** in component mutations, not in the client
- Keys are never stored raw — only SHA-256 hashes
- All queries are scoped by `ownerId` (multi-tenant)
- Terminal statuses (`revoked`, `expired`, `exhausted`) cannot be transitioned out of
- Use `convex-test` with `@edge-runtime/vm` for testing
