import { v } from "convex/values";
import { mutation } from "./_generated/server.js";
import { components } from "./_generated/api.js";
import { ShardedCounter } from "@convex-dev/sharded-counter";
import {
  KEY_TYPE,
  TERMINAL_STATUSES,
  parseKeyString,
  timingSafeEqual,
  sha256Hex,
  validateTags,
  validateKeyPrefix,
  validateEnv,
  validateSizeLimits,
  KEY_PREFIX_SEPARATOR,
} from "../shared.js";
import { createLogger } from "../log.js";
import { jsonValue } from "./validators.js";
import type { KeyStatus } from "../shared.js";

const log = createLogger("api-keys");

const counter = new ShardedCounter(components.shardedCounter);

function generateRandomHex(length: number): string {
  const bytes = new Uint8Array(length / 2);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const create = mutation({
  args: {
    name: v.string(),
    ownerId: v.string(),
    type: v.optional(KEY_TYPE),
    scopes: v.optional(v.array(v.string())),
    tags: v.optional(v.array(v.string())),
    env: v.optional(v.string()),
    metadata: v.optional(jsonValue),
    remaining: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    keyPrefix: v.optional(v.string()),
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

    const prefix = args.keyPrefix ?? "vk";
    validateKeyPrefix(prefix);
    const env = args.env ?? "live";
    validateEnv(env);
    validateSizeLimits({ metadata: args.metadata, scopes: args.scopes, tags: args.tags, name: args.name });

    const type = args.type ?? "secret";
    const typeShort = type === "publishable" ? "pub" : "secret";

    const lookupPrefix = generateRandomHex(8);
    const secretHex = generateRandomHex(64);
    const rawKey = [prefix, typeShort, env, lookupPrefix, secretHex].join(
      KEY_PREFIX_SEPARATOR,
    );
    const hash = await sha256Hex(rawKey);

    const keyId = await ctx.db.insert("apiKeys", {
      hash,
      lookupPrefix,
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

    log.info("key.created", { keyId, ownerId: args.ownerId, type, env });
    return { keyId, key: rawKey };
  },
});

const LAST_USED_AT_THROTTLE_MS = 60_000;

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
      metadata: v.optional(jsonValue),
      remaining: v.optional(v.number()),
    }),
    v.object({
      valid: v.literal(false),
      reason: v.string(),
    }),
  ),
  handler: async (ctx, { key }) => {
    const parsed = parseKeyString(key);
    if (!parsed.valid) {
      log.info("key.validate_failed", { reason: "malformed" });
      return { valid: false as const, reason: "malformed" };
    }

    const candidates = await ctx.db
      .query("apiKeys")
      .withIndex("by_lookup_prefix", (q) => q.eq("lookupPrefix", parsed.lookupPrefix))
      .collect();

    if (candidates.length === 0) {
      log.info("key.validate_failed", { reason: "not_found", lookupPrefix: parsed.lookupPrefix });
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
      log.info("key.validate_failed", { reason: "not_found", lookupPrefix: parsed.lookupPrefix });
      return { valid: false as const, reason: "not_found" };
    }

    const now = Date.now();

    if (matchedKey.status === "revoked") {
      log.info("key.validate_failed", { keyId: matchedKey._id, reason: "revoked" });
      return { valid: false as const, reason: "revoked" };
    }

    if (matchedKey.status === "disabled") {
      log.info("key.validate_failed", { keyId: matchedKey._id, reason: "disabled" });
      return { valid: false as const, reason: "disabled" };
    }

    if (matchedKey.status === "exhausted") {
      log.info("key.validate_failed", { keyId: matchedKey._id, reason: "exhausted" });
      return { valid: false as const, reason: "exhausted" };
    }

    if (matchedKey.expiresAt && matchedKey.expiresAt <= now) {
      await ctx.db.patch(matchedKey._id, { status: "expired" });
      log.info("key.expired", { keyId: matchedKey._id });
      return { valid: false as const, reason: "expired" };
    }

    if (
      matchedKey.status === "rotating" &&
      matchedKey.gracePeriodEnd &&
      matchedKey.gracePeriodEnd <= now
    ) {
      await ctx.db.patch(matchedKey._id, { status: "expired" });
      log.info("key.expired", { keyId: matchedKey._id, reason: "grace_period_ended" });
      return { valid: false as const, reason: "expired" };
    }

    let newRemaining = matchedKey.remaining;
    if (matchedKey.remaining !== undefined) {
      if (matchedKey.remaining <= 0) {
        await ctx.db.patch(matchedKey._id, { status: "exhausted" });
        log.info("key.exhausted", { keyId: matchedKey._id });
        return { valid: false as const, reason: "exhausted" };
      }
      newRemaining = matchedKey.remaining - 1;
    }

    const shouldUpdateLastUsed =
      !matchedKey.lastUsedAt || now - matchedKey.lastUsedAt >= LAST_USED_AT_THROTTLE_MS;

    const patch: Record<string, unknown> = {};
    if (newRemaining !== matchedKey.remaining) {
      patch.remaining = newRemaining;
      if (newRemaining === 0) {
        patch.status = "exhausted";
      }
    }
    if (shouldUpdateLastUsed) {
      patch.lastUsedAt = now;
    }
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(matchedKey._id, patch);
    }
    if (newRemaining === 0) {
      log.info("key.exhausted", { keyId: matchedKey._id });
    }

    await counter.add(ctx, matchedKey._id, 1);

    log.info("key.validated", { keyId: matchedKey._id, ownerId: matchedKey.ownerId });

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
    ownerId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { keyId, ownerId }) => {
    const key = await ctx.db.get(keyId);
    if (!key) {
      throw new Error("key not found");
    }
    if (key.ownerId !== ownerId) {
      throw new Error("unauthorized: key does not belong to owner");
    }
    if (key.status === "revoked") {
      return null;
    }
    await ctx.db.patch(keyId, { status: "revoked", revokedAt: Date.now() });
    log.info("key.revoked", { keyId, ownerId });
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
    const activeKeys = await ctx.db
      .query("apiKeys")
      .withIndex("by_owner_status", (q) => q.eq("ownerId", ownerId).eq("status", "active"))
      .collect();
    const rotatingKeys = await ctx.db
      .query("apiKeys")
      .withIndex("by_owner_status", (q) => q.eq("ownerId", ownerId).eq("status", "rotating"))
      .collect();
    const disabledKeys = await ctx.db
      .query("apiKeys")
      .withIndex("by_owner_status", (q) => q.eq("ownerId", ownerId).eq("status", "disabled"))
      .collect();

    const allKeys = [...activeKeys, ...rotatingKeys, ...disabledKeys];
    let revokedCount = 0;
    const now = Date.now();
    for (const key of allKeys) {
      if (key.tags.includes(tag)) {
        await ctx.db.patch(key._id, { status: "revoked", revokedAt: now });
        revokedCount++;
      }
    }
    log.info("key.bulk_revoked", { ownerId, tag, revokedCount });
    return { revokedCount };
  },
});

