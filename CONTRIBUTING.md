# Contributing to @vllnt/convex-api-keys

Thanks for your interest in contributing!

## Development Setup

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm lint
pnpm test
```

Use `pnpm build:codegen` only when you need to regenerate checked-in Convex `_generated` files and have access to the selected Convex project.

## Testing

Tests use [`convex-test`](https://docs.convex.dev/testing) with the `@edge-runtime/vm` environment:

```bash
pnpm test          # single run
pnpm test:watch    # watch mode
```

## Code Style

- Prettier + ESLint (run `pnpm lint` before submitting)
- `@vllnt/eslint-config/convex` enforces: namespace separation, snake_case filenames, no bare `v.any()`, require returns validators, no N+1 queries
- No `any` — use `unknown` + type guards
- Explicit return types on public APIs
- Mutations in `mutations.ts`, queries in `queries.ts`, validators in `validators.ts`

## Pull Requests

- Target `main`
- One logical change per PR
- Include tests for new behavior or bug fixes
- Ensure all checks pass: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`

## Releases

Maintainers only:

- Preferred: use `.github/workflows/publish.yml` with `workflow_dispatch` for patch/minor/major releases.
- Local scripts remain available for patch and alpha publishes:

```bash
pnpm release       # patch bump + publish
pnpm alpha         # prerelease (alpha tag)
```

## Reporting Issues

Use [GitHub Issues](https://github.com/vllnt/convex-api-keys/issues). For security vulnerabilities, see [SECURITY.md](./SECURITY.md).
