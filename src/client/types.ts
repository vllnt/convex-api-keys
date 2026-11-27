import type { KeyType, KeyStatus } from "../shared.js";

export type { KeyType, KeyStatus };

/** Options for `ApiKeys.create`. */
export interface CreateKeyOptions {
  name: string;
  ownerId: string;
  type?: KeyType;
  scopes?: string[];
  tags?: string[];
  env?: string;
  metadata?: Record<string, unknown>;
  remaining?: number;
  expiresAt?: number;
}

/** Result of `ApiKeys.create`: the new key's id and its raw value, returned once. */
export interface CreateKeyResult {
  keyId: string;
  key: string;
}

/** `validate` result for a usable key. */
export interface ValidationSuccess {
  valid: true;
  keyId: string;
  ownerId: string;
  type: KeyType;
  env: string;
  scopes: string[];
  tags: string[];
  metadata?: Record<string, unknown>;
  remaining?: number;
}

/** Why `validate` rejected a key. */
export type ValidationFailureReason =
  | "malformed"
  | "not_found"
  | "revoked"
  | "disabled"
  | "expired"
  | "exhausted";

/** `validate` result for an unusable key. */
export interface ValidationFailure {
  valid: false;
  reason: ValidationFailureReason;
}

/** Result of `ApiKeys.validate`; narrow on `valid`. */
export type ValidationResult = ValidationSuccess | ValidationFailure;

/** One key as returned by `list` and `listByTag`, without the raw key or hash. */
export interface KeyMetadata {
  keyId: string;
  name: string;
  lookupPrefix: string;
  type: KeyType;
  env: string;
  scopes: string[];
  tags: string[];
  status: KeyStatus;
  metadata?: Record<string, unknown>;
  remaining?: number;
  expiresAt?: number;
  createdAt: number;
  lastUsedAt?: number;
}

/** Result of `ApiKeys.getUsage`. */
export interface UsageStats {
  total: number;
  remaining?: number;
}

/** Result of `ApiKeys.rotate`: the replacement key and when the old one stops working. */
export interface RotateResult {
  newKeyId: string;
  newKey: string;
  oldKeyExpiresAt: number;
}
