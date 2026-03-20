---
title: "@vllnt/convex-api-keys — Convex Component for API Key Management"
status: active
created: 2026-03-19
estimate: 12h
tier: standard
---

# @vllnt/convex-api-keys — Convex Component for API Key Management

## Context

Convex apps need to issue, validate, and revoke API keys for programmatic access (SDKs, webhooks, third-party integrations). No existing Convex component covers this. Developers roll their own — usually insecure (raw key storage), missing rotation/expiry, no usage tracking, no multi-tenant isolation, no rate limiting. This component provides a production-grade, secure-by-default API key management system as a reusable Convex component, leveraging the official `@convex-dev/*` ecosystem for maximum reliability and minimal reinvention.

### Design Principles

1. **Compose, don't build** — leverage `@convex-dev/rate-limiter`, `sharded-counter`, `aggregate`, `crons` as child components
2. **Secure by default** — SHA-256 hashed storage, constant-time comparison, prefix-indexed lookup, key type separation
3. **Multi-tenant native** — every query scoped by `ownerId`, namespace isolation on all aggregates
4. **Observable** — real-time usage counters, audit events, per-key analytics via aggregate
5. **Extensible** — event callbacks, custom metadata, configurable key format, tag-based filtering, finite-use keys
6. **Environment-aware** — env-encoded key prefixes, configurable rate limits per deployment context
7. **Competitive parity** — feature-complete vs Unkey, Stripe, GitHub token patterns (remaining uses, disable/enable, key types, update-in-place)

### Competitive Positioning

```
┌─────────────────────────────────────────────────────────────────────┐
│                     WHY THIS EXISTS                                  │
├─────────────────────┬───────────────────────────────────────────────┤
│ vs Unkey (SaaS)     │ Self-hosted on your Convex. No vendor.        │
│                     │ Transactional rate limiting (no Redis race).   │
│                     │ Real-time reactive (Convex subscriptions).     │
│                     │ Composable child components.                   │
├─────────────────────┼───────────────────────────────────────────────┤
│ vs Stripe Keys      │ Open source. Tags + bulk ops. Finite-use      │
│                     │ keys. Configurable rotation grace period.      │
│                     │ Environment as first-class concept.            │
├─────────────────────┼───────────────────────────────────────────────┤
│ vs DIY              │ Secure by default (hashed, constant-time).     │
│                     │ Rate limiting, analytics, crons included.      │
│                     │ 1 npm install vs weeks of custom code.         │
├─────────────────────┼───────────────────────────────────────────────┤
│ vs AWS API Gateway  │ No infrastructure. TypeScript-native.          │
│                     │ Granular per-key scopes + tags + metadata.     │
└─────────────────────┴───────────────────────────────────────────────┘
```

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         CONSUMER APP                                 │
│                                                                      │
│  convex.config.ts          app functions              http.ts        │
│  ┌──────────────┐     ┌─────────────────────┐   ┌──────────────┐   │
│  │ app.use(     │     │ apiKeys.create(ctx)  │   │ registerAPI  │   │
│  │   apiKeys)   │     │ apiKeys.validate(ctx)│   │ KeyRoutes()  │   │
│  └──────────────┘     │ apiKeys.list(ctx)    │   └──────────────┘   │
│                       └─────────┬───────────┘                        │
└─────────────────────────────────┼────────────────────────────────────┘
                                  │ ctx.runQuery/Mutation
┌─────────────────────────────────▼────────────────────────────────────┐
│                    @vllnt/convex-api-keys                             │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │                     ApiKeys Client Class                       │  │
│  │  create() validate() revoke() rotate() list() getUsage()     │  │
│  │  update() disable() enable() listByTag() revokeByTag()       │  │
│  │  configure()                                                   │  │
│  └────────────────────────────┬───────────────────────────────────┘  │
│                               │                                      │
│  ┌────────────────────────────▼───────────────────────────────────┐  │
│  │                    Component Backend                            │  │
│  │                                                                │  │
│  │  Tables:                  Functions:                           │  │
│  │  ┌──────────────┐        ┌─────────────────────────────┐     │  │
│  │  │ apiKeys      │        │ public.ts (CRUD + validate) │     │  │
│  │  │ apiKeyEvents │        │ internal.ts (hash, cleanup) │     │  │
│  │  │ config       │        │ crons.ts (expire, cleanup)  │     │  │
│  │  └──────────────┘        └─────────────────────────────┘     │  │
│  │                                                                │  │
│  │  Child Components:                                             │  │
│  │  ┌──────────┐ ┌──────────┐ ┌────────────┐ ┌──────────┐      │  │
│  │  │  rate-   │ │ sharded- │ │ aggregate  │ │  crons   │      │  │
│  │  │ limiter  │ │ counter  │ │ (usage     │ │(cleanup, │      │  │
│  │  │(per-key) │ │(hot path)│ │  analytics)│ │ expire)  │      │  │
│  │  └──────────┘ └──────────┘ └────────────┘ └──────────┘      │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

