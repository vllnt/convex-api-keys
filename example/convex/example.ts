import { mutation, query } from "./_generated/server.js";
import { v } from "convex/values";
import { ApiKeys } from "../../src/client/index.js";
import { components } from "./_generated/api.js";

const MINUTE = 60 * 1000;

const apiKeys = new ApiKeys(components.apiKeys, {
  prefix: "myapp",
  rateLimit: {
    validate: { kind: "token bucket", rate: 1000, period: MINUTE },
  },
});

export const createKey = mutation({
  args: {
    name: v.string(),
    ownerId: v.string(),
    scopes: v.optional(v.array(v.string())),
    tags: v.optional(v.array(v.string())),
    env: v.optional(v.string()),
  },
  returns: v.object({
    keyId: v.string(),
    key: v.string(),
  }),
  handler: async (ctx, args) => {
    return await apiKeys.create(ctx, {
      name: args.name,
      ownerId: args.ownerId,
      scopes: args.scopes,
      tags: args.tags,
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
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await apiKeys.list(ctx, args);
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

export const createOneTimeToken = mutation({
  args: {
    ownerId: v.string(),
    purpose: v.string(),
  },
  returns: v.object({
    keyId: v.string(),
    key: v.string(),
  }),
  handler: async (ctx, { ownerId, purpose }) => {
    return await apiKeys.create(ctx, {
      name: purpose,
      ownerId,
      type: "secret",
      remaining: 1,
      expiresAt: Date.now() + 24 * 60 * MINUTE,
      tags: ["one-time", purpose],
    });
  },
});
