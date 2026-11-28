/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import type { FunctionArgs } from "convex/server";
import shardedCounterTest from "@convex-dev/sharded-counter/test";
import { api } from "./_generated/api.js";
import schema from "./schema.js";
import type { Id } from "./_generated/dataModel.js";
import { sha256Hex } from "../shared.js";

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

describe("revoke keeps a final status final", () => {
  async function keyIn(status: "expired" | "exhausted") {
    const t = convexTest(schema, modules);
    shardedCounterTest.register(t, "shardedCounter");
    const created = await t.mutation(api.mutations.create, {
      name: status,
      ownerId: "owner",
      ...(status === "exhausted" ? { remaining: 1 } : { expiresAt: Date.now() + 1000 }),
    });
    if (status === "exhausted") {
      await t.mutation(api.mutations.validate, { key: created.key });
    } else {
      vi.setSystemTime(Date.now() + 2000);
    }
    await t.mutation(api.mutations.validate, { key: created.key });
    expect(await t.query(api.queries.matchStatus, { key: created.key })).toBe(status);
    return { t, created };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  test.each(["expired", "exhausted"] as const)("revoke leaves an %s key unchanged and returns null", async (status) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { t, created } = await keyIn(status);
    const before = await t.run((ctx) => ctx.db.get(created.keyId));

    const result = await t.mutation(api.mutations.revoke, { keyId: created.keyId, ownerId: "owner" });

    expect(result).toBeNull();
    const after = await t.run((ctx) => ctx.db.get(created.keyId));
    expect(after).toEqual(before);
    expect(after?.status).toBe(status);
    expect(after?.revokedAt).toBeUndefined();
  });
});

// ─── documented behaviour of every component function ───────────

const OWNER = "owner";
const NOW = 1_700_000_000_000;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const MAX_GRACE_MS = 2_592_000_000;

type CreateArgs = FunctionArgs<typeof api.mutations.create>;

// convex-test never lets a transaction start before the last commit, so a test
// that asserts an exact `Date.now()` first moves the clock past earlier writes.
function at(offsetMs: number): number {
  vi.setSystemTime(NOW + offsetMs);
  return NOW + offsetMs;
}