### Key Format

```
{prefix}_{type}_{env}_{random8}_{secret64}

Examples:
  vk_secret_live_a1b2c3d4_<64-char-hex>     ← production secret key
  vk_secret_test_e5f6g7h8_<64-char-hex>     ← test secret key
  vk_pub_live_i9j0k1l2_<64-char-hex>        ← production publishable key
  vk_pub_test_m3n4o5p6_<64-char-hex>        ← test publishable key

Stored in DB:
  prefix: "a1b2c3d4"        ← for index lookup (8 chars)
  hash: "<sha256-hex>"       ← for verification (never raw key)
  type: "secret" | "pub"     ← key type
  env: "live" | "test" | *   ← environment
```

### Key Lifecycle State Machine

```
                      create()
                         │
                         ▼
                  ┌────────────┐
            ┌────▶│   ACTIVE    │◀────────────────┐
            │     │ (valid key) │                  │
            │     └──────┬──────┘           rotate() creates
        enable()         │                  new key here
            │  ┌─────────┼──────┬──────────┬──────────┐
            │  │         │      │          │          │
            │ disable() revoke() rotate()  expires  exhausted
            │  │         │    (old key)    │     (remaining=0)
            │  ▼         ▼      ▼          ▼          ▼
   ┌────────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐
   │  DISABLED  │ │ REVOKED  │ │ ROTATING │ │ EXPIRED  │ │ EXHAUSTED │
   │(reversible)│ │ (dead)   │ │ (grace)  │ │ (dead)   │ │ (dead)    │
   └────────────┘ └──────────┘ └─────┬────┘ └──────────┘ └───────────┘
                                     │
                               grace ends
                                     ▼
                              ┌──────────┐
                              │ EXPIRED  │
                              └──────────┘
```

**States:** `active`, `disabled`, `revoked`, `rotating`, `expired`, `exhausted`

| From | To | Trigger | Guard | Reversible |
|------|----|---------|-------|------------|
| `active` | `disabled` | `disable()` | none | YES → `enable()` |
| `active` | `revoked` | `revoke()` | none | NO |
| `active` | `rotating` | `rotate()` (old key) | none | NO |
| `active` | `expired` | validate-time check | `expiresAt < now` | NO |
| `active` | `exhausted` | validate-time check | `remaining === 0` | NO |
| `disabled` | `active` | `enable()` | none | — |
| `rotating` | `expired` | cron/validate check | `gracePeriodEnd < now` | NO |

**Terminal states:** `revoked`, `expired`, `exhausted`
**Race conditions:** Convex serializes mutations — no concurrent state transitions.
**Complexity:** MEDIUM (6 states, 7 transitions, 3 guards) → simple status field, no XState

## Codebase Impact (MANDATORY)

| Area | Impact | Detail |
|------|--------|--------|
| `src/component/convex.config.ts` | CREATE | `defineComponent("apiKeys")` + 4 child components |
| `src/component/schema.ts` | CREATE | `apiKeys` (hash, prefix, type, ownerId, scopes, tags, env, status, remaining, metadata, expiresAt, lastUsedAt), `apiKeyEvents` (audit), `config` |
| `src/component/public.ts` | CREATE | create, validate, revoke, rotate, list, listByTag, getUsage, update, disable, enable, revokeByTag, configure |
| `src/component/internal.ts` | CREATE | Hash helpers, cleanup jobs, event logging, counter sync, key generation (action) |
| `src/component/crons.ts` | CREATE | Scheduled: expire keys, cleanup old events |
| `src/client/index.ts` | CREATE | `ApiKeys` class with typed methods + env config |
| `src/client/types.ts` | CREATE | Exported types: `ApiKeyConfig`, `CreateKeyResult`, `ValidationResult`, `KeyMetadata`, `UsageStats`, `KeyEvent`, `KeyType`, `KeyStatus` |
| `src/shared.ts` | CREATE | Shared validators + key format utilities |
| `src/test.ts` | CREATE | `register()` helper for consumer tests |
| `example/convex/convex.config.ts` | CREATE | Multi-tenant SaaS example |
| `example/convex/example.ts` | CREATE | Full CRUD + rate-limit + usage examples |
| `package.json` | CREATE | npm package config |
| `tsconfig.json` / `tsconfig.build.json` | CREATE | TypeScript configs |
| `vitest.config.mts` | CREATE | vitest + edge-runtime |
| `README.md` | CREATE | Comprehensive docs |
| `LICENSE` | CREATE | Apache-2.0 |

