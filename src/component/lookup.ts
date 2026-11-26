import { parseKeyString, sha256Hex, timingSafeEqual } from "../shared.js";
import type { Doc } from "./_generated/dataModel.js";
import type { DatabaseReader } from "./_generated/server.js";

export type KeyLookup =
  | { found: true; key: Doc<"apiKeys"> }
  | { found: false; lookupPrefix?: string; reason: "malformed" | "not_found" };

/**
 * Finds the stored key whose hash matches a full key string. Shared by the
 * `validate` mutation and the read-only `matchStatus` query so both match the
 * same row the same way (lookup-prefix index, constant-time hash compare).
 */
export async function findKey(db: DatabaseReader, key: string): Promise<KeyLookup> {
  const parsed = parseKeyString(key);
  if (!parsed.valid) {
    return { found: false, reason: "malformed" };
  }
  const { lookupPrefix } = parsed;
  const candidates = await db
    .query("apiKeys")
    .withIndex("by_lookup_prefix", (q) => q.eq("lookupPrefix", lookupPrefix))
    .collect();
  if (candidates.length === 0) {
    return { found: false, lookupPrefix, reason: "not_found" };
  }
  const keyHash = await sha256Hex(key);
  const matched = candidates.find((candidate) => timingSafeEqual(candidate.hash, keyHash));
  return matched === undefined
    ? { found: false, lookupPrefix, reason: "not_found" }
    : { found: true, key: matched };
}
