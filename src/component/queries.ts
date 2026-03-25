import { v } from "convex/values";
import { query } from "./_generated/server.js";
import { components } from "./_generated/api.js";
import { ShardedCounter } from "@convex-dev/sharded-counter";
import { KEY_STATUS, KEY_TYPE } from "../shared.js";
import { jsonValue } from "./validators.js";

const counter = new ShardedCounter(components.shardedCounter);

const DEFAULT_PAGE_SIZE = 100;

const keyItemValidator = v.object({
  keyId: v.id("apiKeys"),
  name: v.string(),
  lookupPrefix: v.string(),
  type: KEY_TYPE,
  env: v.string(),
  scopes: v.array(v.string()),
  tags: v.array(v.string()),
  status: KEY_STATUS,
  metadata: v.optional(jsonValue),
  remaining: v.optional(v.number()),
  expiresAt: v.optional(v.number()),
  createdAt: v.number(),
  lastUsedAt: v.optional(v.number()),
});

function mapKey(k: any) {
  return {
    keyId: k._id,
    name: k.name,
    lookupPrefix: k.lookupPrefix,
    type: k.type,
    env: k.env,
    scopes: k.scopes,
    tags: k.tags,
    status: k.status,
    metadata: k.metadata,
    remaining: k.remaining,
    expiresAt: k.expiresAt,
    createdAt: k._creationTime,
    lastUsedAt: k.lastUsedAt,
  };
}

export const list = query({
  args: {
    ownerId: v.string(),
    env: v.optional(v.string()),
    status: v.optional(KEY_STATUS),
    limit: v.optional(v.number()),
  },
  returns: v.array(keyItemValidator),
  handler: async (ctx, { ownerId, env, status, limit }) => {
    const pageSize = limit ?? DEFAULT_PAGE_SIZE;
    let keysQuery;
    if (env) {
      keysQuery = ctx.db
        .query("apiKeys")
        .withIndex("by_owner_env", (q) => {
          const q2 = q.eq("ownerId", ownerId).eq("env", env);
          return status ? q2.eq("status", status) : q2;
        });
    } else if (status) {
      keysQuery = ctx.db
        .query("apiKeys")
        .withIndex("by_owner_status", (q) =>
          q.eq("ownerId", ownerId).eq("status", status),
        );
    } else {
      keysQuery = ctx.db
        .query("apiKeys")
        .withIndex("by_owner_status", (q) => q.eq("ownerId", ownerId));
    }

    const keys = await keysQuery.take(pageSize);
    return keys.map(mapKey);
  },
});

export const listByTag = query({
  args: {
    ownerId: v.string(),
    tag: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(keyItemValidator),
  handler: async (ctx, { ownerId, tag, limit }) => {
    const pageSize = limit ?? DEFAULT_PAGE_SIZE;
    const allKeys = await ctx.db
      .query("apiKeys")
      .withIndex("by_owner_status", (q) => q.eq("ownerId", ownerId))
      .collect();

    return allKeys
      .filter((k) => k.tags.includes(tag))
      .slice(0, pageSize)
      .map(mapKey);
  },
});

export const getUsage = query({
  args: {
    keyId: v.id("apiKeys"),
    ownerId: v.string(),
  },
  returns: v.object({
    total: v.number(),
    remaining: v.optional(v.number()),
  }),
  handler: async (ctx, { keyId, ownerId }) => {
    const key = await ctx.db.get(keyId);
    if (!key) {
      throw new Error("key not found");
    }
    if (key.ownerId !== ownerId) {
      throw new Error("unauthorized: key does not belong to owner");
    }

    const total = await counter.count(ctx, keyId);

    return {
      total,
      remaining: key.remaining,
    };
  },
});