**Files:** 16 create | 0 modify | 0 affected
**Reuse:**
- `@convex-dev/rate-limiter` — per-key rate limiting (token bucket + fixed window)
- `@convex-dev/sharded-counter` — high-throughput usage counters (hot write path)
- `@convex-dev/aggregate` — O(log n) usage analytics with namespace isolation
- `@convex-dev/crons` — runtime-registered cleanup/expiry jobs
- `convex-helpers` paginator — pagination for key lists

**Breaking changes:** N/A — greenfield
**New dependencies:**
- `convex` (peerDependency)
- `@convex-dev/rate-limiter`, `@convex-dev/sharded-counter`, `@convex-dev/aggregate`, `@convex-dev/crons` (dependencies)
- `convex-test`, `@edge-runtime/vm` (devDependencies)

## User Journey (MANDATORY)

### Primary Journey: Basic Setup

ACTOR: Convex app developer
GOAL: Add secure, observable, multi-tenant API key management with zero custom infrastructure
PRECONDITION: Existing Convex app with `convex/convex.config.ts`

1. Developer installs:
   ```bash
   npm install @vllnt/convex-api-keys
   ```
   → Single install, all ecosystem deps resolved

2. Developer registers component:
   ```ts
   import apiKeys from "@vllnt/convex-api-keys/convex.config";
   const app = defineApp();
   app.use(apiKeys);
   app.use(apiKeys, { name: "serviceKeys" }); // optional: multiple instances
   ```
   → Component + 4 child components provisioned on `convex dev`

3. Developer instantiates with config:
   ```ts
   import { ApiKeys } from "@vllnt/convex-api-keys";
   import { components } from "./_generated/api";

   const apiKeys = new ApiKeys(components.apiKeys, {
     prefix: "myapp",                                     // key prefix (default: "vk")
     defaultType: "secret",                                // default key type
     rateLimit: {
       validate: { kind: "token bucket", rate: 1000, period: MINUTE },
       create:   { kind: "fixed window", rate: 100, period: HOUR },
     },
     onEvent: internal.audit.logApiKeyEvent,               // optional callback
   });
   ```

4. Developer creates a key:
   ```ts
   const { key, keyId } = await apiKeys.create(ctx, {
     name: "Production SDK Key",
     ownerId: orgId,
     type: "secret",                                       // "secret" | "publishable"
     scopes: ["read:users", "write:orders"],
     tags: ["sdk", "v2"],
     env: "live",
     metadata: { plan: "enterprise", region: "us-east" },
     expiresAt: Date.now() + 90 * DAY,
     remaining: 100000,                                    // optional: finite-use key
   });
   // key = "myapp_secret_live_a1b2c3d4_<64-char-hex>"
   ```
   → SHA-256 hash stored, event logged, counter incremented

5. Developer validates an incoming key:
   ```ts
   const result = await apiKeys.validate(ctx, { key: bearerToken });
   if (!result.valid) {
     // result.reason: "malformed" | "not_found" | "revoked" | "expired"
     //                | "exhausted" | "disabled" | "rate_limited"
     return new Response(result.reason, { status: result.reason === "rate_limited" ? 429 : 401 });
   }
   // result = { valid: true, keyId, ownerId, scopes, tags, env, type, metadata, remaining }
   ```
   → Prefix parse → index lookup → hash compare → status check → remaining decrement → rate limit → usage counter

6. Developer updates key metadata (without rotation):
   ```ts
   await apiKeys.update(ctx, {
     keyId,
     name: "Renamed Key",
     scopes: ["read:users"],                               // update scopes
     tags: ["sdk", "v3"],                                   // update tags
     metadata: { plan: "pro" },                             // update metadata
   });
   ```
   → Key stays the same, only metadata changes

7. Developer disables a key temporarily:
   ```ts
   await apiKeys.disable(ctx, { keyId });
   // validate() → { valid: false, reason: "disabled" }

   await apiKeys.enable(ctx, { keyId });
   // validate() → { valid: true, ... } again
   ```

8. Developer queries usage analytics:
   ```ts
   const usage = await apiKeys.getUsage(ctx, {
     keyId,
     period: { start: startOfMonth, end: now },
   });
   // { total: 42000, remaining: 58000, lastUsedAt: 1711036800000 }
   ```
   → O(log n) aggregate query, reactive

POSTCONDITION: Full API key lifecycle with rate limiting, usage tracking, audit events, tags, environments, key types, finite-use keys, disable/enable — all on ecosystem components

### Primary Journey: Multi-Tenant SaaS

ACTOR: SaaS developer building a platform with per-org API keys
GOAL: Each organization manages its own keys, isolated from others
PRECONDITION: App has org-based auth (e.g., Clerk organizations)

