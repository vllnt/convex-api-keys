/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import shardedCounterTest from "@convex-dev/sharded-counter/test";
import { api } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");

async function orphanedKeyId() {
  const t = convexTest(schema, modules);
  const keyId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("apiKeys", {
      hash: "hash",
      lookupPrefix: "12345678",
      keyPrefix: "vk",
      type: "secret",
      env: "live",
      ownerId: "owner",
      name: "temporary",
      scopes: [],
      tags: [],
      status: "active",
    });
    await ctx.db.delete(id);
    return id;
  });
  return { t, keyId };
}

describe("defensive persisted-state validation", () => {
  test("rejects an active row with no remaining uses", async () => {
    const t = convexTest(schema, modules);
    const created = await t.mutation(api.mutations.create, {
      name: "inconsistent",
      ownerId: "owner",
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(created.keyId, { remaining: 0 });
    });

    const result = await t.mutation(api.mutations.validate, { key: created.key });
    expect(result).toEqual({ valid: false, reason: "exhausted" });
  });
});

describe("orphaned key identifiers", () => {
  test("all key-specific APIs reject a valid identifier whose row is gone", async () => {
    const { t, keyId } = await orphanedKeyId();
    const args = { keyId, ownerId: "owner" };

    await expect(t.mutation(api.mutations.revoke, args)).rejects.toThrow("key not found");
    await expect(t.mutation(api.mutations.rotate, args)).rejects.toThrow("key not found");
    await expect(t.mutation(api.mutations.update, args)).rejects.toThrow("key not found");
    await expect(t.mutation(api.mutations.disable, args)).rejects.toThrow("key not found");
    await expect(t.mutation(api.mutations.enable, args)).rejects.toThrow("key not found");
    await expect(t.query(api.queries.getUsage, args)).rejects.toThrow("key not found");
  });
});

describe("rejects non-finite and non-integer numbers", () => {
  const owner = { name: "k", ownerId: "owner" };

  test.each([Number.NaN, Number.POSITIVE_INFINITY])("create rejects expiresAt %s", async (expiresAt) => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.mutations.create, { ...owner, expiresAt })).rejects.toThrow(
      "expiresAt must be in the future",
    );
  });

  test.each([Number.NaN, Number.POSITIVE_INFINITY, 1.5])("create rejects remaining %s", async (remaining) => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.mutations.create, { ...owner, remaining })).rejects.toThrow(
      "remaining must be > 0",
    );
  });

  test("rotate rejects a NaN gracePeriodMs instead of leaving the old key valid forever", async () => {
    const t = convexTest(schema, modules);
    const created = await t.mutation(api.mutations.create, owner);
    await expect(
      t.mutation(api.mutations.rotate, { keyId: created.keyId, ownerId: "owner", gracePeriodMs: Number.NaN }),
    ).rejects.toThrow("gracePeriodMs must be between");
    const row = await t.run((ctx) => ctx.db.get(created.keyId));
    expect(row?.status).toBe("active");
  });

  test.each(["cleanupIntervalMs", "defaultExpiryMs"] as const)("configure rejects non-finite %s", async (field) => {
    const t = convexTest(schema, modules);
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(t.mutation(api.mutations.configure, { [field]: value })).rejects.toThrow(`${field} must be > 0`);
    }
  });

  test.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -1, 1.5])("list queries reject limit %s", async (limit) => {
    const t = convexTest(schema, modules);
    await expect(t.query(api.queries.list, { ownerId: "owner", limit })).rejects.toThrow(
      "limit must be a positive integer",
    );
    await expect(t.query(api.queries.listByTag, { ownerId: "owner", tag: "x", limit })).rejects.toThrow(
      "limit must be a positive integer",
    );
  });
});

describe("rejects empty identifiers", () => {
  test("create rejects an empty ownerId and name", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.mutations.create, { name: "k", ownerId: "" })).rejects.toThrow(
      "ownerId must not be empty",
    );
    await expect(t.mutation(api.mutations.create, { name: "", ownerId: "owner" })).rejects.toThrow(
      "name must not be empty",
    );
  });

  test("update rejects an empty name", async () => {
    const t = convexTest(schema, modules);
    const created = await t.mutation(api.mutations.create, { name: "k", ownerId: "owner" });
    await expect(
      t.mutation(api.mutations.update, { keyId: created.keyId, ownerId: "owner", name: "" }),
    ).rejects.toThrow("name must not be empty");
  });

  test("revokeByTag rejects an empty or malformed tag", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.mutations.revokeByTag, { ownerId: "owner", tag: "" })).rejects.toThrow(
      "Invalid tag",
    );
  });
});

