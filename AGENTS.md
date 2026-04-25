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
pnpm build
pnpm test
```

Use `pnpm build:codegen` only when regenerating checked-in Convex `_generated` files and you have access to the selected Convex project.

## Structure

- `src/client/index.ts` — `ApiKeys` class (consumer API): create, validate, rotate, revoke, list, update, disable, enable, getUsage, configure
- `src/component/mutations.ts` — Convex mutations (create, validate, revoke, revokeByTag, rotate, update, disable, enable, configure)
- `src/component/queries.ts` — Convex queries (list, listByTag, getUsage)
- `src/component/validators.ts` — Shared validators (jsonValue alias for v.any())
- `src/component/schema.ts` — Database schema (apiKeys, config)
- `src/shared.ts` — Shared types, key parsing, crypto (sha256Hex, timingSafeEqual)
- `src/test.ts` — convex-test helper for registering the component

## Important Patterns

- Secret material (hash, lookupPrefix, secretHex) generated **server-side** in `mutations.ts`, not in the client
- All admin mutations require `ownerId` — auth boundary prevents cross-tenant access
- Mutations in `mutations.ts`, queries in `queries.ts` (enforced by eslint)
- No bare `v.any()` — aliased as `jsonValue` in `validators.ts`
- Keys are never stored raw — only SHA-256 hashes
- All queries are scoped by `ownerId` (multi-tenant)
- Terminal statuses (`revoked`, `expired`, `exhausted`) cannot be transitioned out of
- Single child component: `@convex-dev/sharded-counter` (rate-limiter, aggregate, crons removed)
- Audit trail via structured logging, not DB events (apiKeyEvents table removed)
- Use `convex-test` with `@edge-runtime/vm` for testing

## Docs Sync (MANDATORY)

When any of these change, update the corresponding docs:

| Change | Update |
|--------|--------|
| Mutation/query args or return types | `docs/API.md`, `README.md` API table, `CLAUDE.md` |
| Schema table added/removed/modified | `AGENTS.md` Structure section, `CLAUDE.md` |
| Child component added/removed | `README.md` Architecture section, `AGENTS.md` |
| New feature or breaking change | `CHANGELOG.md`, `README.md` Features section |
| Input validation rules changed | `docs/API.md` Input Validation table |
| Security model changed | `README.md` Security Model section |

Always run `pnpm lint && pnpm build && pnpm test` before committing docs changes.