1. Org admin creates API keys scoped to their org:
   ```ts
   const { key } = await apiKeys.create(ctx, {
     name: "Acme Webhook Key",
     ownerId: orgId,                                       // multi-tenant isolation
     type: "secret",
     scopes: ["webhooks:send"],
     tags: ["webhook", "acme"],
     env: "live",
   });
   ```

2. API consumer uses key — rate limited per key:
   ```ts
   const result = await apiKeys.validate(ctx, { key, rateLimit: "validate" });
   ```

3. Org admin views keys and usage (only their org):
   ```ts
   const keys = await apiKeys.list(ctx, { ownerId: orgId });
   const webhookKeys = await apiKeys.listByTag(ctx, { ownerId: orgId, tag: "webhook" });
   ```

4. Security incident — bulk revoke:
   ```ts
   await apiKeys.revokeByTag(ctx, { ownerId: orgId, tag: "compromised" });
   ```

POSTCONDITION: Full tenant isolation. Owner A never sees owner B's keys.

### Primary Journey: Finite-Use Verification Token

ACTOR: Developer building email verification or one-time-use tokens
GOAL: Create a key that auto-expires after N uses
PRECONDITION: ApiKeys component configured

1. Create a one-time-use token:
   ```ts
   const { key } = await apiKeys.create(ctx, {
     name: "Email Verification",
     ownerId: userId,
     type: "secret",
     remaining: 1,                                         // one-time use
     expiresAt: Date.now() + 24 * HOUR,                    // also time-limited
   });
   ```

2. User clicks verification link:
   ```ts
   const result = await apiKeys.validate(ctx, { key });
   // First use: { valid: true, remaining: 0 }
   // Second use: { valid: false, reason: "exhausted" }
   ```

POSTCONDITION: Token consumed, cannot be reused

### Error Journeys

E1. **Validate revoked key**
   Trigger: Revoked key used in API request
   1. `apiKeys.validate(ctx, { key })` → `{ valid: false, reason: "revoked" }`
   2. System logs `key.validate_failed` event
   Recovery: Caller must obtain new key

E2. **Validate expired key**
   Trigger: Key past its `expiresAt`
   1. `apiKeys.validate(ctx, { key })` → `{ valid: false, reason: "expired" }`
   Recovery: Owner creates new key or rotates

E3. **Key rotation with grace period**
   Trigger: Security rotation or suspected leak
   1. `apiKeys.rotate(ctx, { keyId, gracePeriodMs: 3600000 })`
      → New key created (active), old key → `rotating` (valid during grace)
      → Returns `{ newKey, newKeyId, oldKeyExpiresAt }`
   2. After grace, cron/validate transitions old key → `expired`
   Recovery: Both keys valid during grace

E4. **Rate limit exceeded**
   Trigger: Key exceeds configured rate limit
   1. `apiKeys.validate(ctx, { key, rateLimit: "validate" })`
      → `{ valid: false, reason: "rate_limited", retryAfter: 1500 }`
   Recovery: Caller backs off per `retryAfter`

E5. **Bulk revoke by tag**
   Trigger: Security incident
   1. `apiKeys.revokeByTag(ctx, { ownerId, tag: "compromised" })`
      → All matching keys revoked, events logged
   Recovery: New keys created after investigation

E6. **Finite-use key exhausted**
   Trigger: Key used `remaining` times
   1. `apiKeys.validate(ctx, { key })` → `{ valid: false, reason: "exhausted" }`
   2. Status transitions to `exhausted`
   Recovery: Create new key

E7. **Validate disabled key**
   Trigger: Admin temporarily disabled the key
   1. `apiKeys.validate(ctx, { key })` → `{ valid: false, reason: "disabled" }`
   Recovery: Admin calls `enable()` to reactivate

### Edge Cases

EC1. **Malformed key string**: `{ valid: false, reason: "malformed" }` — no DB lookup
EC2. **Past expiresAt on create**: throws `ConvexError("expiresAt must be in the future")`
EC3. **Revoke already-revoked key**: idempotent, returns success
EC4. **List for owner with zero keys**: returns `[]`
EC5. **Validate at 100k+ keys**: prefix index → O(1) lookup
EC6. **Empty scopes array**: allowed — app decides semantics
EC7. **Invalid tag format**: throws `ConvexError("invalid tag: must be alphanumeric/hyphens")`
EC8. **Rate limit on non-existent key**: validate fails with "not_found" before rate limit
EC9. **Multiple instances**: fully isolated tables, counters, rate limits
EC10. **remaining: 0 on create**: throws `ConvexError("remaining must be > 0")`
EC11. **Update revoked/expired key**: throws `ConvexError("cannot update terminal key")`
EC12. **Enable a non-disabled key**: no-op, returns success (idempotent)
EC13. **Disable an already-disabled key**: no-op, returns success (idempotent)
EC14. **Validate publishable key**: returns `type: "publishable"` in result so consumer can enforce server-only checks for secret keys