const MIN_GRACE_PERIOD_MS = 60_000;
const MAX_GRACE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

export const rotate = mutation({
  args: {
    keyId: v.id("apiKeys"),
    ownerId: v.string(),
    gracePeriodMs: v.optional(v.number()),
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
    if (oldKey.ownerId !== args.ownerId) {
      throw new Error("unauthorized: key does not belong to owner");
    }
    if (TERMINAL_STATUSES.has(oldKey.status as KeyStatus)) {
      throw new Error("cannot rotate a terminal key");
    }

    const gracePeriodMs = args.gracePeriodMs ?? 3600000;
    if (gracePeriodMs < MIN_GRACE_PERIOD_MS || gracePeriodMs > MAX_GRACE_PERIOD_MS) {
      throw new Error(
        `gracePeriodMs must be between ${MIN_GRACE_PERIOD_MS} (60s) and ${MAX_GRACE_PERIOD_MS} (30 days)`,
      );
    }

    const now = Date.now();
    const gracePeriodEnd = now + gracePeriodMs;

    await ctx.db.patch(args.keyId, {
      status: "rotating",
      gracePeriodEnd,
    });

    const typeShort = oldKey.type === "publishable" ? "pub" : "secret";
    const lookupPrefix = generateRandomHex(8);
    const secretHex = generateRandomHex(64);
    const rawKey = [
      oldKey.keyPrefix,
      typeShort,
      oldKey.env,
      lookupPrefix,
      secretHex,
    ].join(KEY_PREFIX_SEPARATOR);
    const hash = await sha256Hex(rawKey);

    const newKeyId = await ctx.db.insert("apiKeys", {
      hash,
      lookupPrefix,
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

    log.info("key.rotated", { keyId: args.keyId, newKeyId, ownerId: oldKey.ownerId });
    return { newKeyId, newKey: rawKey, oldKeyExpiresAt: gracePeriodEnd };
  },
});

export const update = mutation({
  args: {
    keyId: v.id("apiKeys"),
    ownerId: v.string(),
    name: v.optional(v.string()),
    scopes: v.optional(v.array(v.string())),
    tags: v.optional(v.array(v.string())),
    metadata: v.optional(jsonValue),
  },
  returns: v.null(),
  handler: async (ctx, { keyId, ownerId, ...updates }) => {
    const key = await ctx.db.get(keyId);
    if (!key) {
      throw new Error("key not found");
    }
    if (key.ownerId !== ownerId) {
      throw new Error("unauthorized: key does not belong to owner");
    }
    if (TERMINAL_STATUSES.has(key.status as KeyStatus)) {
      throw new Error("cannot update terminal key");
    }
    if (updates.tags) {
      validateTags(updates.tags);
    }
    validateSizeLimits({ metadata: updates.metadata, scopes: updates.scopes, tags: updates.tags, name: updates.name });

    const patch: Record<string, unknown> = {};
    if (updates.name !== undefined) patch.name = updates.name;
    if (updates.scopes !== undefined) patch.scopes = updates.scopes;
    if (updates.tags !== undefined) patch.tags = updates.tags;
    if (updates.metadata !== undefined) patch.metadata = updates.metadata;

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(keyId, patch);
      log.info("key.updated", { keyId, ownerId, fields: Object.keys(patch) });
    }

    return null;
  },
});

export const disable = mutation({
  args: {
    keyId: v.id("apiKeys"),
    ownerId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { keyId, ownerId }) => {
    const key = await ctx.db.get(keyId);
    if (!key) {
      throw new Error("key not found");
    }
    if (key.ownerId !== ownerId) {
      throw new Error("unauthorized: key does not belong to owner");
    }
    if (key.status === "disabled") {
      return null;
    }
    if (key.status !== "active") {
      throw new Error("can only disable active keys");
    }
    await ctx.db.patch(keyId, { status: "disabled" });
    log.info("key.disabled", { keyId, ownerId });
    return null;
  },
});

export const enable = mutation({
  args: {
    keyId: v.id("apiKeys"),
    ownerId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { keyId, ownerId }) => {
    const key = await ctx.db.get(keyId);
    if (!key) {
      throw new Error("key not found");
    }
    if (key.ownerId !== ownerId) {
      throw new Error("unauthorized: key does not belong to owner");
    }
    if (key.status === "active") {
      return null;
    }
    if (key.status !== "disabled") {
      throw new Error("can only enable disabled keys");
    }
    await ctx.db.patch(keyId, { status: "active" });
    log.info("key.enabled", { keyId, ownerId });
    return null;
  },
});

export const configure = mutation({
  args: {
    cleanupIntervalMs: v.optional(v.number()),
    defaultExpiryMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.cleanupIntervalMs !== undefined && args.cleanupIntervalMs <= 0) {
      throw new Error("cleanupIntervalMs must be > 0");
    }
    if (args.defaultExpiryMs !== undefined && args.defaultExpiryMs <= 0) {
      throw new Error("defaultExpiryMs must be > 0");
    }

    const existing = await ctx.db.query("config").first();
    const oldValues = existing
      ? { cleanupIntervalMs: existing.cleanupIntervalMs, defaultExpiryMs: existing.defaultExpiryMs }
      : {};

    if (existing) {
      await ctx.db.patch(existing._id, args);
    } else {
      await ctx.db.insert("config", args);
    }

    log.info("config.updated", { old: oldValues, new: args });
    return null;
  },
});
