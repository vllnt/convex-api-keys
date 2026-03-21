import { v } from "convex/values";
import { mutation, query, action, internalMutation } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import { createConvexLogger } from "@vllnt/logger/convex";
import {
  KEY_STATUS,
  KEY_TYPE,
  TERMINAL_STATUSES,
  parseKeyString,
  timingSafeEqual,
  sha256Hex,
  validateTags,
  KEY_PREFIX_SEPARATOR,
} from "../shared.js";
import type { KeyStatus } from "../shared.js";

const log = createConvexLogger("api-keys");

export const create = mutation({
  args: {
    name: v.string(),
    ownerId: v.string(),
    type: v.optional(KEY_TYPE),
    scopes: v.optional(v.array(v.string())),
    tags: v.optional(v.array(v.string())),
    env: v.optional(v.string()),
    metadata: v.optional(v.any()),
    remaining: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    keyPrefix: v.optional(v.string()),
    lookupPrefix: v.string(),
    secretHex: v.string(),
    hash: v.string(),
  },
  returns: v.object({
    keyId: v.id("apiKeys"),
    key: v.string(),
  }),
  handler: async (ctx, args) => {
    if (args.expiresAt !== undefined && args.expiresAt <= Date.now()) {
      throw new Error("expiresAt must be in the future");
    }
    if (args.remaining !== undefined && args.remaining <= 0) {
      throw new Error("remaining must be > 0");
    }
    if (args.tags) {
      validateTags(args.tags);
    }

    const type = args.type ?? "secret";
    const env = args.env ?? "live";
    const prefix = args.keyPrefix ?? "vk";
    const typeShort = type === "publishable" ? "pub" : "secret";

    const keyId = await ctx.db.insert("apiKeys", {
      hash: args.hash,
      lookupPrefix: args.lookupPrefix,
      keyPrefix: prefix,
      type,
      env,
      ownerId: args.ownerId,
      name: args.name,
      scopes: args.scopes ?? [],
      tags: args.tags ?? [],
      status: "active",
      metadata: args.metadata,
      remaining: args.remaining,
      expiresAt: args.expiresAt,
    });

    await ctx.db.insert("apiKeyEvents", {
      keyId,
      ownerId: args.ownerId,
      eventType: "key.created",
      timestamp: Date.now(),
    });

    const rawKey = [prefix, typeShort, env, args.lookupPrefix, args.secretHex].join(
      KEY_PREFIX_SEPARATOR,
    );

    log.info("key created", { keyId, ownerId: args.ownerId, type, env });
    return { keyId, key: rawKey };
  },
});