## Acceptance Criteria (MANDATORY)

### Must Have (BLOCKING — all must pass to ship)

- [ ] AC-1: GIVEN install + `app.use(apiKeys)` + `convex dev` THEN component + all child components provision without errors
- [ ] AC-2: GIVEN `create(ctx, { name, ownerId })` THEN raw key `{prefix}_{type}_{env}_{random8}_{secret}` returned once, SHA-256 hash stored, `key.created` event logged
- [ ] AC-3: GIVEN valid key WHEN `validate(ctx, { key })` THEN `{ valid: true, keyId, ownerId, scopes, tags, env, type, metadata, remaining }` + usage counter incremented
- [ ] AC-4: GIVEN revoked key WHEN `validate()` THEN `{ valid: false, reason: "revoked" }`
- [ ] AC-5: GIVEN expired key WHEN `validate()` THEN `{ valid: false, reason: "expired" }`
- [ ] AC-6: GIVEN `revoke(ctx, { keyId })` THEN status → `revoked`, event logged, subsequent validates fail
- [ ] AC-7: GIVEN `rotate(ctx, { keyId })` THEN new key returned, old in grace period, both valid during grace
- [ ] AC-8: GIVEN `list(ctx, { ownerId })` THEN returns metadata (name, prefix, type, scopes, tags, env, status, remaining, createdAt, lastUsedAt) — no raw keys/hashes
- [ ] AC-9: GIVEN rate limit config + exceeded WHEN `validate(ctx, { key, rateLimit })` THEN `{ valid: false, reason: "rate_limited", retryAfter }`
- [ ] AC-10: GIVEN `listByTag(ctx, { ownerId, tag })` THEN returns only keys with matching tag
- [ ] AC-11: GIVEN `revokeByTag(ctx, { ownerId, tag })` THEN all matching keys revoked, events logged
- [ ] AC-12: GIVEN `env` field WHEN creating/listing THEN filterable by environment string
- [ ] AC-13: GIVEN validate THEN sharded-counter increments per-key count (no write contention)
- [ ] AC-14: GIVEN `getUsage(ctx, { keyId, period })` THEN O(log n) aggregate count for time range
- [ ] AC-15: GIVEN `remaining: N` on create WHEN validated N times THEN Nth validate decrements to 0, (N+1)th returns `{ valid: false, reason: "exhausted" }`
- [ ] AC-16: GIVEN `disable(ctx, { keyId })` THEN status → `disabled`, validates return `reason: "disabled"`. GIVEN `enable(ctx, { keyId })` THEN status → `active`, validates succeed again
- [ ] AC-17: GIVEN `update(ctx, { keyId, name?, scopes?, tags?, metadata? })` THEN metadata updated without rotating the key. Throws if key is in terminal state.
- [ ] AC-18: GIVEN `type: "secret" | "publishable"` on create THEN type encoded in key prefix and returned in validate result

### Error Criteria (BLOCKING — all must pass)

- [ ] AC-E1: GIVEN malformed key WHEN `validate()` THEN `{ valid: false, reason: "malformed" }` — no DB lookup
- [ ] AC-E2: GIVEN past `expiresAt` WHEN `create()` THEN throws ConvexError
- [ ] AC-E3: GIVEN non-existent keyId WHEN `revoke()` THEN throws ConvexError("key not found")
- [ ] AC-E4: GIVEN invalid tag format WHEN `create()` THEN throws ConvexError
- [ ] AC-E5: GIVEN `remaining: 0` WHEN `create()` THEN throws ConvexError("remaining must be > 0")
- [ ] AC-E6: GIVEN terminal key (revoked/expired/exhausted) WHEN `update()` THEN throws ConvexError("cannot update terminal key")

### Should Have (ship without, fix soon)

- [ ] AC-19: GIVEN `onEvent` callback THEN invoked on every lifecycle event with structured data
- [ ] AC-20: GIVEN multiple `app.use(apiKeys, { name })` THEN fully isolated instances
- [ ] AC-21: GIVEN `configure()` runtime call THEN settings update without redeploy
- [ ] AC-22: GIVEN `@convex-dev/crons` THEN expired key cleanup runs on configurable schedule (default: daily)

## Scope

