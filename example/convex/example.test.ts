/// <reference types="vite/client" />
import { expect, test, describe } from "vitest";
import { convexTest } from "convex-test";
import { api } from "./_generated/api.js";
import { register } from "../../src/test.js";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import shardedCounterTest from "@convex-dev/sharded-counter/test";
import aggregateTest from "@convex-dev/aggregate/test";
import cronsTest from "@convex-dev/crons/test";

const modules = import.meta.glob("./**/*.ts");

function setup() {
  const t = convexTest(undefined!, modules);
  register(t, "apiKeys");
  rateLimiterTest.register(t, "apiKeys/rateLimiter");
  shardedCounterTest.register(t, "apiKeys/shardedCounter");
  aggregateTest.register(t, "apiKeys/usageAggregate");
  cronsTest.register(t, "apiKeys/crons");
  return t;
}

describe("create and validate", () => {
  test("created key validates successfully", async () => {
    const t = setup();

    const created = await t.mutation(api.example.createKey, {
      name: "Test Key",
      ownerId: "org_1",
      env: "live",
    });

    expect(created.key).toBeDefined();
    expect(created.keyId).toBeDefined();

    const result = await t.mutation(api.example.validateKey, {
      key: created.key,
    });
    expect(result.valid).toBe(true);
  });

  test("revoked key fails validation", async () => {
    const t = setup();

    const created = await t.mutation(api.example.createKey, {
      name: "To Revoke",
      ownerId: "org_2",
    });

    await t.mutation(api.example.revokeKey, { keyId: created.keyId });

    const result = await t.mutation(api.example.validateKey, {
      key: created.key,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("revoked");
  });
});

describe("rotate", () => {
  test("rotated key validates and old key enters grace period", async () => {
    const t = setup();

    const created = await t.mutation(api.example.createKey, {
      name: "Rotate Me",
      ownerId: "org_3",
      env: "live",
    });

    const rotated = await t.mutation(api.example.rotateKey, {
      keyId: created.keyId,
      gracePeriodMs: 3600000,
    });

    expect(rotated.newKey).toBeDefined();
    expect(rotated.newKeyId).toBeDefined();
    expect(rotated.newKey).not.toBe(created.key);

    // New key should validate
    const newResult = await t.mutation(api.example.validateKey, {
      key: rotated.newKey,
    });
    expect(newResult.valid).toBe(true);

    // Old key should still validate during grace period
    const oldResult = await t.mutation(api.example.validateKey, {
      key: created.key,
    });
    expect(oldResult.valid).toBe(true);
  });

  test("rotated key preserves env in key format (regression: was hardcoded to live)", async () => {
    const t = setup();

    // Create a key with env "test"
    const created = await t.mutation(api.example.createKey, {
      name: "Test Env Key",
      ownerId: "org_4",
      env: "test",
    });
    expect(created.key).toContain("_test_");

    const rotated = await t.mutation(api.example.rotateKey, {
      keyId: created.keyId,
    });

    // Rotated key must also have _test_, not _live_
    expect(rotated.newKey).toContain("_test_");
    expect(rotated.newKey).not.toContain("_live_");

    // And it must validate (hash matches the actual key string)
    const result = await t.mutation(api.example.validateKey, {
      key: rotated.newKey,
    });
    expect(result.valid).toBe(true);
  });
});
