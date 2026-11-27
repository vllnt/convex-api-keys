import type { GenericMutationCtx, GenericQueryCtx, GenericDataModel } from "convex/server";
import type { ComponentApi } from "../component/_generated/component.js";
import type {
  CreateKeyOptions,
  CreateKeyResult,
  ValidationResult,
  ValidationFailureReason,
  KeyMetadata,
  UsageStats,
  RotateResult,
  KeyType,
  KeyStatus,
} from "./types.js";

export type {
  CreateKeyOptions,
  CreateKeyResult,
  ValidationResult,
  ValidationFailureReason,
  KeyMetadata,
  UsageStats,
  RotateResult,
  KeyType,
  KeyStatus,
};

/** Any Convex context that can run a mutation: a mutation, action or HTTP action `ctx`. */
export type RunMutationCtx = Pick<GenericMutationCtx<GenericDataModel>, "runMutation">;

/** Any Convex context that can run a query: a query, mutation, action or HTTP action `ctx`. */
export type RunQueryCtx = Pick<GenericQueryCtx<GenericDataModel>, "runQuery">;

/** Options for `new ApiKeys(component, config)`. */
export interface ApiKeysConfig {
  /** First segment of every key created by this client; letters and digits only. Default `"vk"`. */
  prefix?: string;
  /** Key type when `create` gets no `type`. Default `"secret"`. */
  defaultType?: KeyType;
}

/**
 * Client for the API keys component. Construct it once per mount with
 * `components.apiKeys` and call its methods from your own Convex functions.
 *
 * @example
 * ```ts
 * const apiKeys = new ApiKeys(components.apiKeys, { prefix: "myapp" });
 * ```
 *
 * @see https://oss.vllnt.com/packages/convex-api-keys
 */
export class ApiKeys {
  /** The mounted component API this client calls (`components.apiKeys`). */
  public component: ComponentApi;
  private prefix: string;
  private defaultType: KeyType;

  /**
   * Create a client for one mounted component.
   * @param component - The mounted component, `components.apiKeys`.
   * @param config - Key prefix and default key type.
   */
  constructor(component: ComponentApi, config?: ApiKeysConfig) {
    this.component = component;
    this.prefix = config?.prefix ?? "vk";
    this.defaultType = config?.defaultType ?? "secret";
  }

  /**
   * Create a key. Secret material is generated server-side; only its SHA-256
   * hash is stored.
   * @returns `{ keyId, key }`. `key` is the raw key and is returned only here.
   */
  async create(
    ctx: RunMutationCtx,
    options: CreateKeyOptions,
  ): Promise<CreateKeyResult> {
    const result = await ctx.runMutation(this.component.mutations.create, {
      name: options.name,
      ownerId: options.ownerId,
      type: options.type ?? this.defaultType,
      scopes: options.scopes,
      tags: options.tags,
      env: options.env ?? "live",
      metadata: options.metadata,
      remaining: options.remaining,
      expiresAt: options.expiresAt,
      keyPrefix: this.prefix,
    });

    return { keyId: result.keyId as string, key: result.key };
  }

  /**
   * Check a key and count one use (decrements `remaining` when set). Never
   * throws for a bad key.
   * @returns `{ valid: true, ...key fields }` or `{ valid: false, reason }`.
   */
  async validate(
    ctx: RunMutationCtx,
    args: { key: string },
  ): Promise<ValidationResult> {
    return await ctx.runMutation(
      this.component.mutations.validate,
      { key: args.key },
    ) as ValidationResult;
  }

  /**
   * Permanently revoke a key owned by `ownerId`. Does nothing for a key that is
   * already `revoked`, `expired` or `exhausted`.
   */
  async revoke(ctx: RunMutationCtx, args: { keyId: string; ownerId: string }): Promise<void> {
    await ctx.runMutation(this.component.mutations.revoke, {
      keyId: args.keyId,
      ownerId: args.ownerId,
    });
  }

