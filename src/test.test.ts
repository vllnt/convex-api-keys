/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import shardedCounterTest from "@convex-dev/sharded-counter/test";
import { expect, test } from "vitest";
import { register } from "./test.js";

// A host app's schema has its own tables. `register(t)` must accept the
// `convexTest` instance built from it (checked by `pnpm typecheck`).
const hostSchema = defineSchema({
  projects: defineTable({ name: v.string(), ownerId: v.string() }).index(
    "by_owner",
    ["ownerId"],
  ),
  notes: defineTable({ text: v.string() }),
});

const hostModules = {
  "./_generated/api.ts": async () => ({}),
};

test("register mounts the component in a host app that has its own tables", async () => {
  const t = convexTest(hostSchema, hostModules);
  register(t);
  shardedCounterTest.register(t, "apiKeys/shardedCounter");

  await t.run(async (ctx) => {
    await ctx.db.insert("projects", { name: "p", ownerId: "org_1" });
  });
  const projects = await t.run((ctx) => ctx.db.query("projects").collect());
  expect(projects).toHaveLength(1);
});
