import type { KeyType, KeyStatus, EventType } from "../shared.js";

export type { KeyType, KeyStatus, EventType };

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

export interface CreateKeyResult {
  keyId: string;
  key: string;
}

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

export interface ValidationFailure {
  valid: false;
  reason: string;
  retryAfter?: number;
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

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

export interface UsageStats {
  total: number;
  remaining?: number;
  lastUsedAt?: number;
}

export interface RotateResult {
  newKeyId: string;
  newKey: string;
  oldKeyExpiresAt: number;
}

export interface KeyEvent {
  keyId: string;
  ownerId: string;
  eventType: EventType;
  reason?: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
}
