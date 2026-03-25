/// <reference types="vite/client" />
import { expect, test, describe, vi, beforeEach, afterEach } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api.js";
import { register } from "../../src/test.js";
import shardedCounterTest from "@convex-dev/sharded-counter/test";

const modules = import.meta.glob("./**/*.ts");

const HOUR = 3600000;

function setup() {
  const t = convexTest(undefined!, modules);
  register(t, "apiKeys");
  shardedCounterTest.register(t, "apiKeys/shardedCounter");
  return t;
}

// ─── create ──────────────────────────────────────────────────────

describe("create", () => {
  test("creates a secret key with all options", async () => {
    const t = setup();
    const created = await t.mutation(api.example.createKey, {
      name: "Full Options",
      ownerId: "org_1",
      type: "secret",
      scopes: ["read:users", "write:orders"],
      tags: ["sdk", "v2"],
      env: "live",
      metadata: { plan: "enterprise" },
      remaining: 1000,
      expiresAt: Date.now() + HOUR,
    });
    expect(created.key).toContain("myapp_secret_live_");
    expect(created.keyId).toBeDefined();
  });

  test("creates a publishable key via defaultType", async () => {
    const t = setup();
    const created = await t.mutation(api.example.createPubKey, {
      name: "Pub Key",
      ownerId: "org_1",
    });
    expect(created.key).toContain("myapp_pub_live_");
  });

  test("rejects expiresAt in the past", async () => {
    const t = setup();
    await expect(
      t.mutation(api.example.createKey, {
        name: "Expired",
        ownerId: "org_1",
        expiresAt: Date.now() - 1000,
      }),
    ).rejects.toThrow("expiresAt must be in the future");
  });

  test("rejects remaining <= 0", async () => {
    const t = setup();
    await expect(
      t.mutation(api.example.createKey, {
        name: "Zero",
        ownerId: "org_1",
        remaining: 0,
      }),
    ).rejects.toThrow("remaining must be > 0");
  });

  test("rejects invalid tags", async () => {
    const t = setup();
    await expect(
      t.mutation(api.example.createKey, {
        name: "Bad Tags",
        ownerId: "org_1",
        tags: ["valid", "-invalid"],
      }),
    ).rejects.toThrow("Invalid tag");
  });

  test("creates key with default prefix (vk) and default type (secret)", async () => {
    const t = setup();
    const created = await t.mutation(api.example.createDefaultKey, {
      name: "Default Config",
      ownerId: "org_1",
    });
    expect(created.key).toContain("vk_secret_live_");
  });
});

// ─── not found errors ────────────────────────────────────────────

// Note: "key not found" branches in revoke/enable/disable/getUsage/update/rotate
// require passing a valid Convex doc ID that doesn't exist in the DB.
// In convex-test, component DBs are isolated and we can't fabricate orphaned IDs
// through the client API. These 6 lines (~5 total uncovered) are defensive guards
// that protect against data corruption — not reachable through normal API usage.

// ─── validate ────────────────────────────────────────────────────

