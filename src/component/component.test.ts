/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
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
