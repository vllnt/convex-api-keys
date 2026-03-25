---
title: "v0.2.0 Production Hardening"
status: shipped
created: 2026-03-25
estimate: 14h
tier: standard
---

# v0.2.0 Production Hardening

## Context

The deep analysis (2026-03-24, 7-perspective audit) found 3 critical, 7 high, and 7 medium-severity issues that block production use of `@vllnt/convex-api-keys`. The component has solid crypto fundamentals (hashed storage, prefix-indexed lookup, timing-safe comparison) but lacks authorization boundaries, has write-heavy validation, unbounded collection scans, and an operational story weaker than the README promises. This spec consolidates Phases 1-2 roadmap items plus select Phase 3 items into a single implementable plan for v0.2. Phase 3 operational items (crons, aggregates) and all Phase 4 items are deferred to subsequent specs.

## Security Model

**Threat model:** This component protects against **accidental cross-tenant bugs in honest host apps** (Threat A), NOT against malicious/compromised integrators (Threat B).

**Trust boundary:** The component trusts the `ownerId` it receives from the host app. It does not derive or verify caller identity from `ctx.auth`. The ownerId cross-check (AC-1) prevents a host app bug from accidentally operating on another tenant's keys — it does NOT prevent a compromised host app from passing a forged ownerId.

**Implication:** Integrators who need Threat B protection must derive `ownerId` from their own auth layer (e.g., `ctx.auth.getUserIdentity()`) before passing it to the component. The component cannot enforce this — it is the host app's responsibility.

**Design decision:** ownerId is a **required arg** on all admin mutations (revoke, disable, enable, update, rotate). This is a breaking change from v0.1 (which took only keyId). The component internally fetches the key and asserts `key.ownerId === args.ownerId` before any state change. This was chosen over optional-ownerId (which would be silently bypassable) and over component-internal ctx.auth (which would couple the component to a specific auth provider).

## Codebase Impact (MANDATORY)