describe("validate", () => {
  test("validates a valid key and returns metadata", async () => {
    const t = setup();
    const created = await t.mutation(api.example.createKey, {
      name: "Valid Key",
      ownerId: "org_1",
      scopes: ["read"],
      tags: ["test"],
      env: "live",
      metadata: { level: 1 },
    });
    const result = await t.mutation(api.example.validateKey, {
      key: created.key,
    });
    expect(result.valid).toBe(true);
    expect(result.ownerId).toBe("org_1");
    expect(result.scopes).toEqual(["read"]);
    expect(result.tags).toEqual(["test"]);
    expect(result.env).toBe("live");
    expect(result.type).toBe("secret");
    expect(result.metadata).toEqual({ level: 1 });
  });

  test("rejects malformed key (wrong segment count)", async () => {
    const t = setup();
    const result = await t.mutation(api.example.validateKey, {
      key: "not_a_valid_key",
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("malformed");
  });

  test("rejects malformed key (bad type segment)", async () => {
    const t = setup();
    const result = await t.mutation(api.example.validateKey, {
      key: "pre_badtype_live_12345678_" + "a".repeat(64),
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("malformed");
  });

  test("rejects malformed key (wrong lookupPrefix length)", async () => {
    const t = setup();
    const result = await t.mutation(api.example.validateKey, {
      key: "pre_secret_live_short_" + "a".repeat(64),
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("malformed");
  });

  test("rejects malformed key (wrong secret length)", async () => {
    const t = setup();
    const result = await t.mutation(api.example.validateKey, {
      key: "pre_secret_live_12345678_tooshort",
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("malformed");
  });

  test("rejects key with unknown lookupPrefix (not_found)", async () => {
    const t = setup();
    const result = await t.mutation(api.example.validateKey, {
      key: "myapp_secret_live_zzzzzzzz_" + "f".repeat(64),
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("not_found");
  });

  test("rejects key with correct lookupPrefix but wrong hash (not_found)", async () => {
    const t = setup();
    const created = await t.mutation(api.example.createKey, {
      name: "Hash Mismatch",
      ownerId: "org_1",
    });
    // Extract the lookupPrefix from the real key, but swap the secret
    const parts = created.key.split("_");
    const fakeKey = [parts[0], parts[1], parts[2], parts[3], "b".repeat(64)].join("_");
    const result = await t.mutation(api.example.validateKey, { key: fakeKey });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("not_found");
  });

  test("rejects revoked key", async () => {
    const t = setup();
    const created = await t.mutation(api.example.createKey, {
      name: "Revoke Me",
      ownerId: "org_1",
    });
    await t.mutation(api.example.revokeKey, { keyId: created.keyId, ownerId: "org_1" });
    const result = await t.mutation(api.example.validateKey, {
      key: created.key,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("revoked");
  });

  test("rejects disabled key", async () => {
    const t = setup();
    const created = await t.mutation(api.example.createKey, {
      name: "Disable Me",
      ownerId: "org_1",
    });
    await t.mutation(api.example.disableKey, { keyId: created.keyId, ownerId: "org_1" });
    const result = await t.mutation(api.example.validateKey, {
      key: created.key,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("disabled");
  });
});

// ─── expiry ──────────────────────────────────────────────────────

describe("expiry", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  test("rejects expired key", async () => {
    const t = setup();
    const now = Date.now();
    const created = await t.mutation(api.example.createKey, {
      name: "Expiring",
      ownerId: "org_1",
      expiresAt: now + HOUR,
    });

    // Valid before expiry
    let result = await t.mutation(api.example.validateKey, { key: created.key });
    expect(result.valid).toBe(true);

    // Advance past expiry
    vi.advanceTimersByTime(HOUR + 1);

    result = await t.mutation(api.example.validateKey, { key: created.key });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("expired");
  });

  test("grace period expiry after rotation", async () => {
    const t = setup();
    const created = await t.mutation(api.example.createKey, {
      name: "Rotate Grace",
      ownerId: "org_1",
    });
    await t.mutation(api.example.rotateKey, {
      keyId: created.keyId,
      ownerId: "org_1",
      gracePeriodMs: HOUR,
    });

    // Old key valid during grace period
    let result = await t.mutation(api.example.validateKey, { key: created.key });
    expect(result.valid).toBe(true);

    // Advance past grace period
    vi.advanceTimersByTime(HOUR + 1);

    result = await t.mutation(api.example.validateKey, { key: created.key });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("expired");
  });
});

// ─── finite-use / exhaustion ─────────────────────────────────────

describe("finite-use keys", () => {
  test("remaining counter decrements on each validate", async () => {
    const t = setup();
    const created = await t.mutation(api.example.createKey, {
      name: "3-use token",
      ownerId: "org_1",
      remaining: 3,
    });

    const r1 = await t.mutation(api.example.validateKey, { key: created.key });
    expect(r1.valid).toBe(true);
    expect(r1.remaining).toBe(2);

    const r2 = await t.mutation(api.example.validateKey, { key: created.key });
    expect(r2.valid).toBe(true);
    expect(r2.remaining).toBe(1);

    const r3 = await t.mutation(api.example.validateKey, { key: created.key });
    expect(r3.valid).toBe(true);
    expect(r3.remaining).toBe(0);

    // 4th use: exhausted
    const r4 = await t.mutation(api.example.validateKey, { key: created.key });
    expect(r4.valid).toBe(false);
    expect(r4.reason).toBe("exhausted");
  });

  test("one-time token exhausts after single use", async () => {
    const t = setup();
    const created = await t.mutation(api.example.createKey, {
      name: "One-time",
      ownerId: "org_1",
      remaining: 1,
    });

    const r1 = await t.mutation(api.example.validateKey, { key: created.key });
    expect(r1.valid).toBe(true);
    expect(r1.remaining).toBe(0);

    const r2 = await t.mutation(api.example.validateKey, { key: created.key });
    expect(r2.valid).toBe(false);
    expect(r2.reason).toBe("exhausted");
  });
});

// ─── disable / enable ────────────────────────────────────────────

describe("disable / enable", () => {
  test("disable then enable restores validation", async () => {
    const t = setup();
    const created = await t.mutation(api.example.createKey, {
      name: "Toggle",
      ownerId: "org_1",
    });

    await t.mutation(api.example.disableKey, { keyId: created.keyId, ownerId: "org_1" });
    let result = await t.mutation(api.example.validateKey, { key: created.key });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("disabled");

    await t.mutation(api.example.enableKey, { keyId: created.keyId, ownerId: "org_1" });
    result = await t.mutation(api.example.validateKey, { key: created.key });
    expect(result.valid).toBe(true);
  });

  test("disable already disabled key is idempotent", async () => {
    const t = setup();
    const created = await t.mutation(api.example.createKey, {
      name: "Already Disabled",
      ownerId: "org_1",
    });
    await t.mutation(api.example.disableKey, { keyId: created.keyId, ownerId: "org_1" });
    // Second disable should not throw
    await t.mutation(api.example.disableKey, { keyId: created.keyId, ownerId: "org_1" });
  });

  test("enable already active key is idempotent", async () => {
    const t = setup();
    const created = await t.mutation(api.example.createKey, {
      name: "Already Active",
      ownerId: "org_1",
    });
    // Enable when already active should not throw
    await t.mutation(api.example.enableKey, { keyId: created.keyId, ownerId: "org_1" });
  });

  test("disable non-active key throws", async () => {
    const t = setup();
    const created = await t.mutation(api.example.createKey, {
      name: "Revoked",
      ownerId: "org_1",
    });
    await t.mutation(api.example.revokeKey, { keyId: created.keyId, ownerId: "org_1" });
    await expect(
      t.mutation(api.example.disableKey, { keyId: created.keyId, ownerId: "org_1" }),
    ).rejects.toThrow("can only disable active keys");
  });

  test("enable non-disabled key throws", async () => {
    const t = setup();
    const created = await t.mutation(api.example.createKey, {
      name: "Revoked",
      ownerId: "org_1",
    });
    await t.mutation(api.example.revokeKey, { keyId: created.keyId, ownerId: "org_1" });
    await expect(
      t.mutation(api.example.enableKey, { keyId: created.keyId, ownerId: "org_1" }),
    ).rejects.toThrow("can only enable disabled keys");
  });
});

// ─── update ──────────────────────────────────────────────────────

describe("update", () => {
  test("updates name, scopes, tags, metadata", async () => {
    const t = setup();
    const created = await t.mutation(api.example.createKey, {
      name: "Original",
      ownerId: "org_1",
      scopes: ["read"],
      tags: ["v1"],
    });

    await t.mutation(api.example.updateKey, {
      keyId: created.keyId,
      ownerId: "org_1",
      name: "Renamed",
      scopes: ["read", "write"],
      tags: ["v2"],
      metadata: { updated: true },
    });

    const keys = await t.query(api.example.listKeys, { ownerId: "org_1" });
    const key = keys.find((k: { keyId: string }) => k.keyId === created.keyId);
    expect(key.name).toBe("Renamed");
    expect(key.scopes).toEqual(["read", "write"]);
    expect(key.tags).toEqual(["v2"]);
    expect(key.metadata).toEqual({ updated: true });
  });

  test("update with no changes is a no-op", async () => {
    const t = setup();
    const created = await t.mutation(api.example.createKey, {
      name: "No-Op",
      ownerId: "org_1",
    });
    // Should not throw
    await t.mutation(api.example.updateKey, { keyId: created.keyId, ownerId: "org_1" });
  });

  test("update terminal key throws", async () => {
    const t = setup();
    const created = await t.mutation(api.example.createKey, {
      name: "Terminal",
      ownerId: "org_1",
    });
    await t.mutation(api.example.revokeKey, { keyId: created.keyId, ownerId: "org_1" });
    await expect(
      t.mutation(api.example.updateKey, {
        keyId: created.keyId,
        ownerId: "org_1",
        name: "Can't",
      }),
    ).rejects.toThrow("cannot update terminal key");
  });

  test("update with invalid tags throws", async () => {
    const t = setup();
    const created = await t.mutation(api.example.createKey, {
      name: "Bad Tags",
      ownerId: "org_1",
    });
    await expect(
      t.mutation(api.example.updateKey, {
        keyId: created.keyId,
        ownerId: "org_1",
        tags: ["-nope"],
      }),
    ).rejects.toThrow("Invalid tag");
  });
});

// ─── revoke ──────────────────────────────────────────────────────

describe("revoke", () => {
  test("revoking already revoked key is idempotent", async () => {
    const t = setup();
    const created = await t.mutation(api.example.createKey, {
      name: "Double Revoke",
      ownerId: "org_1",
    });
    await t.mutation(api.example.revokeKey, {
      keyId: created.keyId,
      ownerId: "org_1",
    });
    // Second revoke should not throw
    await t.mutation(api.example.revokeKey, {
      keyId: created.keyId,
      ownerId: "org_1",
    });
  });
});

// ─── revokeByTag ─────────────────────────────────────────────────

describe("revokeByTag", () => {
  test("bulk revokes keys matching tag", async () => {
    const t = setup();
    await t.mutation(api.example.createKey, {
      name: "Key A",
      ownerId: "org_1",
      tags: ["compromised"],
    });
    await t.mutation(api.example.createKey, {
      name: "Key B",
      ownerId: "org_1",
      tags: ["compromised"],
    });
    await t.mutation(api.example.createKey, {
      name: "Key C",
      ownerId: "org_1",
      tags: ["safe"],
    });

    const result = await t.mutation(api.example.revokeByTag, {
      ownerId: "org_1",
      tag: "compromised",
    });
    expect(result.revokedCount).toBe(2);

    const active = await t.query(api.example.listKeys, {
      ownerId: "org_1",
      status: "active",
    });
    expect(active.length).toBe(1);
    expect(active[0].tags).toEqual(["safe"]);
  });

  test("revokeByTag with no matches returns 0", async () => {
    const t = setup();
    await t.mutation(api.example.createKey, {
      name: "No Match",
      ownerId: "org_1",
      tags: ["safe"],
    });
    const result = await t.mutation(api.example.revokeByTag, {
      ownerId: "org_1",
      tag: "nonexistent",
    });
    expect(result.revokedCount).toBe(0);
  });
});

// ─── rotate ──────────────────────────────────────────────────────

describe("rotate", () => {
  test("rotated key validates and old key enters grace period", async () => {
    const t = setup();
    const created = await t.mutation(api.example.createKey, {
      name: "Rotate Me",
      ownerId: "org_1",
    });

    const rotated = await t.mutation(api.example.rotateKey, {
      keyId: created.keyId,
      ownerId: "org_1",
      gracePeriodMs: HOUR,
    });

    expect(rotated.newKey).toBeDefined();
    expect(rotated.newKeyId).toBeDefined();

    // New key validates
    const newResult = await t.mutation(api.example.validateKey, {
      key: rotated.newKey,
    });
    expect(newResult.valid).toBe(true);

    // Old key still valid during grace period
    const oldResult = await t.mutation(api.example.validateKey, {
      key: created.key,
    });
    expect(oldResult.valid).toBe(true);
  });

  test("rotated key preserves env (regression: was hardcoded to live)", async () => {
    const t = setup();
    const created = await t.mutation(api.example.createKey, {
      name: "Test Env",
      ownerId: "org_1",
      env: "test",
    });

    const rotated = await t.mutation(api.example.rotateKey, {
      keyId: created.keyId,
      ownerId: "org_1",
    });

    expect(rotated.newKey).toContain("_test_");
    expect(rotated.newKey).not.toContain("_live_");

    const result = await t.mutation(api.example.validateKey, {
      key: rotated.newKey,
    });
    expect(result.valid).toBe(true);
  });

  test("cannot rotate a revoked key", async () => {
    const t = setup();
    const created = await t.mutation(api.example.createKey, {
      name: "Revoked",
      ownerId: "org_1",
    });
    await t.mutation(api.example.revokeKey, { keyId: created.keyId, ownerId: "org_1" });
    await expect(
      t.mutation(api.example.rotateKey, { keyId: created.keyId, ownerId: "org_1" }),
    ).rejects.toThrow("cannot rotate a terminal key");
  });
});

// ─── list ────────────────────────────────────────────────────────

describe("list", () => {
  test("lists keys by owner", async () => {
    const t = setup();
    await t.mutation(api.example.createKey, {
      name: "Key A",
      ownerId: "org_1",
    });
    await t.mutation(api.example.createKey, {
      name: "Key B",
      ownerId: "org_1",
    });
    await t.mutation(api.example.createKey, {
      name: "Other",
      ownerId: "org_2",
    });

    const keys = await t.query(api.example.listKeys, { ownerId: "org_1" });
    expect(keys.length).toBe(2);
  });

  test("filters by env", async () => {
    const t = setup();
    await t.mutation(api.example.createKey, {
      name: "Live",
      ownerId: "org_1",
      env: "live",
    });
    await t.mutation(api.example.createKey, {
      name: "Test",
      ownerId: "org_1",
      env: "test",
    });

    const live = await t.query(api.example.listKeys, {
      ownerId: "org_1",
      env: "live",
    });
    expect(live.length).toBe(1);
    expect(live[0].env).toBe("live");
  });

  test("filters by env and status", async () => {
    const t = setup();
    const created = await t.mutation(api.example.createKey, {
      name: "Active Live",
      ownerId: "org_1",
      env: "live",
    });
    await t.mutation(api.example.createKey, {
      name: "Active Live 2",
      ownerId: "org_1",
      env: "live",
    });
    await t.mutation(api.example.disableKey, { keyId: created.keyId, ownerId: "org_1" });

    const active = await t.query(api.example.listKeys, {
      ownerId: "org_1",
      env: "live",
      status: "active",
    });
    expect(active.length).toBe(1);
  });

  test("filters by status only", async () => {
    const t = setup();
    await t.mutation(api.example.createKey, {
      name: "Active",
      ownerId: "org_1",
    });
    const toRevoke = await t.mutation(api.example.createKey, {
      name: "Revoked",
      ownerId: "org_1",
    });
    await t.mutation(api.example.revokeKey, { keyId: toRevoke.keyId, ownerId: "org_1" });

    const active = await t.query(api.example.listKeys, {
      ownerId: "org_1",
      status: "active",
    });
    expect(active.length).toBe(1);
  });
});

// ─── listByTag ───────────────────────────────────────────────────

describe("listByTag", () => {
  test("lists keys matching a specific tag", async () => {
    const t = setup();
    await t.mutation(api.example.createKey, {
      name: "SDK Key",
      ownerId: "org_1",
      tags: ["sdk", "v2"],
    });
    await t.mutation(api.example.createKey, {
      name: "Admin Key",
      ownerId: "org_1",
      tags: ["admin"],
    });

    const sdkKeys = await t.query(api.example.listByTag, {
      ownerId: "org_1",
      tag: "sdk",
    });
    expect(sdkKeys.length).toBe(1);
    expect(sdkKeys[0].name).toBe("SDK Key");
  });
});

// ─── getUsage ────────────────────────────────────────────────────

describe("getUsage", () => {
  test("returns total usage count", async () => {
    const t = setup();
    const created = await t.mutation(api.example.createKey, {
      name: "Usage Key",
      ownerId: "org_1",
    });

    // Validate twice
    await t.mutation(api.example.validateKey, { key: created.key });
    await t.mutation(api.example.validateKey, { key: created.key });

    const usage = await t.query(api.example.getUsage, {
      keyId: created.keyId,
      ownerId: "org_1",
    });
    expect(usage.total).toBe(2);
  });

  test("returns remaining for finite-use keys", async () => {
    const t = setup();
    const created = await t.mutation(api.example.createKey, {
      name: "Finite",
      ownerId: "org_1",
      remaining: 5,
    });
    await t.mutation(api.example.validateKey, { key: created.key });

    const usage = await t.query(api.example.getUsage, {
      keyId: created.keyId,
      ownerId: "org_1",
    });
    expect(usage.remaining).toBe(4);
  });
});

// ─── shared.ts edge cases ────────────────────────────────────────

describe("parseKeyString edge cases", () => {
  test("rejects key with empty segment (5 parts but one empty)", async () => {
    const t = setup();
    const result = await t.mutation(api.example.validateKey, {
      key: "pre__live_12345678_" + "a".repeat(64),
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("malformed");
  });
});

// ─── configure ───────────────────────────────────────────────────

describe("configure", () => {
  test("sets and updates configuration", async () => {
    const t = setup();
    await t.mutation(api.example.configureKeys, {
      cleanupIntervalMs: 3600000,
      defaultExpiryMs: 86400000,
    });
    await t.mutation(api.example.configureKeys, {
      cleanupIntervalMs: 7200000,
    });
  });

  test("rejects negative cleanupIntervalMs", async () => {
    const t = setup();
    await expect(
      t.mutation(api.example.configureKeys, { cleanupIntervalMs: -1 }),
    ).rejects.toThrow("cleanupIntervalMs must be > 0");
  });

  test("rejects zero defaultExpiryMs", async () => {
    const t = setup();
    await expect(
      t.mutation(api.example.configureKeys, { defaultExpiryMs: 0 }),
    ).rejects.toThrow("defaultExpiryMs must be > 0");
  });
});

// ─── auth boundary (cross-tenant) ───────────────────────────────

describe("auth boundary", () => {
  test("revoke rejects wrong ownerId", async () => {
    const t = setup();
    const created = await t.mutation(api.example.createKey, {
      name: "Auth Test",
      ownerId: "org_1",
    });
    await expect(
      t.mutation(api.example.revokeKey, { keyId: created.keyId, ownerId: "org_2" }),
    ).rejects.toThrow("unauthorized");
  });

  test("disable rejects wrong ownerId", async () => {
    const t = setup();
    const created = await t.mutation(api.example.createKey, {
      name: "Auth Test",
      ownerId: "org_1",
    });
    await expect(
      t.mutation(api.example.disableKey, { keyId: created.keyId, ownerId: "org_2" }),
    ).rejects.toThrow("unauthorized");
  });

  test("enable rejects wrong ownerId", async () => {
    const t = setup();
    const created = await t.mutation(api.example.createKey, {
      name: "Auth Test",
      ownerId: "org_1",
    });
    await t.mutation(api.example.disableKey, { keyId: created.keyId, ownerId: "org_1" });
    await expect(
      t.mutation(api.example.enableKey, { keyId: created.keyId, ownerId: "org_2" }),
    ).rejects.toThrow("unauthorized");
  });

  test("update rejects wrong ownerId", async () => {
    const t = setup();
    const created = await t.mutation(api.example.createKey, {
      name: "Auth Test",
      ownerId: "org_1",
    });
    await expect(
      t.mutation(api.example.updateKey, { keyId: created.keyId, ownerId: "org_2", name: "Hacked" }),
    ).rejects.toThrow("unauthorized");
  });

  test("rotate rejects wrong ownerId", async () => {
    const t = setup();
    const created = await t.mutation(api.example.createKey, {
      name: "Auth Test",
      ownerId: "org_1",
    });
    await expect(
      t.mutation(api.example.rotateKey, { keyId: created.keyId, ownerId: "org_2" }),
    ).rejects.toThrow("unauthorized");
  });

  test("getUsage rejects wrong ownerId", async () => {
    const t = setup();
    const created = await t.mutation(api.example.createKey, {
      name: "Auth Test",
      ownerId: "org_1",
    });
    await expect(
      t.query(api.example.getUsage, { keyId: created.keyId, ownerId: "org_2" }),
    ).rejects.toThrow("unauthorized");
  });
});

// ─── input validation ───────────────────────────────────────────

describe("input validation", () => {
  test("rejects env with underscores", async () => {
    const t = setup();
    await expect(
      t.mutation(api.example.createKey, {
        name: "Bad Env",
        ownerId: "org_1",
        env: "live_test",
      }),
    ).rejects.toThrow("Invalid env");
  });

  test("rejects metadata over 4KB", async () => {
    const t = setup();
    await expect(
      t.mutation(api.example.createKey, {
        name: "Big Meta",
        ownerId: "org_1",
        metadata: { data: "x".repeat(5000) },
      }),
    ).rejects.toThrow("metadata must be <= 4096 bytes");
  });

  test("rejects more than 50 scopes", async () => {
    const t = setup();
    const scopes = Array.from({ length: 51 }, (_, i) => `scope${i}`);
    await expect(
      t.mutation(api.example.createKey, {
        name: "Too Many Scopes",
        ownerId: "org_1",
        scopes,
      }),
    ).rejects.toThrow("scopes must have <= 50 entries");
  });

  test("rejects more than 20 tags", async () => {
    const t = setup();
    const tags = Array.from({ length: 21 }, (_, i) => `tag${i}`);
    await expect(
      t.mutation(api.example.createKey, {
        name: "Too Many Tags",
        ownerId: "org_1",
        tags,
      }),
    ).rejects.toThrow("tags must have <= 20 entries");
  });
});

// ─── gracePeriodMs bounds ───────────────────────────────────────

describe("gracePeriodMs bounds", () => {
  test("rejects gracePeriodMs below minimum (60s)", async () => {
    const t = setup();
    const created = await t.mutation(api.example.createKey, {
      name: "Grace Test",
      ownerId: "org_1",
    });
    await expect(
      t.mutation(api.example.rotateKey, {
        keyId: created.keyId,
        ownerId: "org_1",
        gracePeriodMs: 59999,
      }),
    ).rejects.toThrow("gracePeriodMs must be between");
  });

  test("rejects gracePeriodMs above maximum (30 days)", async () => {
    const t = setup();
    const created = await t.mutation(api.example.createKey, {
      name: "Grace Test",
      ownerId: "org_1",
    });
    await expect(
      t.mutation(api.example.rotateKey, {
        keyId: created.keyId,
        ownerId: "org_1",
        gracePeriodMs: 30 * 24 * 60 * 60 * 1000 + 1,
      }),
    ).rejects.toThrow("gracePeriodMs must be between");
  });
});