- [ ] 1. Scaffold repo (convex.config + 4 children, schema, package.json, tsconfig, vitest) → AC-1
- [ ] 2. Schema: `apiKeys` (hash, prefix, type, ownerId, scopes, tags, env, status, remaining, metadata, expiresAt, lastUsedAt), `apiKeyEvents`, `config` → AC-2, AC-8
- [ ] 3. Key creation: action for random generation → internal mutation for hash+store, key format with type+env in prefix → AC-2, AC-13, AC-18
- [ ] 4. Key validation: prefix parse → index lookup → constant-time hash compare → status/expiry/remaining check → rate limit → usage counter → AC-3, AC-4, AC-5, AC-9, AC-13, AC-15, AC-E1
- [ ] 5. Key revocation: single + by tag, idempotent → AC-6, AC-11, AC-E3
- [ ] 6. Key rotation: grace period + cron-based expiry → AC-7, AC-22
- [ ] 7. Key listing: by owner, by tag, by env, with pagination → AC-8, AC-10, AC-12
- [ ] 8. Key update: patch name/scopes/tags/metadata, reject terminal keys → AC-17, AC-E6
- [ ] 9. Key disable/enable: reversible status toggle → AC-16
- [ ] 10. Finite-use keys: remaining decrement on validate, exhausted state → AC-15, AC-E5
- [ ] 11. Usage analytics: sharded-counter for hot writes, aggregate for time-range queries → AC-13, AC-14
- [ ] 12. `ApiKeys` client class: typed methods, env-aware config, rate limit config, event callback → all ACs
- [ ] 13. Input validation + error handling → AC-E1 through AC-E6
- [ ] 14. Tests for all ACs using convex-test → all ACs
- [ ] 15. Example app (multi-tenant SaaS + finite-use token) + README → AC-1, AC-20
- [ ] 16. npm package exports, build pipeline, test export → AC-1

### Out of Scope (v1)

- Dashboard UI (consumer builds with list/getUsage)
- Webhook delivery to external URLs (consumer uses `onEvent` + workpool)
- IP allowlisting per key
- Permissions engine (consumer interprets scopes)
- Billing integration
- Refill / auto-replenish remaining (v2: needs per-key cron)
- Usage plans / tier abstraction (v2: consumer maps plans to rate-limit configs today)
- Hierarchical permissions (consumer encodes hierarchy in flat scope strings)
- Distributed rate limiting across deployments

## Quality Checklist

### Blocking (must pass to ship)

- [ ] All Must Have ACs passing
- [ ] All Error Criteria ACs passing
- [ ] All scope items implemented
- [ ] No regressions
- [ ] Error states handled (not just happy path)
- [ ] No hardcoded secrets
- [ ] Raw keys never stored (only SHA-256 hashes)
- [ ] Constant-time comparison for hash matching
- [ ] All functions have `args` + `returns` validators
- [ ] Index-backed queries only (no table scans)
- [ ] `v.id()` only references component-internal tables
- [ ] All 4 child components registered in convex.config.ts
- [ ] Package exports match @convex-dev conventions
- [ ] Every query scoped by ownerId (no cross-tenant leakage)
- [ ] Sharded-counter for hot write paths
- [ ] Aggregate namespaced by keyId
- [ ] Key type (`secret`/`publishable`) encoded in key prefix
- [ ] `remaining` decrement is atomic (same mutation as validate)
- [ ] Terminal states (revoked/expired/exhausted) are truly terminal — no re-enable

### Advisory (should pass, not blocking)

- [ ] All Should Have ACs passing
- [ ] README: installation, config, API reference, architecture, multi-tenant, finite-use, key types
- [ ] TSDoc on all exports
- [ ] Example app covers: multi-tenant, env-aware, rate-limited, finite-use, disable/enable
- [ ] CHANGELOG.md initialized
- [ ] `src/test.ts` export works with consumer's convex-test

## Test Strategy (MANDATORY)

### Test Environment

| Component | Status | Detail |
|-----------|--------|--------|
| Test runner | configure | vitest + edge-runtime |
| Integration | configure | convex-test + `registerComponent` |
| Test DB | in-memory | convex-test |
| Mocks | 0 | pure Convex + real child components |

### AC → Test Mapping