export const validate = mutation({
  args: {
    key: v.string(),
  },
  returns: v.union(
    v.object({
      valid: v.literal(true),
      keyId: v.id("apiKeys"),
      ownerId: v.string(),
      type: KEY_TYPE,
      env: v.string(),
      scopes: v.array(v.string()),
      tags: v.array(v.string()),
      metadata: v.optional(v.any()),
      remaining: v.optional(v.number()),
    }),
    v.object({
      valid: v.literal(false),
      reason: v.string(),
      retryAfter: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, { key }) => {
    const parsed = parseKeyString(key);
    if (!parsed.valid) {
      return { valid: false as const, reason: "malformed" };
    }

    const candidates = await ctx.db
      .query("apiKeys")
      .withIndex("by_lookup_prefix", (q) => q.eq("lookupPrefix", parsed.lookupPrefix))
      .collect();

    if (candidates.length === 0) {
      return { valid: false as const, reason: "not_found" };
    }

    const keyHash = await sha256Hex(key);

    let matchedKey = null;
    for (const candidate of candidates) {
      if (timingSafeEqual(candidate.hash, keyHash)) {
        matchedKey = candidate;
        break;
      }
    }

    if (!matchedKey) {
      return { valid: false as const, reason: "not_found" };
    }

    const now = Date.now();

    if (matchedKey.status === "revoked") {
      await ctx.db.insert("apiKeyEvents", {
        keyId: matchedKey._id,
        ownerId: matchedKey.ownerId,
        eventType: "key.validate_failed",
        reason: "revoked",
        timestamp: now,
      });
      return { valid: false as const, reason: "revoked" };
    }

    if (matchedKey.status === "disabled") {
      await ctx.db.insert("apiKeyEvents", {
        keyId: matchedKey._id,
        ownerId: matchedKey.ownerId,
        eventType: "key.validate_failed",
        reason: "disabled",
        timestamp: now,
      });
      return { valid: false as const, reason: "disabled" };
    }

    if (matchedKey.status === "exhausted") {
      return { valid: false as const, reason: "exhausted" };
    }

    if (matchedKey.expiresAt && matchedKey.expiresAt <= now) {
      await ctx.db.patch(matchedKey._id, { status: "expired" });
      await ctx.db.insert("apiKeyEvents", {
        keyId: matchedKey._id,
        ownerId: matchedKey.ownerId,
        eventType: "key.expired",
        timestamp: now,
      });
      return { valid: false as const, reason: "expired" };
    }

    if (
      matchedKey.status === "rotating" &&
      matchedKey.gracePeriodEnd &&
      matchedKey.gracePeriodEnd <= now
    ) {
      await ctx.db.patch(matchedKey._id, { status: "expired" });
      await ctx.db.insert("apiKeyEvents", {
        keyId: matchedKey._id,
        ownerId: matchedKey.ownerId,
        eventType: "key.expired",
        reason: "grace_period_ended",
        timestamp: now,
      });
      return { valid: false as const, reason: "expired" };
    }

    let newRemaining = matchedKey.remaining;
    if (matchedKey.remaining !== undefined) {
      if (matchedKey.remaining <= 0) {
        await ctx.db.patch(matchedKey._id, { status: "exhausted" });
        await ctx.db.insert("apiKeyEvents", {
          keyId: matchedKey._id,
          ownerId: matchedKey.ownerId,
          eventType: "key.exhausted",
          timestamp: now,
        });
        return { valid: false as const, reason: "exhausted" };
      }
      newRemaining = matchedKey.remaining - 1;
      const updates: Record<string, unknown> = {
        remaining: newRemaining,
        lastUsedAt: now,
      };
      if (newRemaining === 0) {
        updates.status = "exhausted";
      }
      await ctx.db.patch(matchedKey._id, updates);

      if (newRemaining === 0) {
        await ctx.db.insert("apiKeyEvents", {
          keyId: matchedKey._id,
          ownerId: matchedKey.ownerId,
          eventType: "key.exhausted",
          timestamp: now,
        });
      }
    } else {
      await ctx.db.patch(matchedKey._id, { lastUsedAt: now });
    }

    await ctx.db.insert("apiKeyEvents", {
      keyId: matchedKey._id,
      ownerId: matchedKey.ownerId,
      eventType: "key.validated",
      timestamp: now,
    });

    return {
      valid: true as const,
      keyId: matchedKey._id,
      ownerId: matchedKey.ownerId,
      type: matchedKey.type,
      env: matchedKey.env,
      scopes: matchedKey.scopes,
      tags: matchedKey.tags,
      metadata: matchedKey.metadata,
      remaining: newRemaining,
    };
  },
});

export const revoke = mutation({
  args: {
    keyId: v.id("apiKeys"),
  },
  returns: v.null(),
  handler: async (ctx, { keyId }) => {
    const key = await ctx.db.get(keyId);
    if (!key) {
      throw new Error("key not found");
    }
    if (key.status === "revoked") {
      return null;
    }
    await ctx.db.patch(keyId, { status: "revoked", revokedAt: Date.now() });
    await ctx.db.insert("apiKeyEvents", {
      keyId,
      ownerId: key.ownerId,
      eventType: "key.revoked",
      timestamp: Date.now(),
    });
    log.info("key revoked", { keyId, ownerId: key.ownerId });
    return null;
  },
});

export const revokeByTag = mutation({
  args: {
    ownerId: v.string(),
    tag: v.string(),
  },
  returns: v.object({ revokedCount: v.number() }),
  handler: async (ctx, { ownerId, tag }) => {
    const keys = await ctx.db
      .query("apiKeys")
      .withIndex("by_owner_status", (q) => q.eq("ownerId", ownerId).eq("status", "active"))
      .collect();

    let revokedCount = 0;
    const now = Date.now();
    for (const key of keys) {
      if (key.tags.includes(tag)) {
        await ctx.db.patch(key._id, { status: "revoked", revokedAt: now });
        await ctx.db.insert("apiKeyEvents", {
          keyId: key._id,
          ownerId,
          eventType: "key.revoked",
          reason: `bulk_revoke_by_tag:${tag}`,
          timestamp: now,
        });
        revokedCount++;
      }
    }
    return { revokedCount };
  },
});

export const rotate = mutation({
  args: {
    keyId: v.id("apiKeys"),
    gracePeriodMs: v.optional(v.number()),
    lookupPrefix: v.string(),
    secretHex: v.string(),
    hash: v.string(),
  },
  returns: v.object({
    newKeyId: v.id("apiKeys"),
    newKey: v.string(),
    oldKeyExpiresAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const oldKey = await ctx.db.get(args.keyId);
    if (!oldKey) {
      throw new Error("key not found");
    }
    if (TERMINAL_STATUSES.has(oldKey.status as KeyStatus)) {
      throw new Error("cannot rotate a terminal key");
    }

    const now = Date.now();
    const gracePeriodMs = args.gracePeriodMs ?? 3600000;
    const gracePeriodEnd = now + gracePeriodMs;

    await ctx.db.patch(args.keyId, {
      status: "rotating",
      gracePeriodEnd,
    });

    const typeShort = oldKey.type === "publishable" ? "pub" : "secret";
    const newKeyId = await ctx.db.insert("apiKeys", {
      hash: args.hash,
      lookupPrefix: args.lookupPrefix,
      keyPrefix: oldKey.keyPrefix,
      type: oldKey.type,
      env: oldKey.env,
      ownerId: oldKey.ownerId,
      name: oldKey.name,
      scopes: oldKey.scopes,
      tags: oldKey.tags,
      status: "active",
      metadata: oldKey.metadata,
      remaining: oldKey.remaining,
      expiresAt: oldKey.expiresAt,
      rotatedFromId: args.keyId,
    });

    const rawKey = [
      oldKey.keyPrefix,
      typeShort,
      oldKey.env,
      args.lookupPrefix,
      args.secretHex,
    ].join(KEY_PREFIX_SEPARATOR);

    await ctx.db.insert("apiKeyEvents", {
      keyId: args.keyId,
      ownerId: oldKey.ownerId,
      eventType: "key.rotated",
      metadata: { newKeyId },
      timestamp: now,
    });

    return { newKeyId, newKey: rawKey, oldKeyExpiresAt: gracePeriodEnd };
  },
});

export const list = query({
  args: {
    ownerId: v.string(),
    env: v.optional(v.string()),
    status: v.optional(KEY_STATUS),
  },
  returns: v.array(
    v.object({
      keyId: v.id("apiKeys"),
      name: v.string(),
      lookupPrefix: v.string(),
      type: KEY_TYPE,
      env: v.string(),
      scopes: v.array(v.string()),
      tags: v.array(v.string()),
      status: KEY_STATUS,
      metadata: v.optional(v.any()),
      remaining: v.optional(v.number()),
      expiresAt: v.optional(v.number()),
      createdAt: v.number(),
      lastUsedAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, { ownerId, env, status }) => {
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
        .withIndex("by_owner", (q) => q.eq("ownerId", ownerId));
    }

    const keys = await keysQuery.collect();

    return keys.map((k) => ({
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
    }));
  },
});

export const listByTag = query({
  args: {
    ownerId: v.string(),
    tag: v.string(),
  },
  returns: v.array(
    v.object({
      keyId: v.id("apiKeys"),
      name: v.string(),
      lookupPrefix: v.string(),
      type: KEY_TYPE,
      env: v.string(),
      scopes: v.array(v.string()),
      tags: v.array(v.string()),
      status: KEY_STATUS,
      metadata: v.optional(v.any()),
      remaining: v.optional(v.number()),
      expiresAt: v.optional(v.number()),
      createdAt: v.number(),
      lastUsedAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, { ownerId, tag }) => {
    const keys = await ctx.db
      .query("apiKeys")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .collect();

    return keys
      .filter((k) => k.tags.includes(tag))
      .map((k) => ({
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
      }));
  },
});

export const update = mutation({
  args: {
    keyId: v.id("apiKeys"),
    name: v.optional(v.string()),
    scopes: v.optional(v.array(v.string())),
    tags: v.optional(v.array(v.string())),
    metadata: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, { keyId, ...updates }) => {
    const key = await ctx.db.get(keyId);
    if (!key) {
      throw new Error("key not found");
    }
    if (TERMINAL_STATUSES.has(key.status as KeyStatus)) {
      throw new Error("cannot update terminal key");
    }
    if (updates.tags) {
      validateTags(updates.tags);
    }

    const patch: Record<string, unknown> = {};
    if (updates.name !== undefined) patch.name = updates.name;
    if (updates.scopes !== undefined) patch.scopes = updates.scopes;
    if (updates.tags !== undefined) patch.tags = updates.tags;
    if (updates.metadata !== undefined) patch.metadata = updates.metadata;

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(keyId, patch);
      await ctx.db.insert("apiKeyEvents", {
        keyId,
        ownerId: key.ownerId,
        eventType: "key.updated",
        metadata: { fields: Object.keys(patch) },
        timestamp: Date.now(),
      });
    }

    return null;
  },
});

export const disable = mutation({
  args: { keyId: v.id("apiKeys") },
  returns: v.null(),
  handler: async (ctx, { keyId }) => {
    const key = await ctx.db.get(keyId);
    if (!key) {
      throw new Error("key not found");
    }
    if (key.status === "disabled") {
      return null;
    }
    if (key.status !== "active") {
      throw new Error("can only disable active keys");
    }
    await ctx.db.patch(keyId, { status: "disabled" });
    await ctx.db.insert("apiKeyEvents", {
      keyId,
      ownerId: key.ownerId,
      eventType: "key.disabled",
      timestamp: Date.now(),
    });
    return null;
  },
});

export const enable = mutation({
  args: { keyId: v.id("apiKeys") },
  returns: v.null(),
  handler: async (ctx, { keyId }) => {
    const key = await ctx.db.get(keyId);
    if (!key) {
      throw new Error("key not found");
    }
    if (key.status === "active") {
      return null;
    }
    if (key.status !== "disabled") {
      throw new Error("can only enable disabled keys");
    }
    await ctx.db.patch(keyId, { status: "active" });
    await ctx.db.insert("apiKeyEvents", {
      keyId,
      ownerId: key.ownerId,
      eventType: "key.enabled",
      timestamp: Date.now(),
    });
    return null;
  },
});

export const getUsage = query({
  args: {
    keyId: v.id("apiKeys"),
    period: v.optional(
      v.object({
        start: v.number(),
        end: v.number(),
      }),
    ),
  },
  returns: v.object({
    total: v.number(),
    remaining: v.optional(v.number()),
    lastUsedAt: v.optional(v.number()),
  }),
  handler: async (ctx, { keyId, period }) => {
    const key = await ctx.db.get(keyId);
    if (!key) {
      throw new Error("key not found");
    }

    let total = 0;
    const eventsQuery = ctx.db
      .query("apiKeyEvents")
      .withIndex("by_key", (q) => {
        const base = q.eq("keyId", keyId);
        if (period) {
          return base.gte("timestamp", period.start).lte("timestamp", period.end);
        }
        return base;
      });

    const events = await eventsQuery.collect();
    total = events.filter((e) => e.eventType === "key.validated").length;

    return {
      total,
      remaining: key.remaining,
      lastUsedAt: key.lastUsedAt,
    };
  },
});

export const configure = mutation({
  args: {
    cleanupIntervalMs: v.optional(v.number()),
    defaultExpiryMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("config").first();
    if (existing) {
      await ctx.db.patch(existing._id, args);
    } else {
      await ctx.db.insert("config", args);
    }
    return null;
  },
});
