<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `example/convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->

## Project Overview

`@vllnt/convex-api-keys` is a Convex component for secure API key management. It provides create, validate, revoke, rotate, and usage tracking — with built-in auth boundaries and structured audit logging. Single child component: `@convex-dev/sharded-counter`.

## Architecture

```
src/
├── shared.ts              # Shared types, validators, crypto utils (sha256Hex, timingSafeEqual)
├── log.ts                 # Minimal structured logger (Convex-safe)
├── test.ts                # convex-test registration helper
├── client/
│   ├── types.ts           # Public TypeScript interfaces
│   └── index.ts           # ApiKeys client class (consumer-facing API)
└── component/
    ├── mutations.ts        # Mutations (create, validate, revoke, rotate, update, disable, enable, configure)
    ├── queries.ts          # Queries (list, listByTag, getUsage)
    ├── validators.ts       # Shared validators (jsonValue alias for v.any())
    ├── schema.ts           # Convex schema (apiKeys, config tables)
    └── convex.config.ts    # Component config (sharded-counter only)
```

## Key Design Decisions

- **Secret material generated server-side**: Both `create()` and `rotate()` generate lookupPrefix, secretHex, and hash inside the component mutation — never passed from client.
- **Auth boundary via ownerId**: All admin mutations (revoke, disable, enable, update, rotate, getUsage) require `ownerId` and assert it matches the key's owner before any state change.
- **No event table**: Audit trail via structured logging (`log.ts`), not a DB table. Eliminates unbounded growth, O(N) scans, and retention complexity.
- **No rate limiting**: Rate limiting is the integrator's responsibility at their HTTP layer with real caller context.
- **Namespace separation**: Mutations in `mutations.ts`, queries in `queries.ts` — enforced by `@vllnt/eslint-config/convex`.
- **No bare `v.any()`**: All uses aliased as `jsonValue` in `validators.ts`.
- **Prefix-indexed lookup**: Keys use an 8-char `lookupPrefix` for O(1) candidate lookup, then constant-time hash comparison.
- **No raw keys stored**: Only SHA-256 hashes persist. Raw keys are returned once at creation.
- **Input validation**: keyPrefix (`^[a-zA-Z0-9]+$`), env (`^[a-zA-Z0-9-]+$`), metadata (4KB), scopes (50), tags (20), gracePeriodMs (60s-30d).

## Development

```bash
pnpm install
pnpm build                  # Build the package
pnpm typecheck              # Type check
pnpm lint                   # ESLint
pnpm test                   # vitest with convex-test + @edge-runtime/vm
```

Use `pnpm build:codegen` only when regenerating checked-in Convex `_generated` files and you have access to the selected Convex project.

## Testing

Tests use `convex-test` with the `@edge-runtime/vm` environment. The `src/test.ts` helper registers the component for testing.

## Key Conventions

- All Convex functions use explicit `args` validators and `returns` types
- Terminal statuses: `revoked`, `expired`, `exhausted` (no further transitions)
- Tags must match `^[a-zA-Z0-9][a-zA-Z0-9-]*$`
- Key format: `{prefix}_{type}_{env}_{lookupPrefix}_{secretHex}`