describe("listByTag early stop", () => {
  test("returns the first matches in index order and stops at the limit", async () => {
    const t = convexTest(schema, modules);
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const created = await t.mutation(api.mutations.create, {
        name: `k${String(i)}`,
        ownerId: "owner",
        tags: i % 2 === 0 ? ["ci"] : ["other"],
      });
      ids.push(created.keyId);
    }
    await t.mutation(api.mutations.create, { name: "x", ownerId: "someone", tags: ["ci"] });
    const firstTwo = await t.query(api.queries.listByTag, { ownerId: "owner", tag: "ci", limit: 2 });
    expect(firstTwo.map((k) => k.keyId)).toEqual([ids[0], ids[2]]);
    const all = await t.query(api.queries.listByTag, { ownerId: "owner", tag: "ci" });
    expect(all.map((k) => k.keyId)).toEqual([ids[0], ids[2], ids[4]]);
    expect(
      await t.query(api.queries.listByTag, { ownerId: "owner", tag: "missing", limit: 1 }),
    ).toEqual([]);
  });


  test("listByTag with a limit reads only up to the limit-th match", async () => {
    const t = convexTest({ schema, modules, transactionLimits: { documentsRead: 3 } });
    for (let i = 0; i < 6; i++) {
      await t.mutation(api.mutations.create, {
        name: `k${String(i)}`,
        ownerId: "owner",
        tags: i % 2 === 0 ? ["ci"] : ["other"],
      });
    }
    const firstTwo = await t.query(api.queries.listByTag, { ownerId: "owner", tag: "ci", limit: 2 });
    expect(firstTwo.map((k) => k.name)).toEqual(["k0", "k2"]);
  });
});

describe("matchStatus", () => {
  async function created(args: { expiresAt?: number; remaining?: number } = {}) {
    const t = convexTest(schema, modules);
    shardedCounterTest.register(t, "shardedCounter");
    const key = await t.mutation(api.mutations.create, { name: "k", ownerId: "owner", ...args });
    const status = () => t.query(api.queries.matchStatus, { key: key.key });
    return { key, status, t };
  }

  test("returns the stored status of the matching key", async () => {
    const { key, status, t } = await created();
    expect(await status()).toBe("active");
    await t.mutation(api.mutations.disable, { keyId: key.keyId, ownerId: "owner" });
    expect(await status()).toBe("disabled");
    await t.mutation(api.mutations.revoke, { keyId: key.keyId, ownerId: "owner" });
    expect(await status()).toBe("revoked");
  });

  test("returns null for malformed, unknown and wrong-secret keys", async () => {
    const { key, t } = await created();
    const wrongSecret = `${key.key.slice(0, -1)}${key.key.endsWith("0") ? "1" : "0"}`;
    const otherPrefix = key.key.replace(/_([0-9a-f]{8})_/u, "_00000000_");
    for (const candidate of ["not-a-key", wrongSecret, otherPrefix]) {
      expect(await t.query(api.queries.matchStatus, { key: candidate })).toBeNull();
    }
  });

  test("reports exhausted, expired and rotating keys", async () => {
    const limited = await created({ remaining: 1 });
    await limited.t.mutation(api.mutations.validate, { key: limited.key.key });
    expect(await limited.status()).toBe("exhausted");

    const expiring = await created({ expiresAt: Date.now() + 60_000 });
    await expiring.t.run(async (ctx) => {
      await ctx.db.patch(expiring.key.keyId, { expiresAt: Date.now() - 1 });
    });
    // The stored status is not re-evaluated until `validate` marks the key.
    expect(await expiring.status()).toBe("active");
    await expiring.t.mutation(api.mutations.validate, { key: expiring.key.key });
    expect(await expiring.status()).toBe("expired");

    const rotated = await created();
    await rotated.t.mutation(api.mutations.rotate, { keyId: rotated.key.keyId, ownerId: "owner" });
    expect(await rotated.status()).toBe("rotating");
  });

  test("does not write or count usage", async () => {
    const { key, status, t } = await created({ remaining: 2 });
    expect(await status()).toBe("active");
    const row = await t.run(async (ctx) => ctx.db.get(key.keyId));
    expect(row?.remaining).toBe(2);
    expect(row?.lastUsedAt).toBeUndefined();
    expect(await t.query(api.queries.getUsage, { keyId: key.keyId, ownerId: "owner" })).toEqual({
      remaining: 2,
      total: 0,
    });
  });
});
