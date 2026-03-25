# Deep Analysis: @vllnt/convex-api-keys

**Mode**: Deep | **Perspectives**: 7 (Security, Adversarial, Performance, Scalability, Extensibility, Observability, API Design)
**Date**: 2026-03-24 | **Verification**: static repo review + `pnpm test` + `pnpm typecheck`

## The Essence

A Convex component with solid API-key storage basics, but the main production risks are not cryptographic. The hard problems here are authorization boundaries, write-heavy validation, unbounded collection scans, and an operational story that is weaker than the README suggests.

## Executive Summary

The repository gets several important fundamentals right: keys are stored hashed, lookups are prefix-indexed, and comparison uses a timing-safe helper. However, the merged analysis converges on three critical issues:

1. `validate()` is a write transaction on the hot auth path.
2. The component has no built-in authorization boundary.
3. Several admin and analytics paths do unbounded scans, while cleanup and aggregation are configured but not actually implemented.

This means the package is acceptable for modest trusted-server usage, but not yet secure-by-default or scale-ready as a public reusable component.

---

## Verification Snapshot

- `pnpm test` passed: 69 tests across unit and example integration coverage.
- `pnpm typecheck` passed.
- Findings below are based on code in `src/` and the example app in `example/convex/`, not just README claims.

---

## Verified Facts

- Keys are stored as SHA-256 hashes in `apiKeys.hash`, not raw secrets.
  Evidence: `src/component/schema.ts:7-28`, `src/shared.ts:114-121`
- Key lookups are prefix-indexed through `lookupPrefix`.
  Evidence: `src/component/schema.ts:26`, `src/component/mutations.ts:130-133`
- `validate()` is implemented as a mutation and writes on successful validation.
  Evidence: `src/component/mutations.ts:102-277`
- `list()`, `listByTag()`, `getUsage(period)`, and `revokeByTag()` all use `.collect()`.
  Evidence: `src/component/queries.ts:54`, `src/component/queries.ts:97-103`, `src/component/queries.ts:145-151`, `src/component/mutations.ts:311-330`
- `aggregate` and `crons` child components are registered, but no repo code uses them for cleanup or analytics reads.
  Evidence: `src/component/convex.config.ts:9-12`, `src/component/queries.ts:137-160`, `src/component/mutations.ts:496-510`
- The public example forwards `ownerId` and `keyId` directly into component APIs and does not use `ctx.auth`.
  Evidence: `example/convex/example.ts:19-216`

---

## Failure Hypotheses (Merged, Prioritized)

### Critical

| ID | Failure | Why It Matters | Evidence | Mitigation |
|---|---|---|---|---|
| **C1** | **No built-in authorization boundary** | If an app exposes these wrappers directly, any caller with a `keyId` or `ownerId` can attempt cross-tenant admin operations | `src/component/mutations.ts:279-510`, `src/component/queries.ts:10-162`, `example/convex/example.ts:19-216` | Add an explicit ownership/auth hook or require an app-supplied authorizer for every admin read/write surface |
| **C2** | **`validate()` is a write-heavy hot path** | Every successful auth check patches state, inserts an event, and increments a counter; high-volume keys will see contention and unnecessary invalidations | `src/component/mutations.ts:208-263` | Split auth check from analytics tracking, or at minimum threshold/async `lastUsedAt` updates |
| **C3** | **Unbounded scans on admin and analytics paths** | Tenant growth and event growth will turn listing, tag filtering, bulk revoke, and period usage queries into scale bottlenecks | `src/component/queries.ts:54`, `src/component/queries.ts:97-103`, `src/component/queries.ts:145-151`, `src/component/mutations.ts:311-330` | Add pagination, tag indexing/join tables, and bounded batch processing |

### High

