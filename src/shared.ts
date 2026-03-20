import { v } from "convex/values";

export const KEY_TYPE = v.union(v.literal("secret"), v.literal("publishable"));
export type KeyType = "secret" | "publishable";

export const KEY_STATUS = v.union(
  v.literal("active"),
  v.literal("disabled"),
  v.literal("revoked"),
  v.literal("rotating"),
  v.literal("expired"),
  v.literal("exhausted"),
);
export type KeyStatus =
  | "active"
  | "disabled"
  | "revoked"
  | "rotating"
  | "expired"
  | "exhausted";

export const TERMINAL_STATUSES: ReadonlySet<KeyStatus> = new Set([
  "revoked",
  "expired",
  "exhausted",
]);

export const TAG_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]*$/;

export const EVENT_TYPE = v.union(
  v.literal("key.created"),
  v.literal("key.validated"),
  v.literal("key.validate_failed"),
  v.literal("key.revoked"),
  v.literal("key.rotated"),
  v.literal("key.expired"),
  v.literal("key.exhausted"),
  v.literal("key.disabled"),
  v.literal("key.enabled"),
  v.literal("key.updated"),
  v.literal("key.rate_limited"),
);
export type EventType =
  | "key.created"
  | "key.validated"
  | "key.validate_failed"
  | "key.revoked"
  | "key.rotated"
  | "key.expired"
  | "key.exhausted"
  | "key.disabled"
  | "key.enabled"
  | "key.updated"
  | "key.rate_limited";

export function validateTag(tag: string): void {
  if (!TAG_PATTERN.test(tag)) {
    throw new Error(
      `Invalid tag "${tag}": must be alphanumeric with hyphens, starting with alphanumeric`,
    );
  }
}

export function validateTags(tags: string[]): void {
  for (const tag of tags) {
    validateTag(tag);
  }
}

export const KEY_PREFIX_SEPARATOR = "_";

export function parseKeyString(key: string): {
  valid: false;
  reason: "malformed";
} | {
  valid: true;
  prefix: string;
  type: string;
  env: string;
  lookupPrefix: string;
  secret: string;
} {
  const parts = key.split(KEY_PREFIX_SEPARATOR);
  if (parts.length !== 5) {
    return { valid: false, reason: "malformed" };
  }
  const [prefix, type, env, lookupPrefix, secret] = parts;
  if (!prefix || !type || !env || !lookupPrefix || !secret) {
    return { valid: false, reason: "malformed" };
  }
  if (type !== "secret" && type !== "pub") {
    return { valid: false, reason: "malformed" };
  }
  if (lookupPrefix.length !== 8) {
    return { valid: false, reason: "malformed" };
  }
  if (secret.length !== 64) {
    return { valid: false, reason: "malformed" };
  }
  return { valid: true, prefix, type, env, lookupPrefix, secret };
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
