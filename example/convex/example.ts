import { mutation, query } from "./_generated/server.js";
import { v } from "convex/values";
import { ApiKeys } from "../../src/client/index.js";
import { components } from "./_generated/api.js";

const MINUTE = 60 * 1000;

const apiKeys = new ApiKeys(components.apiKeys, {
  prefix: "myapp",
});

const defaultKeys = new ApiKeys(components.apiKeys);

const pubKeys = new ApiKeys(components.apiKeys, {
  prefix: "myapp",
  defaultType: "publishable",
});

export const createKey = mutation({
  args: {
    name: v.string(),
    ownerId: v.string(),
    type: v.optional(v.union(v.literal("secret"), v.literal("publishable"))),
    scopes: v.optional(v.array(v.string())),
    tags: v.optional(v.array(v.string())),
    env: v.optional(v.string()),
    metadata: v.optional(v.any()),
    remaining: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
  },
  returns: v.object({
    keyId: v.string(),
    key: v.string(),
  }),
  handler: async (ctx, args) => {
    return await apiKeys.create(ctx, {
      name: args.name,
      ownerId: args.ownerId,
      type: args.type,
      scopes: args.scopes,
      tags: args.tags,
      env: args.env,
      metadata: args.metadata,
      remaining: args.remaining,
      expiresAt: args.expiresAt,
    });
  },
});

export const createPubKey = mutation({
  args: {
    name: v.string(),
    ownerId: v.string(),
    env: v.optional(v.string()),
  },
  returns: v.object({
    keyId: v.string(),
    key: v.string(),
  }),
  handler: async (ctx, args) => {
    return await pubKeys.create(ctx, {
      name: args.name,
      ownerId: args.ownerId,
      env: args.env,
    });
  },
});

export const validateKey = mutation({
  args: { key: v.string() },
  returns: v.any(),
  handler: async (ctx, { key }) => {
    return await apiKeys.validate(ctx, { key });
  },
});

export const listKeys = query({
  args: {
    ownerId: v.string(),
    env: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal("active"),
        v.literal("disabled"),
        v.literal("revoked"),
        v.literal("rotating"),
        v.literal("expired"),
        v.literal("exhausted"),
      ),
    ),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await apiKeys.list(ctx, args);
  },
});

export const listByTag = query({
  args: {
    ownerId: v.string(),
    tag: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await apiKeys.listByTag(ctx, args);
  },
});

export const revokeKey = mutation({
  args: { keyId: v.string() },
  returns: v.null(),
  handler: async (ctx, { keyId }) => {
    await apiKeys.revoke(ctx, { keyId });
    return null;
  },
});

export const revokeByTag = mutation({
  args: {
    ownerId: v.string(),
    tag: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await apiKeys.revokeByTag(ctx, args);
  },
});

export const rotateKey = mutation({
  args: {
    keyId: v.string(),
    gracePeriodMs: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, { keyId, gracePeriodMs }) => {
    return await apiKeys.rotate(ctx, { keyId, gracePeriodMs });
  },
});

export const updateKey = mutation({
  args: {
    keyId: v.string(),
    name: v.optional(v.string()),
    scopes: v.optional(v.array(v.string())),
    tags: v.optional(v.array(v.string())),
    metadata: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await apiKeys.update(ctx, args);
    return null;
  },
});

export const disableKey = mutation({
  args: { keyId: v.string() },
  returns: v.null(),
  handler: async (ctx, { keyId }) => {
    await apiKeys.disable(ctx, { keyId });
    return null;
  },
});

export const enableKey = mutation({
  args: { keyId: v.string() },
  returns: v.null(),
  handler: async (ctx, { keyId }) => {
    await apiKeys.enable(ctx, { keyId });
    return null;
  },
});

export const getUsage = query({
  args: {
    keyId: v.string(),
    period: v.optional(
      v.object({
        start: v.number(),
        end: v.number(),
      }),
    ),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await apiKeys.getUsage(ctx, args);
  },
});

export const createDefaultKey = mutation({
  args: {
    name: v.string(),
    ownerId: v.string(),
  },
  returns: v.object({
    keyId: v.string(),
    key: v.string(),
  }),
  handler: async (ctx, args) => {
    return await defaultKeys.create(ctx, {
      name: args.name,
      ownerId: args.ownerId,
    });
  },
});

export const configureKeys = mutation({
  args: {
    cleanupIntervalMs: v.optional(v.number()),
    defaultExpiryMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await apiKeys.configure(ctx, args);
    return null;
  },
});