describe("documented API behaviour", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup() {
    const t = convexTest(schema, modules);
    shardedCounterTest.register(t, "shardedCounter");
    const create = (args: Partial<CreateArgs> = {}) =>
      t.mutation(api.mutations.create, { name: "k", ownerId: OWNER, ...args });
    const row = (keyId: Id<"apiKeys">) => t.run((ctx) => ctx.db.get(keyId));
    const owned = (keyId: Id<"apiKeys">) => ({ keyId, ownerId: OWNER });
    return { t, create, row, owned };
  }

  describe("key format and storage", () => {
    test("a created key has the documented format and is unique per create", async () => {
      const { create, row } = setup();
      const first = await create();
      const second = await create();
      const format = /^vk_secret_live_[0-9a-f]{8}_[0-9a-f]{64}$/u;
      expect(first.key).toMatch(format);
      expect(second.key).toMatch(format);
      expect(second.key).not.toBe(first.key);
      const [a, b] = [await row(first.keyId), await row(second.keyId)];
      expect(a?.lookupPrefix).toBe(first.key.split("_")[3]);
      expect(b?.lookupPrefix).not.toBe(a?.lookupPrefix);
    });

    test("only the SHA-256 hash is stored and list items carry no hash", async () => {
      const { t, create, row } = setup();
      const created = await create();
      const stored = await row(created.keyId);
      expect(stored?.hash).toBe(await sha256Hex(created.key));
      const secret = created.key.split("_")[4] ?? "";
      for (const value of Object.values(stored ?? {})) {
        expect(JSON.stringify(value)).not.toContain(secret);
      }
      const [item] = await t.query(api.queries.list, { ownerId: OWNER });
      expect(item).toBeDefined();
      expect(item).not.toHaveProperty("hash");
      expect(JSON.stringify(item)).not.toContain(secret);
    });
  });

  describe("validate", () => {
    test("returns the keyId create returned, and type publishable for a publishable key", async () => {
      const { t, create } = setup();
      const secret = await create();
      const pub = await create({ type: "publishable" });
      expect(pub.key).toMatch(/^vk_pub_live_/u);
      const secretResult = await t.mutation(api.mutations.validate, { key: secret.key });
      const pubResult = await t.mutation(api.mutations.validate, { key: pub.key });
      expect(secretResult).toMatchObject({ valid: true, keyId: secret.keyId, type: "secret" });
      expect(pubResult).toMatchObject({ valid: true, keyId: pub.keyId, type: "publishable" });
    });

    test("sets lastUsedAt on first use and updates it at most once a minute", async () => {
      const { t, create, row } = setup();
      const created = await create();
      expect((await row(created.keyId))?.lastUsedAt).toBeUndefined();
      const firstUse = at(1000);
      await t.mutation(api.mutations.validate, { key: created.key });
      expect((await row(created.keyId))?.lastUsedAt).toBe(firstUse);
      at(1000 + MINUTE_MS - 1);
      await t.mutation(api.mutations.validate, { key: created.key });
      expect((await row(created.keyId))?.lastUsedAt).toBe(firstUse);
      const minuteLater = at(1000 + MINUTE_MS);
      await t.mutation(api.mutations.validate, { key: created.key });
      expect((await row(created.keyId))?.lastUsedAt).toBe(minuteLater);
    });

    test("a failed validate does not count usage", async () => {
      const { t, create, owned } = setup();
      const created = await create();
      await t.mutation(api.mutations.validate, { key: created.key });
      await t.mutation(api.mutations.disable, owned(created.keyId));
      expect(await t.mutation(api.mutations.validate, { key: created.key })).toEqual({
        valid: false,
        reason: "disabled",
      });
      expect(await t.query(api.queries.getUsage, owned(created.keyId))).toEqual({ total: 1 });
    });

    test("two keys sharing a lookupPrefix each validate only with their own key", async () => {
      const { t, create } = setup();
      const first = await create();
      const parts = first.key.split("_");
      const otherKey = [...parts.slice(0, 4), "c".repeat(64)].join("_");
      const otherId = await t.run(async (ctx) => {
        const original = await ctx.db.get(first.keyId);
        if (!original) throw new Error("missing row");
        const { _id, _creationTime, ...fields } = original;
        return ctx.db.insert("apiKeys", { ...fields, name: "collision", hash: await sha256Hex(otherKey) });
      });
      expect(await t.mutation(api.mutations.validate, { key: first.key })).toMatchObject({
        valid: true,
        keyId: first.keyId,
      });
      expect(await t.mutation(api.mutations.validate, { key: otherKey })).toMatchObject({
        valid: true,
        keyId: otherId,
      });
      const wrong = [...parts.slice(0, 4), "d".repeat(64)].join("_");
      expect(await t.mutation(api.mutations.validate, { key: wrong })).toEqual({
        valid: false,
        reason: "not_found",
      });
    });
  });

  describe("revoke", () => {
    test("revokes a rotating key and sets revokedAt", async () => {
      const { t, create, row, owned } = setup();
      const created = await create();
      await t.mutation(api.mutations.rotate, owned(created.keyId));
      expect((await row(created.keyId))?.status).toBe("rotating");
      const revokedAt = at(1000);
      await t.mutation(api.mutations.revoke, owned(created.keyId));
      const stored = await row(created.keyId);
      expect(stored?.status).toBe("revoked");
      expect(stored?.revokedAt).toBe(revokedAt);
    });

    test("revokes a stored-active key that is past expiresAt", async () => {
      const { t, create, row, owned } = setup();
      const created = await create({ expiresAt: NOW + MINUTE_MS });
      vi.setSystemTime(NOW + 2 * MINUTE_MS);
      expect((await row(created.keyId))?.status).toBe("active");
      await t.mutation(api.mutations.revoke, owned(created.keyId));
      expect((await row(created.keyId))?.status).toBe("revoked");
    });

    test("revoking a revoked key keeps the first revokedAt", async () => {
      const { t, create, row, owned } = setup();
      const created = await create();
      const firstRevoke = at(1000);
      await t.mutation(api.mutations.revoke, owned(created.keyId));
      at(HOUR_MS);
      await t.mutation(api.mutations.revoke, owned(created.keyId));
      expect((await row(created.keyId))?.revokedAt).toBe(firstRevoke);
    });
  });

  describe("revokeByTag", () => {
    test("revokes active, rotating and disabled keys of the owner only, and skips final keys", async () => {
      const { t, create, row, owned } = setup();
      const tags = ["ci"];
      const active = await create({ tags });
      const rotating = await create({ tags });
      await t.mutation(api.mutations.rotate, owned(rotating.keyId));
      const disabled = await create({ tags });
      await t.mutation(api.mutations.disable, owned(disabled.keyId));
      const revoked = await create({ tags });
      await t.mutation(api.mutations.revoke, owned(revoked.keyId));
      const exhausted = await create({ tags, remaining: 1 });
      await t.mutation(api.mutations.validate, { key: exhausted.key });
      const expired = await create({ tags, expiresAt: NOW + MINUTE_MS });
      const otherOwner = await create({ tags, ownerId: "other" });
      vi.setSystemTime(NOW + 2 * MINUTE_MS);
      await t.mutation(api.mutations.validate, { key: expired.key });
      expect((await row(expired.keyId))?.status).toBe("expired");

      // The rotation added an active replacement with the same tag.
      const result = await t.mutation(api.mutations.revokeByTag, { ownerId: OWNER, tag: "ci" });
      expect(result).toEqual({ revokedCount: 4 });
      for (const id of [active.keyId, rotating.keyId, disabled.keyId]) {
        expect((await row(id))?.status).toBe("revoked");
      }
      expect((await row(exhausted.keyId))?.status).toBe("exhausted");
      expect((await row(expired.keyId))?.status).toBe("expired");
      expect((await row(otherOwner.keyId))?.status).toBe("active");
    });

    test("rejects a tag that does not match the tag pattern", async () => {
      const { t } = setup();
      await expect(t.mutation(api.mutations.revokeByTag, { ownerId: OWNER, tag: "-x" })).rejects.toThrow(
        'Invalid tag "-x": must be alphanumeric with hyphens, starting with alphanumeric',
      );
    });
  });

  describe("rotate", () => {
    test("oldKeyExpiresAt is now + 1 hour by default, or now + gracePeriodMs", async () => {
      const { t, create, owned } = setup();
      const byDefault = await create();
      const explicit = await create();
      let now = at(1000);
      expect(await t.mutation(api.mutations.rotate, owned(byDefault.keyId))).toMatchObject({
        oldKeyExpiresAt: now + HOUR_MS,
      });
      now = at(2000);
      expect(
        await t.mutation(api.mutations.rotate, { ...owned(explicit.keyId), gracePeriodMs: 5 * MINUTE_MS }),
      ).toMatchObject({ oldKeyExpiresAt: now + 5 * MINUTE_MS });
    });

    test("copies name, scopes, tags, metadata, expiresAt, prefix, env and type to the new key", async () => {
      const { t, create, row, owned } = setup();
      const fields = {
        name: "billing",
        scopes: ["read:orders"],
        tags: ["ci", "team-a"],
        metadata: { plan: "pro" },
        expiresAt: NOW + 10 * HOUR_MS,
        keyPrefix: "acme",
        env: "test",
        type: "publishable" as const,
      };
      const created = await create(fields);
      const rotated = await t.mutation(api.mutations.rotate, owned(created.keyId));
      expect(rotated.newKey).toMatch(/^acme_pub_test_[0-9a-f]{8}_[0-9a-f]{64}$/u);
      expect(await row(rotated.newKeyId)).toMatchObject({ ...fields, status: "active" });
    });

    test.each([MINUTE_MS, MAX_GRACE_MS])("accepts gracePeriodMs of exactly %s", async (gracePeriodMs) => {
      const { t, create, owned } = setup();
      const created = await create();
      const now = at(1000);
      expect(await t.mutation(api.mutations.rotate, { ...owned(created.keyId), gracePeriodMs })).toMatchObject({
        oldKeyExpiresAt: now + gracePeriodMs,
      });
    });
  });

  describe("list and listByTag", () => {
    test("limit 1 returns one key; items include createdAt and lookupPrefix", async () => {
      const { t, create, row } = setup();
      const first = await create();
      await create();
      const items = await t.query(api.queries.list, { ownerId: OWNER, limit: 1 });
      expect(items).toHaveLength(1);
      const stored = await row(first.keyId);
      expect(items[0]).toMatchObject({
        keyId: first.keyId,
        createdAt: stored?._creationTime,
        lookupPrefix: stored?.lookupPrefix,
      });
    });

    test("orders keys by status as strings, then oldest first within a status", async () => {
      const { t, create, owned } = setup();
      const revoked = await create({ name: "revoked" });
      const disabled = await create({ name: "disabled" });
      const rotating = await create({ name: "rotating" });
      const active = await create({ name: "active" });
      await t.mutation(api.mutations.revoke, owned(revoked.keyId));
      await t.mutation(api.mutations.disable, owned(disabled.keyId));
      const { newKeyId } = await t.mutation(api.mutations.rotate, owned(rotating.keyId));
      const ids = (await t.query(api.queries.list, { ownerId: OWNER })).map((k) => k.keyId);
      expect(ids).toEqual([active.keyId, newKeyId, disabled.keyId, revoked.keyId, rotating.keyId]);
    });

    test("listByTag with a tag that fails the tag pattern returns []", async () => {
      const { t, create } = setup();
      await create({ tags: ["x"] });
      expect(await t.query(api.queries.listByTag, { ownerId: OWNER, tag: "-x" })).toEqual([]);
    });

    test("returns 100 keys by default when the owner has 101", async () => {
      const { t } = setup();
      await t.run(async (ctx) => {
        for (let i = 0; i < 101; i++) {
          await ctx.db.insert("apiKeys", {
            hash: `hash${String(i)}`,
            lookupPrefix: String(i).padStart(8, "0"),
            keyPrefix: "vk",
            type: "secret",
            env: "live",
            ownerId: OWNER,
            name: `k${String(i)}`,
            scopes: [],
            tags: ["bulk"],
            status: "active",
          });
        }
      });
      expect(await t.query(api.queries.list, { ownerId: OWNER })).toHaveLength(100);
      expect(await t.query(api.queries.listByTag, { ownerId: OWNER, tag: "bulk" })).toHaveLength(100);
    });
  });

  describe("update", () => {
    const tooMany = (n: number, label: string) => Array.from({ length: n }, (_, i) => `${label}${String(i)}`);

    test.each([
      [{ tags: tooMany(21, "t") }, "tags must have <= 20 entries (got 21)"],
      [{ scopes: tooMany(51, "s") }, "scopes must have <= 50 entries (got 51)"],
      [{ metadata: { d: "x".repeat(4089) } }, "metadata must be <= 4096 bytes (got 4097)"],
      [{ name: "n".repeat(257) }, "name must be <= 256 characters"],
    ])("rejects %o", async (change, message) => {
      const { t, create, owned } = setup();
      const created = await create();
      await expect(t.mutation(api.mutations.update, { ...owned(created.keyId), ...change })).rejects.toThrow(
        message,
      );
    });

    test("works on disabled and rotating keys", async () => {
      const { t, create, row, owned } = setup();
      const disabled = await create();
      await t.mutation(api.mutations.disable, owned(disabled.keyId));
      const rotating = await create();
      await t.mutation(api.mutations.rotate, owned(rotating.keyId));
      for (const id of [disabled.keyId, rotating.keyId]) {
        await t.mutation(api.mutations.update, { ...owned(id), name: "renamed" });
        expect((await row(id))?.name).toBe("renamed");
      }
    });

    test("throws cannot update terminal key on expired and exhausted keys", async () => {
      const { t, create, owned } = setup();
      const exhausted = await create({ remaining: 1 });
      await t.mutation(api.mutations.validate, { key: exhausted.key });
      const expired = await create({ expiresAt: NOW + MINUTE_MS });
      vi.setSystemTime(NOW + 2 * MINUTE_MS);
      await t.mutation(api.mutations.validate, { key: expired.key });
      for (const id of [exhausted.keyId, expired.keyId]) {
        await expect(t.mutation(api.mutations.update, { ...owned(id), name: "x" })).rejects.toThrow(
          "cannot update terminal key",
        );
      }
    });
  });

  test("disable on a rotating key throws can only disable active keys", async () => {
    const { t, create, owned } = setup();
    const created = await create();
    await t.mutation(api.mutations.rotate, owned(created.keyId));
    await expect(t.mutation(api.mutations.disable, owned(created.keyId))).rejects.toThrow(
      "can only disable active keys",
    );
  });

  test.each([
    [{ name: "n".repeat(257) }, "name must be <= 256 characters"],
    [{ env: "e".repeat(257) }, "env must be <= 256 characters"],
    [{ env: "" }, 'Invalid env "": must match ^[a-zA-Z0-9-]+$ (no underscores — would break key parsing)'],
  ])("create rejects %o", async (args, message) => {
    const { create } = setup();
    await expect(create(args)).rejects.toThrow(message);
  });

  test.each([
    ["exactly 4096", 4088, true],
    ["4097", 4089, false],
  ] as const)("metadata of %s characters of JSON", async (_label, length, accepted) => {
    const { t, create, owned } = setup();
    const metadata = { d: "x".repeat(length) };
    expect(JSON.stringify(metadata)).toHaveLength(length + 8);
    const created = create({ metadata });
    if (accepted) {
      const { keyId } = await created;
      await t.mutation(api.mutations.update, { ...owned(keyId), metadata });
    } else {
      await expect(created).rejects.toThrow("metadata must be <= 4096 bytes (got 4097)");
    }
  });

  test("configure patches the single config row and create still sets no expiresAt", async () => {
    const { t, create, row } = setup();
    await t.mutation(api.mutations.configure, { cleanupIntervalMs: HOUR_MS, defaultExpiryMs: 24 * HOUR_MS });
    await t.mutation(api.mutations.configure, { cleanupIntervalMs: 2 * HOUR_MS });
    const configs = await t.run((ctx) => ctx.db.query("config").collect());
    expect(configs).toHaveLength(1);
    expect(configs[0]).toMatchObject({ cleanupIntervalMs: 2 * HOUR_MS, defaultExpiryMs: 24 * HOUR_MS });
    const created = await create();
    expect((await row(created.keyId))?.expiresAt).toBeUndefined();
  });

  test("a keyId that is not an apiKeys id fails argument validation", async () => {
    const { t } = setup();
    await t.mutation(api.mutations.configure, { cleanupIntervalMs: HOUR_MS });
    const configId = await t.run(async (ctx) => {
      const config = await ctx.db.query("config").first();
      if (!config) throw new Error("missing config");
      return config._id;
    });
    for (const keyId of [configId, "not-an-id"]) {
      await expect(
        t.mutation(api.mutations.revoke, { keyId: keyId as never, ownerId: OWNER }),
      ).rejects.toThrow(/validator/iu);
    }
  });
});
