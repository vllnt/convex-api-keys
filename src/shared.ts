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
export const KEY_PREFIX_PATTERN = /^[a-zA-Z0-9]+$/;
export const ENV_PATTERN = /^[a-zA-Z0-9-]+$/;

export const MAX_METADATA_SIZE = 4096;
export const MAX_SCOPES = 50;
export const MAX_TAGS = 20;
export const MAX_STRING_LENGTH = 256;

export function validateKeyPrefix(prefix: string): void {
  if (!KEY_PREFIX_PATTERN.test(prefix)) {
    throw new Error(
      `Invalid keyPrefix "${prefix}": must match ^[a-zA-Z0-9]+$ (alphanumeric only, no underscores)`,
    );
  }
  if (prefix.length > MAX_STRING_LENGTH) {
    throw new Error(`keyPrefix must be <= ${MAX_STRING_LENGTH} characters`);
  }
}

export function validateEnv(env: string): void {
  if (!ENV_PATTERN.test(env)) {
    throw new Error(
      `Invalid env "${env}": must match ^[a-zA-Z0-9-]+$ (no underscores — would break key parsing)`,
    );
  }
  if (env.length > MAX_STRING_LENGTH) {
    throw new Error(`env must be <= ${MAX_STRING_LENGTH} characters`);
  }
}

export function validateSizeLimits(args: {
  metadata?: unknown;
  scopes?: string[];
  tags?: string[];
  name?: string;
}): void {
  if (args.metadata !== undefined) {
    const size = JSON.stringify(args.metadata).length;
    if (size > MAX_METADATA_SIZE) {
      throw new Error(`metadata must be <= ${MAX_METADATA_SIZE} bytes (got ${size})`);
    }
  }
  if (args.scopes && args.scopes.length > MAX_SCOPES) {
    throw new Error(`scopes must have <= ${MAX_SCOPES} entries (got ${args.scopes.length})`);
  }
  if (args.tags && args.tags.length > MAX_TAGS) {
    throw new Error(`tags must have <= ${MAX_TAGS} entries (got ${args.tags.length})`);
  }
  if (args.name && args.name.length > MAX_STRING_LENGTH) {
    throw new Error(`name must be <= ${MAX_STRING_LENGTH} characters`);
  }
}


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

/** Compute SHA-256 hash of input, returned as lowercase hex string. */
export async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