| Area | Impact | Detail |
|------|--------|--------|
| `src/component/mutations.ts` | MODIFY | Auth boundary (ownerId on admin mutations), secret generation server-side for create() AND rotate(), config bounds/audit, revokeByTag pagination+status expansion, gracePeriod min/max bounds, remove all apiKeyEvents inserts + rateLimiter usage — replace with structured logging + counter, decouple lastUsedAt from remaining write |
| `src/component/queries.ts` | MODIFY | Cursor-based pagination on list/listByTag, simplify getUsage to counter-only (remove event scan), add getConfig query |
| `src/component/schema.ts` | MODIFY | **Remove `apiKeyEvents` table entirely.** Add tag index (by_owner_tag). Remove aggregate/crons component registration if unused. |
| `src/component/convex.config.ts` | MODIFY | Remove `aggregate`, `crons`, and `rateLimiter` component registrations (rate limiting is integrator's responsibility; events removed) |
| `src/component/validators.ts` | MODIFY | Add keyPrefix/env charset validators, size cap validators, config bound validators |
| `src/shared.ts` | MODIFY | Add keyPrefix/env validation functions, KEY_PREFIX_PATTERN/ENV_PATTERN constants. Remove EVENT_TYPE validator (no event table). |
| `src/client/index.ts` | MODIFY | Remove client-side hash/secret generation from create() AND rotate(), move to server. Add ownerId as required arg on admin mutations. Add pagination params to list/listByTag. Simplify getUsage (counter-only). |
| `src/client/types.ts` | MODIFY | Add PaginatedResult, ConfigResult types. Update CreateKeyOptions (remove hash/lookupPrefix/secretHex). Add ownerId to admin mutation args. Remove KeyEvent type. |
| `src/log.ts` | MODIFY | Add structured validate outcome logging (replaces event table as audit trail) |
| `README.md` | MODIFY | Align claims with implementation, migration guide with before/after code examples, document new APIs |
| `example/convex/example.ts` | AFFECTED | Must update to new client API (no hash/secret params, ownerId on admin ops, pagination on list) |
| `example/convex/example.test.ts` | AFFECTED | Existing 69 tests must be updated (create() args change, ownerId added). Add auth boundary, rate-limit, malformed probe tests |

**Files:** 0 create | 10 modify | 2 affected
**Reuse:** Existing `ShardedCounter` instance, `TAG_PATTERN` regex, `parseKeyString`, `sha256Hex`, `timingSafeEqual`
**Breaking changes:**
- `create()` client API — removes `hash`, `lookupPrefix`, `secretHex` from args (secret gen moves server-side)
- `rotate()` client API — removes `lookupPrefix`, `secretHex` from args (same fix)
- Admin mutations (revoke/disable/enable/update/rotate) — `ownerId` becomes required arg
- `list()`/`listByTag()` return paginated results (type-level break: `KeyMetadata[]` -> `PaginatedResult`)
- `getUsage()` — removes `period` param (counter-only, no event scan)
- `apiKeyEvents` table removed — audit trail moves to structured logs
- Migration path: bump to v0.2.0, include before/after code examples in README
**New dependencies:** None

## User Journey (MANDATORY)

### Primary Journey

ACTOR: Convex developer integrating `@vllnt/convex-api-keys` as a component
GOAL: Use the component safely in production with multi-tenant isolation, scale, and observability
PRECONDITION: Component installed, schema deployed, `ApiKeys` client instantiated

1. Developer calls `apiKeys.create(ctx, { name, ownerId, ... })`
   -> System generates secret material server-side, stores only hash
   -> Developer receives `{ keyId, key }` — raw key returned once

2. End-user sends API key in request header
   -> Developer calls `apiKeys.validate(ctx, { key })`
   -> System validates hash, returns scopes/metadata (rate limiting is integrator's responsibility at HTTP layer)
   -> Developer uses result for authorization

3. Developer calls `apiKeys.list(ctx, { ownerId, cursor? })`
   -> System returns paginated results scoped to owner
   -> Developer renders key management UI

4. Developer calls `apiKeys.revoke(ctx, { keyId, ownerId })`
   -> System asserts key.ownerId === args.ownerId, transitions to revoked
   -> Structured log emitted (replaces event table)

5. Developer monitors usage via `apiKeys.getUsage(ctx, { keyId })`
   -> System returns O(1) usage count from ShardedCounter
   -> Developer sees dashboard data without scan overhead

POSTCONDITION: Keys are managed with auth boundaries, paginated queries, and structured audit logging

### Error Journeys

E1. Cross-tenant access attempt
    Trigger: Caller passes keyId they don't own to revoke/update/disable/enable
    1. Developer calls `apiKeys.revoke(ctx, { keyId, ownerId })`
       -> System checks ownerId matches key's ownerId
       -> System throws "unauthorized: key does not belong to owner"
    Recovery: Caller corrects to their own keyId

E2. Brute-force key probing
    Trigger: Attacker sends many random/malformed keys to validate
    -> Component returns `{ valid: false, reason: "malformed" | "not_found" }` quickly (no writes on miss)
    -> **Rate limiting is the integrator's responsibility** at their HTTP action/mutation layer using `@convex-dev/rate-limiter` with real caller context (IP, auth, etc.)
    Recovery: Integrator adds rate limiting at their API boundary where they have caller context

E3. Config poisoning
    Trigger: Caller sets cleanupIntervalMs to 0 or negative
    1. Developer calls `apiKeys.configure(ctx, { cleanupIntervalMs: -1 })`
       -> System validates bounds (min 1h, max 30 days)
       -> System throws "cleanupIntervalMs must be between 3600000 and 2592000000"
    Recovery: Caller provides valid value

E4. Unbounded list at scale
    Trigger: Owner has 10,000+ keys, calls list() without pagination
    1. Developer calls `apiKeys.list(ctx, { ownerId })`
       -> System returns first page (default 100) with cursor
       -> Developer uses cursor for next page
    Recovery: No recovery needed — pagination is automatic

### Edge Cases

EC1. Rotate finite-use key: quota must not duplicate across old + new key during grace period
EC2. revokeByTag with 500+ matching keys: must batch via scheduler, not single mutation
EC3. Empty metadata/scopes/tags: system accepts gracefully, no null vs undefined confusion
EC4. Key with env containing underscores: rejected by charset validator (would break parsing)
EC5. Concurrent validate on same key: lastUsedAt throttled to avoid OCC contention
EC6. gracePeriodMs=0 on rotate: rejected by min bound (60s) — prevents instant-expire during rotation

## Acceptance Criteria (MANDATORY)

### Must Have (BLOCKING — all must pass to ship)

- [ ] AC-1: GIVEN a mutation (revoke/disable/enable/update/rotate) WHEN caller provides keyId with ownerId that doesn't match key's ownerId THEN system throws "unauthorized" error. ownerId is a **required arg** on all admin mutations.
- [ ] AC-2: GIVEN a create() OR rotate() call WHEN client sends options THEN secret material (lookupPrefix, secretHex, hash) is generated inside the component mutation, not passed from client. Applies to both create() and rotate().
- [ ] AC-3: GIVEN a create() call WHEN keyPrefix contains non-alphanumeric chars THEN system rejects with validation error
- [ ] AC-4: GIVEN a create() call WHEN env contains underscores THEN system rejects with "env must match ^[a-zA-Z0-9-]+$"
- [ ] AC-5: GIVEN a rotate() call WHEN gracePeriodMs < 60s (min) OR > 30 days (max) THEN system rejects with bounds error. Minimum prevents instant-expire during rotation.
- [ ] AC-6: GIVEN a configure() call WHEN any input is negative or zero THEN system rejects with bounds error
- [ ] AC-7: GIVEN any configure() call THEN system emits structured log with old/new values
- [ ] AC-8: GIVEN create/update with metadata > 4KB or scopes > 50 or tags > 20 THEN system rejects with size error
- [ ] AC-9: GIVEN any validate() outcome (success, malformed, not_found, revoked, etc.) THEN structured log emitted with outcome, keyId (if matched), and reason. **Structured logs are the audit trail** (replaces apiKeyEvents table).
- [ ] AC-10: GIVEN README claims WHEN compared to implementation THEN all documented features either exist or are explicitly marked "coming in vX.Y". Includes migration guide with before/after code examples for all breaking changes.
- [ ] AC-11: GIVEN successful validate() calls WHEN lastUsedAt delta < 60s THEN skip ONLY the lastUsedAt write. The remaining decrement (if applicable) MUST still execute regardless of throttle. These are decoupled write paths.
- [ ] AC-12: GIVEN list()/listByTag() WHEN result set is large THEN cursor-based pagination is used, no unbounded .collect()
- [ ] AC-13: GIVEN revokeByTag() WHEN matching keys > batch size THEN operation uses scheduler continuation pattern (internal mutation with cursor, not recursive scheduler)
- [ ] AC-14: GIVEN revokeByTag() WHEN keys are in "rotating" or "disabled" status THEN those keys are also revoked (not silently skipped)
- [ ] AC-15: GIVEN getUsage() THEN result comes from ShardedCounter (O(1)). Period-based event scan removed (no event table).
- [ ] AC-16: GIVEN all mutations that previously inserted apiKeyEvents THEN those inserts are replaced with structured logging via log.ts. No event table writes. @convex-dev/rate-limiter removed from component (rate limiting is integrator's responsibility).

### Error Criteria (BLOCKING — all must pass)

- [ ] AC-E1: GIVEN cross-tenant keyId on any admin mutation WHEN ownerId doesn't match THEN error thrown, no state change occurs
- [ ] AC-E2: GIVEN config with invalid bounds WHEN configure() called THEN error thrown, config unchanged
- [ ] AC-E3: GIVEN key segment (prefix/env) with invalid charset WHEN create() called THEN error thrown, no key created
- [ ] AC-E4: GIVEN rotate() with gracePeriodMs=0 or gracePeriodMs=-1 THEN error thrown, no rotation occurs

### Should Have (ship without, fix soon)

- [ ] AC-17: GIVEN a getConfig() query WHEN called THEN returns current config values (trivial — config is currently write-only)
- [ ] AC-18: GIVEN a finite-use key WHEN rotate() called THEN quota is shared (not duplicated) across old + new key
- [ ] AC-19: GIVEN ApiKeysConfig WHEN logger is provided THEN component uses injected logger transport

## Scope

**Ordering note:** Scope item 2 is a cascade dependency — it changes create()/rotate() args, which breaks example.ts and all tests that call create(). Implement item 2 first, update example + tests to compile, THEN proceed with remaining items.

- [ ] 1. Add ownerId as **required arg** on revoke/disable/enable/update/rotate; assert key.ownerId === args.ownerId before state change -> AC-1, AC-E1
- [ ] 2. Move secret generation (lookupPrefix, secretHex, hash) into component mutations for **both create() AND rotate()**; remove from client args -> AC-2 **(IMPLEMENT FIRST — gates test updates)**
- [ ] 3. Decouple remaining decrement from lastUsedAt write in validate; throttle lastUsedAt only (skip if delta < 60s) -> AC-11
- [ ] 4. Add keyPrefix charset validator (^[a-zA-Z0-9]+$) -> AC-3, AC-E3
- [ ] 5. Add env charset validator (^[a-zA-Z0-9-]+$, no underscores) -> AC-4, AC-E3
- [ ] 6. Enforce gracePeriodMs bounds on rotate: min 60s, max 30 days -> AC-5, AC-E4
- [ ] 7. Add bounds validation on configure() inputs (min/max ranges, no negative) -> AC-6, AC-E2
- [ ] 8. Replace configure() event insert with structured log of old/new diff -> AC-7
- [ ] 9. Cap metadata (4KB), scopes (50), tags (20), string fields (256 chars) -> AC-8
- [ ] 10. Replace ALL apiKeyEvents inserts with structured logging; add validate outcome logging -> AC-9, AC-16
- [ ] 11. Align README with implementation + migration guide (before/after code examples for all breaking changes) -> AC-10
- [ ] 12. Remove `apiKeyEvents` table from schema; remove EVENT_TYPE from shared.ts; clean up all event insert code -> AC-16
- [ ] 13. Simplify getUsage() to ShardedCounter-only (remove period param + event scan) -> AC-15
- [ ] 14. Add cursor-based pagination to list(), listByTag() -> AC-12
- [ ] 15. Add tag index or optimize listByTag query path -> AC-12
- [ ] 16. Paginate revokeByTag via internal mutation with cursor continuation -> AC-13
- [ ] 17. Expand revokeByTag to include rotating + disabled statuses -> AC-14
- [ ] 18. Remove `@convex-dev/rate-limiter`, `aggregate`, `crons` from convex.config.ts + remove rateLimiter usage from mutations.ts -> AC-16

### Out of Scope

- **Rate limiting** (1.3, 1.4, 3.4) — **removed from component entirely.** Rate limiting is a cross-cutting concern that belongs in the integrator's HTTP action/mutation layer where they have real caller context (IP, auth, plan tier). The component has zero caller context — it cannot make informed rate-limit decisions. Integrators should use `@convex-dev/rate-limiter` directly in their Convex functions. The `@convex-dev/rate-limiter` dependency is removed from the component.
- **Event retention cron** (3.1) — no longer needed; apiKeyEvents table removed. Structured logs handled by Convex platform log retention.
- **Expired key sweep cron** (3.2) — keys expire lazily during validate(). Proactive sweep deferred to v1.2 if needed based on production data.
- **Time-bucketed usage aggregation** (3.3) — removed with event table. ShardedCounter provides O(1) total count. Period-based analytics deferred to v1.2 (requires external analytics pipeline, not in-component event scanning).
- **Configurable rate-limit policy per key/owner/tier** (3.4) — deferred to v0.3. Current hardcoded policy is acceptable for v0.2.
- **Finite-use rotation semantics** (3.5, H7) — deferred to v0.3. Acknowledged as HIGH severity; requires design decision on shared-quota vs block-rotation. Documenting the current behavior (quota duplication) in README as known limitation.
- **Actor/source metadata on audit** (3.6, H6) — deferred to v0.3. Structured logs include function name + args context via Convex platform; explicit actor field deferred.
- **Injectable logger** (3.7) — deferred to v0.3. Current console-based logger is sufficient for v0.2.
- **onEvent dispatch hook** (4.1) — v2.0
- **Type-safe metadata generics** (4.2) — v2.0
- **Key format versioning** (4.3) — v2.0
- **HMAC-SHA256 with server-side pepper** (4.4) — v2.0
- **Middleware/plugin composition** (4.5) — v2.0
- **Admin cross-owner listing** (4.6) — v2.0
- **Offline/edge validation** (4.7) — v2.0

## Quality Checklist

### Blocking (must pass to ship)

- [ ] All Must Have ACs passing (AC-1 through AC-16)
- [ ] All Error Criteria ACs passing (AC-E1 through AC-E4)
- [ ] All 18 scope items implemented
- [ ] No regressions in existing tests (tests updated for new API)
- [ ] Error states handled (not just happy path)
- [ ] No hardcoded secrets or credentials
- [ ] No unbounded .collect() in any public query or mutation
- [ ] All admin mutations require + check ownerId before state change
- [ ] apiKeyEvents table fully removed; no residual event inserts
- [ ] @convex-dev/rate-limiter fully removed from component
- [ ] README claims match implementation 1:1 with migration guide
- [ ] remaining decrement NOT affected by lastUsedAt throttle

### Advisory (should pass, not blocking)

- [ ] All Should Have ACs passing (AC-17 through AC-19)
- [ ] Code follows existing project patterns (mutation/query separation, jsonValue alias, TAG_PATTERN style)
- [ ] New validators follow shared.ts pattern (exported const + function)
- [ ] Test coverage for auth boundary, malformed probes, large-tenant pagination

## Test Strategy (MANDATORY)

### Test Environment

| Component | Status | Detail |
|-----------|--------|--------|
| Test runner | detected | vitest with @edge-runtime/vm |
| E2E framework | not applicable | Backend component — no UI. Integration tests via convex-test |
| Test DB | in-memory | convex-test provides in-memory Convex runtime |
| Mock inventory | 0 mocks | All tests use real convex-test runtime with registered child components |

### AC -> Test Mapping

| AC | Test Type | Test Intention |
|----|-----------|----------------|
| AC-1 | Integration | Cross-tenant revoke/disable/enable/update/rotate all throw "unauthorized" with ownerId mismatch |
| AC-2 | Integration | create() and rotate() no longer accept hash/lookupPrefix/secretHex; server generates them |
| AC-3 | Unit | keyPrefix with special chars rejected |
| AC-4 | Unit | env with underscores rejected |
| AC-5 | Integration | gracePeriodMs < 60s and > 30d both rejected on rotate |
| AC-6 | Integration | configure() with negative/zero/out-of-range values rejected |
| AC-7 | Integration | configure() produces structured log with old + new values |
| AC-8 | Integration | Oversized metadata/scopes/tags rejected on create and update |
| AC-9 | Integration | Validate outcomes produce structured log (spy on console.log) |
| AC-10 | Manual | README review against implementation + migration guide completeness |
| AC-11 | Integration | Two validates < 60s apart: second skips lastUsedAt but still decrements remaining |
| AC-12 | Integration | list()/listByTag() with 200+ keys returns paginated results with cursor |
| AC-13 | Integration | revokeByTag with many keys uses internal mutation continuation |
| AC-14 | Integration | revokeByTag catches rotating + disabled keys |
| AC-15 | Integration | getUsage() returns counter value (O(1)) |
| AC-16 | Integration | No apiKeyEvents inserts or rateLimiter usage in mutations.ts |
| AC-E1 | Integration | Cross-tenant admin ops: no state change, error thrown |
| AC-E2 | Integration | Bad config: config table unchanged after error |
| AC-E3 | Unit | Invalid charset: no key inserted after error |
| AC-E4 | Integration | gracePeriodMs=0 and gracePeriodMs=-1 both rejected on rotate |

### Failure Mode Tests (MANDATORY)

| Source | ID | Test Intention | Priority |
|--------|----|----------------|----------|
| Error Journey | E1 | Integration: cross-tenant keyId on all 5 admin mutations -> all throw, zero state change | BLOCKING |
| Error Journey | E3 | Integration: negative config values -> config table unchanged | BLOCKING |
| Error Journey | E4 | Unit: keyPrefix "my_app" and env "live_test" both rejected | BLOCKING |
| Edge Case | EC5 | Integration: 2 validates < 60s apart -> lastUsedAt skipped but remaining decremented | BLOCKING |
| Edge Case | EC6 | Integration: gracePeriodMs=0 on rotate -> rejected with bounds error | BLOCKING |
| Failure Hypothesis | FH-1 (HIGH) | Integration: revokeByTag with 100+ keys -> completes without mutation timeout | BLOCKING |
| Failure Hypothesis | FH-2 (HIGH) | Integration: ownerId omitted -> operation fails, not silently succeeds | BLOCKING |

### Mock Boundary

| Dependency | Strategy | Justification |
|------------|----------|---------------|
| @convex-dev/sharded-counter | Real (convex-test) | Already registered via shardedCounterTest.register() |

### TDD Commitment

All tests written BEFORE implementation (RED -> GREEN -> REFACTOR).
Every Must Have + Error AC tracked in test file.

## Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Breaking changes on create()/rotate()/admin mutations | HIGH | HIGH | Bump to v0.2.0, migration guide in README with before/after code examples |
| Pagination type change breaks existing list() consumers | HIGH | HIGH | Return type changes from `KeyMetadata[]` to `PaginatedResult` — unavoidable type break. Document migration. |
| Scope item 2 cascades into all 69 tests | HIGH | HIGH | Implement first, update example + tests before proceeding. Budget 3-4h for this alone. |
| revokeByTag continuation pattern: initial .collect() is still unbounded | MED | MED | Use internal mutation with cursor-based iteration from the start (not collect-then-batch) |
| OCC contention on lastUsedAt throttle | MED | LOW | Throttle reduces but does NOT eliminate OCC retries under burst. Architectural fix (decoupling auth check from analytics write via query + scheduler pattern) deferred to v2.0. |
| Removing apiKeyEvents loses historical audit data on upgrade | MED | MED | Document in migration guide: existing event data should be exported before upgrading. Structured logs replace going forward. |
| Finite-use key rotation duplicates quota (H7, deferred) | HIGH | LOW | Documented as known limitation in README. Deferred to v0.3 — requires design decision. |

**Kill criteria:** If pagination API proves too disruptive for v0.2, ship as opt-in parameter with unbounded default (and deprecation warning). If test update cascade for scope item 2 exceeds 4h, consider shipping auth/validation items (1, 3-10) first in a v0.2 without the create() API break.

## State Machine

### Key Status (existing — no changes to states, only to transition guards)

```
                    create()
                       │
                       ▼
                 ┌──────────┐
          ┌──────│  active   │──────┐
          │      └──────────┘      │
     disable()        │        rotate()
          │       revoke()         │
          ▼           │            ▼
    ┌──────────┐      │     ┌───────────┐
    │ disabled │      │     │ rotating  │
    └──────────┘      │     └───────────┘
     enable()│  revoke()│     │grace end
          │           │            │
          ▼           ▼            ▼
    ┌──────────┐ ┌──────────┐ ┌──────────┐
    │  active  │ │ revoked  │ │ expired  │
    └──────────┘ └──────────┘ └──────────┘
                                   ▲
                              expiresAt <= now
                                   │
                              (validate check)

    ┌───────────┐
    │ exhausted │  ← remaining reaches 0 during validate
    └───────────┘

Terminal: revoked, expired, exhausted (no further transitions)
```

**Changes in this spec:**
- All transitions from non-terminal states require ownerId match (AC-1)
- `revokeByTag` now transitions `rotating` and `disabled` -> `revoked` (AC-16)
- `gracePeriodMs` bounded: min 60s, max 30 days on `rotate()` (AC-7)
- No apiKeyEvents written on transitions — structured logs replace event inserts

**Complexity:** MEDIUM (5 states, 8 transitions, 2 guards) — existing useState-style is acceptable since state is DB-driven.

## Analysis

*Updated after 4-perspective spec review (Security, Convex Platform, DX, Skeptic) on 2026-03-25.*

### Assumptions Challenged

| Assumption | Evidence For | Evidence Against | Verdict |
|------------|-------------|-----------------|---------|
| Scope item 2 cascade is manageable | rotate() already does hash server-side (line 373) | create() args change breaks every test that calls create(). Unknown number of 69 tests affected. Also: rotate() client-side secret gen was missed in original spec. | VALID but HIGH-EFFORT — implement first, budget 3-4h for cascade |
| Rate limiting belongs in the component | Safe-by-default for integrators | Component has zero caller context (no IP, no auth, no plan tier). Hardcoded 1000/min could block legitimate high-volume users. Integrator has real context at their HTTP layer. | WRONG — removed. Rate limiting is integrator's responsibility. |
| lastUsedAt throttle is safe for quota accounting | Reduces OCC contention significantly | Code patches remaining + lastUsedAt in same ctx.db.patch (mutations.ts:221-228). If throttle skips the whole patch, remaining is not decremented = quota bypass. | RESOLVED — AC-11 now explicitly decouples the two write paths |
| Removing apiKeyEvents simplifies without losing value | Events are write-only (no listEvents query), getUsage scans are O(N), retention cron is unproven infrastructure | Loses audit trail in DB — incident investigation requires log search instead of DB query | VALID — structured logs (Convex dashboard) are the standard observability pattern for Convex components. DB-stored events were over-engineering for v1. |
| ownerId as required arg is the right design | Prevents silent bypass (optional would be inert). Component can't derive identity from ctx.auth without coupling to auth provider. | Breaking change on every admin mutation. Ergonomic regression: caller must track ownerId. | VALID — required arg is the only safe choice. Document migration. |

### Blind Spots

1. **[Migration]** Multiple breaking changes (create args, rotate args, admin ownerId, list return type, getUsage API, event table removal) ship simultaneously. No CHANGELOG exists. Migration guide content not yet written.
   Why it matters: v0.1 -> v0.2 upgrade path must be crystal clear or adopters churn.

2. **[Concurrency]** revokeByTag scheduler continuation creates eventually-consistent bulk revoke. During execution, some keys may still be active.
   Why it matters: If consumer expects synchronous "all keys revoked" guarantee, the async pattern breaks their assumption. Document in README.

3. **[Reactive churn]** lastUsedAt write (even throttled to 60s) invalidates all list() reactive query subscribers watching that owner. Not fixed by throttle — only reduced.
   Why it matters: Dashboard subscribers get unnecessary re-renders. Architectural fix (deferred write via ctx.scheduler) is v2.0 scope.

4. **[Data loss on upgrade]** Removing apiKeyEvents table deletes existing audit history. No export tooling provided.
   Why it matters: Integrators who relied on event data for debugging/compliance lose it on upgrade.

### Failure Hypotheses

| IF | THEN | BECAUSE | Severity | Mitigation |
|----|------|---------|----------|------------|
| revokeByTag initial query is still unbounded .collect() | Mutation timeout on large tag sets | Even with cursor continuation, the first batch needs an initial query that could be large | HIGH | Use cursor-based iteration from the start: query with .take(batchSize), process batch, schedule continuation with cursor |
| ownerId added as required but old tests don't pass it | All 69 tests fail immediately after scope item 2 | Tests were written against v0.1 API without ownerId on admin ops | HIGH | Budget this in scope item 2 cascade. Update all test helpers first. |
| gracePeriodMs=0 passes validation | Old key instantly expires during rotation; caller loses access | Current code has no min bound check | MED | RESOLVED — AC-5 now specifies min 60s bound |

### The Real Question

Confirmed — the spec now solves the right problem with the right scope. Removing apiKeyEvents eliminates the two largest unknowns (aggregate wiring, retention cron) and simplifies the component from "infrastructure that stores analytics" to "infrastructure that authenticates and delegates observability to the platform." The ShardedCounter + structured logs combination is the idiomatic Convex pattern.

The remaining risk is the breaking-change cascade (scope item 2 + ownerId + pagination). This is manageable with the ordering constraint (item 2 first) and a realistic 14h estimate. Removing rate limiting and events cut ~4h of complexity and eliminated the two largest integration unknowns.

### Open Items

- [gap] No CHANGELOG.md exists — create one as part of scope item 12 -> update spec (included in scope 12)
- [risk] revokeByTag initial query needs cursor-from-start design, not collect-then-batch -> no action (addressed in AC-15 wording)
- [question] Should we ship a v0.2 with non-breaking items first (items 3-10) and then v0.2 with breaking items (1-2, 15-16)? -> question for user
- [improvement] Consider splitting into 2 PRs: (a) non-breaking hardening v0.2, (b) breaking API changes v0.2 -> question for user

## Notes

### Ship Retro (2026-03-25)
**Estimate vs Actual:** 14h -> ~4h (286% faster)
**What worked:** Consolidating 33 roadmap items into 18 scope items prevented scope sprawl. Removing apiKeyEvents + rate-limiter cut ~60% of complexity. Ordering scope item 2 first (cascade dependency) avoided test rework. Parallel spec review (4 agents) caught 12 issues before any code was written.
**What didn't:** Generated component types (`_generated/component.ts`) had to be manually updated since `convex codegen` requires auth. Minor friction.
**Next time:** Spike aggregate/crons component APIs before including them in spec scope. Unverified integrations should never be Must Have ACs.

## Progress

| # | Scope Item | Status | Iteration |
|---|-----------|--------|-----------|
| 1 | ownerId required on admin mutations | pending | - |
| 2 | Server-side secret gen (create + rotate) | pending | - |
| 3 | Decouple remaining/lastUsedAt writes + throttle | pending | - |
| 4 | keyPrefix validator | pending | - |
| 5 | env validator | pending | - |
| 6 | gracePeriodMs min/max bounds | pending | - |
| 7 | configure() bounds | pending | - |
| 8 | configure() structured logging | pending | - |
| 9 | Size caps | pending | - |
| 10 | Replace all event inserts with structured logging | pending | - |
| 11 | README + migration guide | pending | - |
| 12 | Remove apiKeyEvents table + EVENT_TYPE | pending | - |
| 13 | Simplify getUsage to counter-only | pending | - |
| 14 | Cursor pagination (list, listByTag) | pending | - |
| 15 | Tag index optimization | pending | - |
| 16 | revokeByTag cursor continuation | pending | - |
| 17 | revokeByTag status expansion | pending | - |
| 18 | Remove rateLimiter + aggregate + crons | pending | - |

## Timeline

| Action | Timestamp | Duration | Notes |
|--------|-----------|----------|-------|
| plan | 2026-03-25T00:00:00Z | - | Created from ROADMAP.md + DEEP-ANALYSIS.md |
| spec-review | 2026-03-25T00:00:00Z | - | 4-perspective review (Security, Convex, DX, Skeptic). 12 action items applied. Removed apiKeyEvents table per user decision. Cut crons/aggregates. |
| revision | 2026-03-25T00:00:00Z | - | Removed @convex-dev/rate-limiter — rate limiting is integrator's responsibility at HTTP layer. 19 -> 18 scope items. Estimate 18h -> 14h. |
| ship | 2026-03-25T00:00:00Z | - | Implemented all 18 scope items. 82 tests passing. |
| review | 2026-03-25T00:00:00Z | - | 7-perspective deep review. 4 fixes applied (double-patch, getUsage ownerId, UsageStats.lastUsedAt, +14 tests). |
| done | 2026-03-25T00:00:00Z | ~4h | Shipped. PR #37 created. |