| ID | Failure | Why It Matters | Evidence | Mitigation |
|---|---|---|---|---|
| **H1** | **Server-side invariants are weaker than claimed** | `create()` accepts caller-supplied `hash`, `lookupPrefix`, and `secretHex`; integrity depends on caller honesty instead of server derivation | `src/client/index.ts:61-81`, `src/component/mutations.ts:29-44`, `src/component/mutations.ts:65-98` | Generate secret material and derive hash inside the component mutation or behind an internal mutation |
| **H2** | **Rate limit runs after state mutation** | Rate-limited validations can still burn `remaining` quota and write `lastUsedAt` first | `src/component/mutations.ts:208-245` | Reorder validate flow: parse -> find -> rate limit -> mutate usage state |
| **H3** | **No pre-match throttle on malformed/unknown probes** | Attackers can cheaply probe malformed keys or random prefixes without hitting per-key rate limits | `src/component/mutations.ts:125-150`, `src/component/mutations.ts:242-253` | Add global/per-prefix throttling before matched-key state writes |
| **H4** | **Advertised features exceed implemented behavior** | README promises event callbacks, scheduled cleanup, and O(log n) analytics, but the code does not currently provide those behaviors | `README.md:20`, `README.md:28-29`, `src/component/convex.config.ts:9-12`, `src/component/queries.ts:143-154`, `src/component/mutations.ts:496-510` | Narrow docs now or implement the missing features |
| **H5** | **Bulk tag operations are owner scans plus JS filtering** | `listByTag()` and `revokeByTag()` do not scale with large tenants and are easy abuse targets | `src/component/queries.ts:96-118`, `src/component/mutations.ts:304-332` | Add `by_owner_tag` support or a tag join table; batch revoke continuations |
| **H6** | **Audit model is too thin for incident response** | Events have no actor, source, or request metadata, and `eventType` is just `v.string()` | `src/component/schema.ts:30-39` | Use a typed event validator and include actor/source/request context |
| **H7** | **Rotation duplicates finite-use quota during grace** | `rotate()` copies `remaining` to the new key while the old key still validates during grace, effectively duplicating budget | `src/component/mutations.ts:360-390`, `src/component/mutations.ts:208-240`, `example/convex/example.test.ts:518-544` | Share quota across rotated keys or block rotation for finite-use keys |

### Medium

| ID | Failure | Why It Matters | Evidence | Mitigation |
|---|---|---|---|---|
| M1 | No pagination on list surfaces | Public APIs return unbounded arrays | `src/component/queries.ts:10-120` | Add cursor-based pagination |
| M2 | `prefix` / `env` are not validated against `_` separator semantics | Docs say `env` can be any string, but underscores break parsing | `README.md:64-66`, `README.md:78`, `src/shared.ts:83-100` | Validate allowed charset for key segments |
| M3 | Metadata, scopes, and tags have no size/cardinality limits | Large payloads can bloat documents and responses | `src/component/schema.ts:15-20`, `src/component/queries.ts:56-70`, `src/component/validators.ts:1-4` | Add explicit caps and document them |
| M4 | Event history is effectively write-only | No paginated event query exists for operators | `src/component/schema.ts:30-39`, no corresponding query in `src/component/queries.ts` | Add `listEvents()` |
| M5 | Rate-limit policy is hardcoded and global | Real deployments need tenant-, key-, or plan-specific policies | `src/component/mutations.ts:22-25` | Support configurable rate-limit policy |
| M6 | Cleanup-related config is stored but unused | `cleanupIntervalMs` and `defaultExpiryMs` currently do not change runtime behavior | `src/component/schema.ts:41-44`, `src/component/mutations.ts:496-510` | Implement retention/cleanup and default expiry wiring |
| M7 | Tests do not exercise auth, rate-limited branches, cleanup, or large-data behavior | Current passing suite does not de-risk the scale and misuse cases above | `example/convex/example.test.ts` | Add targeted misuse and scale tests |

---

## Cross-Cutting Concerns

1. **Security model ambiguity**
   The package behaves like infrastructure, but its public surfaces assume the host app will add authorization externally. That is too implicit for a reusable component.

2. **Write amplification**
   Validation is both an auth check and a synchronous analytics pipeline. That couples correctness to throughput.

3. **Operational gaps**
   Event retention, cleanup, actor-aware audits, and scalable usage analytics are all partial at best.

4. **Doc and implementation drift**
   The package markets stronger operational capabilities than the repository currently contains.

---

## Assumptions To Challenge

