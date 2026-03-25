# Roadmap: @vllnt/convex-api-keys

Derived from [DEEP-ANALYSIS.md](./DEEP-ANALYSIS.md) (2026-03-24, 6-perspective audit).

## Priority Legend

- **CRITICAL** — blocks production use at scale
- **HIGH** — security or correctness risk
- **MEDIUM** — quality of life / extensibility
- **LOW** — nice to have

---

## Phase 1: Harden (Before v1.0)

Goal: Make the component safe-by-default for any integrator.

| # | Task | Severity | Effort | Addresses |
|---|------|----------|--------|-----------|
| 1.1 | Add `ownerId` cross-check on revoke/disable/enable/update/rotate/getUsage | CRITICAL | Small | C1 — no auth boundary |
| 1.2 | Move `secretHex` + `hash` generation into component mutations | HIGH | Medium | H1 — secret in mutation logs |
| 1.3 | Reorder validate: rate limit BEFORE `remaining` decrement + `lastUsedAt` write | HIGH | Small | H2, H6 — wasted writes on rejected requests |
| 1.4 | Add pre-match rate limit on validate (global or per-prefix) | HIGH | Medium | H3 — unlimited probing |
| 1.5 | Validate `keyPrefix` against `^[a-zA-Z0-9]+$` | MEDIUM | Trivial | M2 — separator collision |
| 1.6 | Validate `env` against `^[a-zA-Z0-9-]+$` (no underscores) | MEDIUM | Trivial | M2 — parsing hazard |
| 1.7 | Enforce `gracePeriodMs` upper bound (max 30 days) | MEDIUM | Trivial | M6 — unbounded grace |
| 1.8 | Add bounds validation on `configure()` inputs | HIGH | Trivial | H4 — config poisoning |
| 1.9 | Emit audit event on `configure()` changes | HIGH | Trivial | H4 — silent config mutation |
| 1.10 | Cap `metadata` size (4KB), `scopes` (50), `tags` (20), string fields (256 chars) | MEDIUM | Small | M3 — payload bloat |
| 1.11 | Log structured output on every validate outcome (success + all failure reasons) | HIGH | Small | H5 — operational blindness |
| 1.12 | Align README claims with actual implementation (cleanup, analytics, callbacks) | HIGH | Small | H4 — doc/code drift |

**Exit criteria:** All 12 items complete. Cut v1.0.0.

---

## Phase 2: Scale (1-2 Weeks after v1.0)

Goal: Remove the unbounded scan patterns and write contention.

| # | Task | Severity | Effort | Addresses |
|---|------|----------|--------|-----------|
| 2.1 | Decouple `lastUsedAt` from validate hot path (write only when delta > 60s) | CRITICAL | Medium | C2 — OCC contention |
| 2.2 | Add cursor-based pagination to `list()`, `listByTag()`, `getUsage(period)` | CRITICAL | Medium | C3, M1, M8 — unbounded results |
| 2.3 | Add tag index (`by_owner_tag`) or join table for `listByTag` / `revokeByTag` | HIGH | Medium | H5, M1 — full owner scan |
| 2.4 | Paginate `revokeByTag` via continuation / scheduler pattern | HIGH | Medium | H3 — mutation timeout at scale |
| 2.5 | Expand `revokeByTag` to include `rotating` + `disabled` statuses | MEDIUM | Small | M2 — silent skip |
| 2.6 | Add `listEvents()` paginated query to public API | MEDIUM | Medium | M4 — event table write-only |
| 2.7 | Add tests for: auth boundaries, rate-limited paths, malformed probes, large tenant scans | HIGH | Medium | M7 — untested risk paths |

**Exit criteria:** All 7 items complete. No `.collect()` without pagination in any public query.

---

## Phase 3: Operate (1 Month)

Goal: Make the component self-managing and observable in production.

| # | Task | Severity | Effort | Addresses |
|---|------|----------|--------|-----------|
| 3.1 | Implement event retention scheduled job (use `cleanupIntervalMs` from config) | CRITICAL | Medium | C3, M6, M9 — unbounded event growth |
| 3.2 | Implement expired key sweep (cron that marks expired keys without waiting for validate) | MEDIUM | Medium | M9 — lazy expiry |
| 3.3 | Replace `getUsage(period)` event scan with time-bucketed aggregates | CRITICAL | Large | C3 — O(N) usage queries |
| 3.4 | Make rate-limit policy configurable per key/owner/tier | MEDIUM | Medium | M5 — hardcoded 1000/min |
| 3.5 | Define rotation semantics for finite-use keys (share quota or block rotation) | HIGH | Medium | H7 — quota duplication |
| 3.6 | Add actor/source/request metadata to audit events | HIGH | Medium | H6 — thin audit model |
| 3.7 | Make logger injectable via `ApiKeysConfig` (consumers provide their own transport) | MEDIUM | Small | Observability gap |
| 3.8 | Add `getConfig()` query (config is currently write-only) | MEDIUM | Trivial | Observability gap |

**Exit criteria:** Event table has retention. Usage queries are O(1). Rate limits are configurable.

---

## Phase 4: Extend (3+ Months)

Goal: Enable ecosystem growth and advanced use cases.

| # | Task | Severity | Effort | Addresses |
|---|------|----------|--------|-----------|
| 4.1 | Add `onEvent` dispatch hook for webhooks/streaming | MEDIUM | Medium | Extensibility — events are dead-end |
| 4.2 | Type-safe metadata generics on `ApiKeys<TMeta>` client wrapper | MEDIUM | Small | M3 — untyped metadata |
| 4.3 | Key format versioning (version byte in key string) | MEDIUM | Large | M7 — format immutability |
| 4.4 | HMAC-SHA256 with server-side pepper (defense against DB leak) | MEDIUM | Large | Security — unkeyed hash |
| 4.5 | Middleware/plugin composition model (replace monolithic class) | LOW | Large | Extensibility |
| 4.6 | Admin query surface (cross-owner listing, system health) | LOW | Medium | Extensibility |
| 4.7 | Offline/edge validation (HMAC-based local verify without Convex round-trip) | LOW | Large | Edge deployment |

---

## Milestone Summary

```
v1.0.0  Phase 1 complete — safe-by-default
v1.1.0  Phase 2 complete — scale-ready
v1.2.0  Phase 3 complete — production-operated
v2.0.0  Phase 4 complete — extensible ecosystem
```

## Status

- [x] v0.1.0 shipped (2026-03-24) — feature-complete, 69 tests, OSS grade A
- [ ] Phase 1 — not started
- [ ] Phase 2 — not started
- [ ] Phase 3 — not started
- [ ] Phase 4 — not started
