import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { KEY_TYPE, KEY_STATUS } from "../shared.js";
import { jsonValue } from "./validators.js";

export default defineSchema({
  apiKeys: defineTable({
    hash: v.string(),
    lookupPrefix: v.string(),
    keyPrefix: v.string(),
    type: KEY_TYPE,
    env: v.string(),
    ownerId: v.string(),
    name: v.string(),
    scopes: v.array(v.string()),
    tags: v.array(v.string()),
    status: KEY_STATUS,
    metadata: v.optional(jsonValue),
    remaining: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    gracePeriodEnd: v.optional(v.number()),
    rotatedFromId: v.optional(v.id("apiKeys")),
    lastUsedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index("by_lookup_prefix", ["lookupPrefix"])
    .index("by_owner_status", ["ownerId", "status"])
    .index("by_owner_env", ["ownerId", "env", "status"]),

  apiKeyEvents: defineTable({
    keyId: v.id("apiKeys"),
    ownerId: v.string(),
    eventType: v.string(),
    reason: v.optional(v.string()),
    metadata: v.optional(jsonValue),
    timestamp: v.number(),
  })
    .index("by_key", ["keyId", "timestamp"])
    .index("by_owner", ["ownerId", "timestamp"]),

  config: defineTable({
    cleanupIntervalMs: v.optional(v.number()),
    defaultExpiryMs: v.optional(v.number()),
  }),
});