| Assumption | Evidence For | Evidence Against | Verdict |
|---|---|---|---|
| "Owner scoping is enough for multi-tenant safety" | Queries and some mutations carry `ownerId` | Caller identity is never derived or checked in component code | **Discard** |
| "Every validation must synchronously update usage state" | Nice for dashboards and quota accounting | Creates the hottest contention point in the system | **Validate** |
| "Child components mean cleanup and aggregation are implemented" | `aggregate` and `crons` are registered | No cleanup job or aggregate-backed read path exists | **Discard** |
| "Current tests prove production readiness" | Tests are broad for normal lifecycle flows | They do not cover auth boundaries, load behavior, or retention logic | **Discard** |

---

## What You Haven't Considered

1. **Reactive query churn**
   Because `validate()` patches `lastUsedAt`, any owner-scoped list subscriber can be invalidated by routine auth traffic.

2. **Quota duplication on rotate**
   For finite-use keys, rotation is not just a status transition. It creates two concurrently valid keys with copied `remaining` state.

3. **Invisible malformed traffic**
   `malformed` and unknown-key attempts return quickly, but they are not promoted into a robust operator-facing audit stream.

4. **Segment encoding contract**
   The underscore-delimited key format is stricter than the public docs imply; allowing arbitrary `env`/prefix strings creates parsing hazards.

---

## The Real Question

Not "is the crypto acceptable?" but **"can this component stay correct, isolated, and observable under hostile or high-volume traffic?"**

Today the answer is: only if the integrating app adds strong authorization and the workload remains modest.

---

## Action Plan & Roadmap

### Immediate (Before broader production use)

| # | Action | Addresses | Effort |
|---|---|---|---|
| 1 | Add an explicit authorization/ownership hook for every admin read/write operation | C1 | Medium |
| 2 | Reorder `validate()` so rate limiting happens before quota burn and usage writes | C2, H2 | Small |
| 3 | Add pagination to `list()` and `listByTag()` | C3, M1 | Small |
| 4 | Validate key-segment inputs (`prefix`, `env`) and configuration bounds | M2, M6 | Small |
| 5 | Move secret generation and hash derivation fully server-side | H1 | Medium |
| 6 | Tighten event typing and add actor/source metadata | H6 | Medium |
| 7 | Align README claims with implemented behavior | H4 | Small |

### Short-Term (1-2 Weeks)

| # | Action | Addresses | Effort |
|---|---|---|---|
| 8 | Add tag indexing or a join table for tag lookups | C3, H5 | Medium |
| 9 | Batch `revokeByTag()` via continuation/scheduler pattern | C3, H5 | Medium |
| 10 | Add `listEvents()` with pagination and filters | H6, M4 | Medium |
| 11 | Cap metadata size and array lengths for `scopes` / `tags` | M3 | Small |
| 12 | Add tests for auth boundaries, rate-limited outcomes, and malformed probe handling | H3, M7 | Medium |

### Medium-Term (1 Month)

| # | Action | Addresses | Effort |
|---|---|---|---|
| 13 | Implement retention/cleanup using the stored config | C3, M6 | Medium |
| 14 | Decouple `lastUsedAt` from every successful validation | C2 | Medium |
| 15 | Replace event scans in `getUsage(period)` with time-bucketed aggregation | C3, H4 | Large |
| 16 | Make rate-limit policy configurable by tenant/key/plan | M5 | Medium |
| 17 | Decide rotation semantics for finite-use keys and enforce them in code | H7 | Medium |

### Long-Term

| # | Action | Addresses | Effort |
|---|---|---|---|
| 18 | Split authentication from analytics tracking into separate durability classes | C2, C3 | Large |
| 19 | Add explicit extension points for callbacks/webhooks only after the audit model is stable | H4, H6 | Large |
| 20 | Revisit key format versioning before wider adoption | M2 | Medium |

---

## Severity Distribution

```text
Critical : 3
High     : 7
Medium   : 7
```

## Bottom Line

This is a strong v0.1 lifecycle component with good hashing/storage basics and a solid happy-path test suite. The merged review does not say "rewrite it"; it says tighten the trust boundary, remove avoidable hot-path writes, and make the operational model real before claiming production-grade security and scale.