  /**
   * Revoke every `active`, `rotating` or `disabled` key of `ownerId` that has `tag`.
   * @returns `{ revokedCount }`.
   */
  async revokeByTag(
    ctx: RunMutationCtx,
    args: { ownerId: string; tag: string },
  ): Promise<{ revokedCount: number }> {
    return await ctx.runMutation(this.component.mutations.revokeByTag, args);
  }

  /**
   * Create a replacement for an `active` unlimited-use key. The old key stays
   * valid for `gracePeriodMs` (default 1 hour, 60 s to 30 days), capped at its own expiry.
   * @returns `{ newKeyId, newKey, oldKeyExpiresAt }`.
   */
  async rotate(
    ctx: RunMutationCtx,
    args: { keyId: string; ownerId: string; gracePeriodMs?: number },
  ): Promise<RotateResult> {
    return await ctx.runMutation(this.component.mutations.rotate, {
      keyId: args.keyId,
      ownerId: args.ownerId,
      gracePeriodMs: args.gracePeriodMs,
    }) as RotateResult;
  }

  /**
   * Up to `limit` (default 100) keys of `ownerId`, optionally filtered by `env`
   * and `status`. No raw keys or hashes; no cursor.
   */
  async list(
    ctx: RunQueryCtx,
    args: { ownerId: string; env?: string; status?: KeyStatus; limit?: number },
  ): Promise<KeyMetadata[]> {
    return await ctx.runQuery(
      this.component.queries.list,
      args,
    ) as unknown as KeyMetadata[];
  }

  /** Up to `limit` (default 100) keys of `ownerId` that have `tag`. No cursor. */
  async listByTag(
    ctx: RunQueryCtx,
    args: { ownerId: string; tag: string; limit?: number },
  ): Promise<KeyMetadata[]> {
    return await ctx.runQuery(
      this.component.queries.listByTag,
      args,
    ) as unknown as KeyMetadata[];
  }

  /** Change `name`, `scopes`, `tags` or `metadata` of a key that is not final. */
  async update(
    ctx: RunMutationCtx,
    args: {
      keyId: string;
      ownerId: string;
      name?: string;
      scopes?: string[];
      tags?: string[];
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    await ctx.runMutation(this.component.mutations.update, {
      keyId: args.keyId,
      ownerId: args.ownerId,
      name: args.name,
      scopes: args.scopes,
      tags: args.tags,
      metadata: args.metadata,
    });
  }

  /** Pause an `active` key; `validate` then returns `reason: "disabled"`. */
  async disable(ctx: RunMutationCtx, args: { keyId: string; ownerId: string }): Promise<void> {
    await ctx.runMutation(this.component.mutations.disable, {
      keyId: args.keyId,
      ownerId: args.ownerId,
    });
  }

  /** Resume a `disabled` key. */
  async enable(ctx: RunMutationCtx, args: { keyId: string; ownerId: string }): Promise<void> {
    await ctx.runMutation(this.component.mutations.enable, {
      keyId: args.keyId,
      ownerId: args.ownerId,
    });
  }

  /**
   * Stored status of the key matching `key`, or null for a malformed or
   * unknown key. Read-only: no usage count, no expiry update. `active` and
   * `rotating` still need `validate()` before the key is trusted.
   */
  async matchStatus(ctx: RunQueryCtx, args: { key: string }): Promise<KeyStatus | null> {
    return await ctx.runQuery(this.component.queries.matchStatus, { key: args.key });
  }

  /**
   * Usage count of a key owned by `ownerId`.
   * @returns `{ total, remaining? }`.
   */
  async getUsage(
    ctx: RunQueryCtx,
    args: { keyId: string; ownerId: string },
  ): Promise<UsageStats> {
    return await ctx.runQuery(this.component.queries.getUsage, {
      keyId: args.keyId,
      ownerId: args.ownerId,
    }) as UsageStats;
  }

  /**
   * Store `cleanupIntervalMs` and `defaultExpiryMs`. Admin-only, not scoped by
   * owner. The values are stored but not used yet.
   */
  async configure(
    ctx: RunMutationCtx,
    args: { cleanupIntervalMs?: number; defaultExpiryMs?: number },
  ): Promise<void> {
    await ctx.runMutation(this.component.mutations.configure, args);
  }
}
