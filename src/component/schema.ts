import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  apiKeys: defineTable({
    hash: v.string(),
    lookupPrefix: v.string(),
    keyPrefix: v.string(),
    type: v.union(v.literal("secret"), v.literal("publishable")),
    env: v.string(),
    ownerId: v.string(),
    name: v.string(),
    scopes: v.array(v.string()),
    tags: v.array(v.string()),
    status: v.union(
      v.literal("active"),
      v.literal("disabled"),
      v.literal("revoked"),
      v.literal("rotating"),
      v.literal("expired"),
      v.literal("exhausted"),
    ),
    metadata: v.optional(v.any()),
    remaining: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    gracePeriodEnd: v.optional(v.number()),
    rotatedFromId: v.optional(v.id("apiKeys")),
    lastUsedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index("by_lookup_prefix", ["lookupPrefix"])
    .index("by_owner", ["ownerId", "status"])
    .index("by_owner_env", ["ownerId", "env", "status"])
    .index("by_owner_status", ["ownerId", "status"]),

  apiKeyEvents: defineTable({
    keyId: v.id("apiKeys"),
    ownerId: v.string(),
    eventType: v.string(),
    reason: v.optional(v.string()),
    metadata: v.optional(v.any()),
    timestamp: v.number(),
  })
    .index("by_key", ["keyId", "timestamp"])
    .index("by_owner", ["ownerId", "timestamp"]),

  config: defineTable({
    cleanupIntervalMs: v.optional(v.number()),
    defaultExpiryMs: v.optional(v.number()),
  }),
});