| AC | Test Type | Test Intention |
|----|-----------|----------------|
| AC-1 | Integration | Component + children install, tables provisioned |
| AC-2 | Integration | Create returns key with correct format, DB stores hash only, event logged |
| AC-3 | Integration | Validate correct key → valid + full metadata + counter incremented |
| AC-4 | Integration | Validate revoked → `{ valid: false, reason: "revoked" }` |
| AC-5 | Integration | Validate expired → `{ valid: false, reason: "expired" }` |
| AC-6 | Integration | Revoke → status, event, subsequent validate fails |
| AC-7 | Integration | Rotate → new key, old in grace, both valid during grace |
| AC-8 | Integration | List returns metadata without raw keys/hashes |
| AC-9 | Integration | Rate limit exceeded → `rate_limited` + `retryAfter` |
| AC-10 | Integration | listByTag filters correctly |
| AC-11 | Integration | revokeByTag revokes all matching |
| AC-12 | Integration | env filters on list |
| AC-13 | Integration | Sharded-counter increments on validate |
| AC-14 | Integration | Aggregate returns correct count for time range |
| AC-15 | Integration | Remaining decrements, exhausts at 0 |
| AC-16 | Integration | Disable → validates fail. Enable → validates succeed again |
| AC-17 | Integration | Update changes metadata, key stays same. Rejects terminal keys |
| AC-18 | Integration | Key type in prefix + validate result |
| AC-E1 | Unit | Malformed key → false without DB |
| AC-E2 | Integration | Past expiresAt → ConvexError |
| AC-E3 | Integration | Non-existent keyId → ConvexError |
| AC-E4 | Integration | Invalid tag → ConvexError |
| AC-E5 | Integration | remaining: 0 → ConvexError |
| AC-E6 | Integration | Update terminal key → ConvexError |

### Failure Mode Tests (MANDATORY)

| Source | ID | Test Intention | Priority |
|--------|----|----------------|----------|
| E1 | FMT-1 | Revoked key rejected + event | BLOCKING |
| E2 | FMT-2 | Expired key rejected | BLOCKING |
| E3 | FMT-3 | Rotation grace period works | BLOCKING |
| E4 | FMT-4 | Rate limit returns retryAfter | BLOCKING |
| E5 | FMT-5 | Bulk tag revoke works | BLOCKING |
| E6 | FMT-6 | Finite-use exhaustion at exactly N uses | BLOCKING |
| E7 | FMT-7 | Disabled key rejected, re-enabled works | BLOCKING |
| EC1 | FMT-8 | Malformed key → false, no DB | Advisory |
| EC5 | FMT-9 | O(1) validate at scale (100+ keys) | Advisory |
| EC9 | FMT-10 | Multiple instances fully isolated | Advisory |
| EC14 | FMT-11 | Publishable key type in validate result | Advisory |
| FH-1 | FMT-12 | Constant-time hash compare | BLOCKING |
| FH-2 | FMT-13 | Prefix collision → correct key via full hash | BLOCKING |
| FH-3 | FMT-14 | Cross-tenant isolation (owner A ≠ owner B) | BLOCKING |
| FH-4 | FMT-15 | Remaining decrement is atomic (no double-spend) | BLOCKING |

### Mock Boundary

| Dependency | Strategy | Justification |
|------------|----------|---------------|
| Convex DB | convex-test | Official framework |
| Crypto | Real (Web Crypto) | Available in edge-runtime |
| rate-limiter | Real (child) | No external deps |
| sharded-counter | Real (child) | No external deps |
| aggregate | Real (child) | No external deps |
| crons | Real (child) | No external deps |

### TDD Commitment

RED → GREEN → REFACTOR per AC. All tests before implementation.

## Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Convex components API beta | HIGH | MED | Pin peerDep, document beta |
| `crypto.getRandomValues()` blocked in mutations | HIGH | HIGH | Key generation in action → internal mutation for store |
| `crypto.subtle.digest` blocked in mutations | HIGH | LOW | Fallback: pure JS SHA-256 |
| Child component version conflicts | MED | MED | Pin versions, test ranges |
| Key prefix collision | MED | LOW | 8-char random + full hash compare |
| Timing attacks | MED | LOW | Constant-time comparison |
| Validate write amplification (counter+aggregate) | MED | MED | Make counter async via `scheduler.runAfter(0, ...)` if benchmarks show issue |
| npm scope `@vllnt` not claimed | HIGH | MED | Claim before publish |
| `remaining` race condition (double-spend) | HIGH | LOW | Decrement in same mutation as validate — Convex serializes |
| 4 child components hit undocumented limit | LOW | LOW | @convex-dev/workflow nests workpool — pattern proven |

**Kill criteria:** If child component composition breaks fundamentally, fall back to convex-helpers utility.

## Analysis

### Assumptions Challenged

| Assumption | Evidence For | Evidence Against | Verdict |
|------------|-------------|-----------------|---------|
| SHA-256 available in mutations | V8 + Web Crypto; `digest()` is deterministic | `getRandomValues` IS blocked (non-deterministic) | RISKY → key gen in action, hash in mutation |
| Child components nest in parent component | `component.use()` documented; workflow→workpool precedent | No docs on 4+ children | VALID |
| Sharded-counter + aggregate won't OCC on validate | Different tables/shards | Multiple writes widen OCC window | RISKY → decouple via scheduler if needed |
| Tags as string array sufficient | Simple, flexible | No per-tag aggregate without scan | VALID for v1 |
| `remaining` decrement is atomic | Same mutation, Convex serializes | N/A | VALID |
| Key types (secret/pub) add meaningful security | Stripe, GitHub both do it | Component can't enforce server-only (consumer's job) | VALID — type is informational, consumer enforces |

