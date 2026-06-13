<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `example/convex/_generated/ai/guidelines.md` first** for
important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->

# @vllnt/convex-api-keys

Secure API key management as a Convex component — create, validate, revoke, rotate, and track usage
with owner-scoped admin APIs, server-side secret generation, and structured audit logging.

A sandboxed Convex component following the vllnt Component Standard (see the `convex-components` hub
`.claude/rules/component-standard.md`). `CLAUDE.md` is a verbatim mirror of this file.

## Architecture

```
src/
├── shared.ts              # shared types, validators, crypto utils (sha256Hex, timingSafeEqual)
├── log.ts                 # minimal structured logger (Convex-safe)
├── test.ts                # convex-test register() helper
├── client/
│   ├── index.ts           # ApiKeys client class (consumer-facing API)
│   └── types.ts           # public TypeScript interfaces
└── component/
    ├── mutations.ts        # all mutations (create, validate, revoke, revokeByTag, rotate, update, disable, enable, configure)
    ├── queries.ts          # all queries (list, listByTag, getUsage)
    ├── validators.ts       # shared validators (jsonValue alias for v.any())
    ├── schema.ts           # sandboxed tables (apiKeys, config)
    └── convex.config.ts    # defineComponent("apiKeys"); child: @convex-dev/sharded-counter
```

## Ownership boundary

- **Component owns:** the `apiKeys` and `config` sandboxed tables; key lifecycle (active →
  disabled/rotating/revoked/expired/exhausted); hash storage; prefix-indexed lookup; usage counting
  via sharded-counter; structured audit logging.
- **Host owns:** identity, auth, the domain concept of "who may mint or revoke a key"; derives
  `ownerId` from its own auth layer and passes it in as an opaque string; decides when to expose key
  operations to end-users.
- **Auth:** the host gates every management mutation; the component never calls auth libs — it only
  enforces that the supplied `ownerId` matches the key's stored owner (prevents cross-tenant bugs,
  not a compromised host).

## Key design decisions

- **Secret material generated server-side:** both `create()` and `rotate()` generate `lookupPrefix`,
  `secretHex`, and the SHA-256 hash inside the component mutation — raw material never travels from
  the client to the server.
- **Raw key never stored:** only the SHA-256 hash persists; the raw key is returned once at creation
  and is irrecoverable after that call completes.
- **Prefix-indexed O(1) lookup:** an 8-char `lookupPrefix` is stored and indexed so `validate()` can
  find the candidate row in O(1), then uses constant-time hash comparison to prevent timing attacks.
- **No rate limiting in the component:** rate limiting belongs at the host's HTTP action/mutation
  layer where real caller context (IP, plan, auth) is available; the component has none.
- **No event table:** structured logging (`log.ts`) replaces a `apiKeyEvents` DB table — eliminates
  unbounded growth, O(N) scans, and retention complexity.
- **`ownerId` as the only auth boundary:** all admin mutations assert `key.ownerId === args.ownerId`
  before any state change; this prevents cross-tenant bugs in honest host apps, not a hostile host.

## Conventions

- Mutations in `mutations.ts`, queries in `queries.ts` (enforced by `@vllnt/eslint-config/convex`).
- Explicit `args` + `returns` on every Convex function.
- No bare `v.any()` — aliased as `jsonValue` in `validators.ts`.
- Terminal statuses (`revoked`, `expired`, `exhausted`) cannot be transitioned out of.
- 100% test coverage is BLOCKING (`vitest.config.mts` thresholds).
- Runtime deps: only official `@convex-dev/*` + `@vllnt/*`.

## Development

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm test:coverage
```

Use `pnpm build:codegen` only when regenerating checked-in Convex `_generated` files and you have
access to the selected Convex project.

## Docs sync (MANDATORY)

When any of these change, update the matching docs in the SAME commit (then `pnpm generate:llms`):

| Change | Update |
|--------|--------|
| Mutation/query args or return types | `docs/API.md`, README API table |
| Schema table added/removed/modified | this file (Architecture), README Architecture |
| Child component added/removed | README Architecture, this file (Architecture) |
| New feature / breaking change | `CHANGELOG.md`, README Features |
| Security model | README Security Model |
| `peerDependencies.convex` range | `llms.txt` context line, `docs/API.md` Compatibility line |