### Blind Spots

1. **[Security]** `crypto.getRandomValues` definitely blocked in mutations — key gen MUST be action
2. **[Performance]** Validate write amplification: counter + aggregate + remaining decrement in one mutation
3. **[Operations]** Schema migration between component versions
4. **[DX]** Consumer confusion on child components (they're internal, not in consumer's config)
5. **[Security]** Publishable keys: component marks type but consumer must enforce "don't use pub keys server-side"

### Failure Hypotheses

| IF | THEN | BECAUSE | Severity | Mitigation |
|----|------|---------|----------|------------|
| `crypto.getRandomValues()` in mutation | Key gen fails | Deterministic sandbox | HIGH | Generate in action, store via internal mutation |
| Counter + aggregate + remaining in one mutation → OCC | Validates fail under load | Too many writes per tx | MED | Decouple counter/aggregate via `scheduler.runAfter(0, ...)` |
| Cross-tenant listByTag missing ownerId filter | Security breach | Bug in query | HIGH | Hard-code ownerId in every query + cross-tenant test |
| Remaining decrement race (double-spend) | Key used N+1 times | Concurrent validates | HIGH | Convex serializes mutations → impossible. Test to confirm. |

### The Real Question

Confirmed — composing 4 child components is correct. The gap analysis vs Unkey/Stripe/GitHub showed 4 low-cost features (`remaining`, `disabled`, `update`, key types) that close the biggest gaps. Adding them costs ~3.5h but makes the component competitive with production services.

The deeper differentiator: **transactional rate limiting + real-time reactive queries + self-hosted on Convex**. No SaaS competitor offers all three.

### Open Items

- [risk] Crypto in mutations → resolved: key gen in action, hash in mutation
- [risk] Validate write amplification → explore during ship (benchmark, decouple if needed)
- [question] npm org `@vllnt` claimed? → question
- [improvement] Refill / auto-replenish remaining → v2
- [improvement] Usage plans / tier abstraction → v2
- [gap] Schema migration docs → add to README

## Notes

Key design decisions:
- **Key generation: action → internal mutation** — `crypto.getRandomValues()` non-deterministic = action only
- **ownerId is string** — can't reference consumer's tables
- **Tags: `v.array(v.string())`** — simple, index-friendly, no separate table
- **Env: free-form string** — not enum, consumer chooses
- **Key type: informational** — component marks `secret`/`publishable`, consumer enforces server-only
- **Remaining: atomic decrement** — same mutation as validate, Convex serializes = no double-spend
- **Disabled: reversible** — unlike revoked (terminal). For "pause this key" workflows
- **Child components are internal** — consumer sees 1 component, not 5

Competitive gaps closed in v3:
- `remaining` (finite-use keys) — matches Unkey
- `disabled`/`enable` — matches Unkey
- `update()` — matches Unkey
- Key types (`secret`/`publishable`) — matches Stripe
- Enriched key format with type+env — matches GitHub fine-grained tokens

## Progress

| # | Scope Item | Status | Iteration |
|---|-----------|--------|-----------|
| 1 | Scaffold repo structure | pending | - |
| 2 | Schema | pending | - |
| 3 | Key creation + format | pending | - |
| 4 | Key validation + rate limit + remaining | pending | - |
| 5 | Key revocation (single + tag) | pending | - |
| 6 | Key rotation + grace + cron | pending | - |
| 7 | Key listing (owner, tag, env) | pending | - |
| 8 | Key update (metadata patch) | pending | - |
| 9 | Key disable/enable | pending | - |
| 10 | Finite-use keys (remaining) | pending | - |
| 11 | Usage analytics (counter + aggregate) | pending | - |
| 12 | ApiKeys client class | pending | - |
| 13 | Input validation + errors | pending | - |
| 14 | Tests for all ACs | pending | - |
| 15 | Example app + README | pending | - |
| 16 | npm package config | pending | - |

## Timeline

| Action | Timestamp | Duration | Notes |
|--------|-----------|----------|-------|
| plan | 2026-03-19T00:00:00Z | - | Created |
| plan v2 | 2026-03-19T00:30:00Z | - | Child components, multi-tenant, tags, env, analytics, rate limiting |
| plan v3 | 2026-03-20T00:00:00Z | - | Competitive analysis: added remaining, disabled/enable, update, key types, enriched format |
