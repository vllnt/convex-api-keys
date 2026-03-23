import type { GenericMutationCtx, GenericQueryCtx, GenericDataModel } from "convex/server";
import type { ComponentApi } from "../component/_generated/component.js";
import { sha256Hex } from "../shared.js";
import type {
  CreateKeyOptions,
  CreateKeyResult,
  ValidationResult,
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
  KeyMetadata,
  UsageStats,
  RotateResult,
  KeyType,
  KeyStatus,
};

export type RunMutationCtx = Pick<GenericMutationCtx<GenericDataModel>, "runMutation">;
export type RunQueryCtx = Pick<GenericQueryCtx<GenericDataModel>, "runQuery">;

export interface ApiKeysConfig {
  prefix?: string;
  defaultType?: KeyType;
}

function generateRandomHex(length: number): string {
  const bytes = new Uint8Array(length / 2);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export class ApiKeys {
  public component: ComponentApi;
  private prefix: string;
  private defaultType: KeyType;

  constructor(component: ComponentApi, config?: ApiKeysConfig) {
    this.component = component;
    this.prefix = config?.prefix ?? "vk";
    this.defaultType = config?.defaultType ?? "secret";
  }

  async create(
    ctx: RunMutationCtx,
    options: CreateKeyOptions,
  ): Promise<CreateKeyResult> {
    const type = options.type ?? this.defaultType;
    const typeShort = type === "publishable" ? "pub" : "secret";
    const env = options.env ?? "live";

    const lookupPrefix = generateRandomHex(8);
    const secretHex = generateRandomHex(64);

    const rawKey = [this.prefix, typeShort, env, lookupPrefix, secretHex].join("_");
    const hash = await sha256Hex(rawKey);

    const result = await ctx.runMutation(this.component.mutations.create, {
      name: options.name,
      ownerId: options.ownerId,
      type,
      scopes: options.scopes,
      tags: options.tags,
      env,
      metadata: options.metadata,
      remaining: options.remaining,
      expiresAt: options.expiresAt,
      keyPrefix: this.prefix,
      lookupPrefix,
      secretHex,
      hash,
    });

    return { keyId: result.keyId as string, key: result.key };
  }

  async validate(
    ctx: RunMutationCtx,
    args: { key: string },
  ): Promise<ValidationResult> {
    return await ctx.runMutation(
      this.component.mutations.validate,
      { key: args.key },
    ) as ValidationResult;
  }

  async revoke(ctx: RunMutationCtx, args: { keyId: string }): Promise<void> {
    await ctx.runMutation(this.component.mutations.revoke, { keyId: args.keyId });
  }

  async revokeByTag(
    ctx: RunMutationCtx,
    args: { ownerId: string; tag: string },
  ): Promise<{ revokedCount: number }> {
    return await ctx.runMutation(this.component.mutations.revokeByTag, args);
  }

  async rotate(
    ctx: RunMutationCtx,
    args: { keyId: string; gracePeriodMs?: number },
  ): Promise<RotateResult> {
    const lookupPrefix = generateRandomHex(8);
    const secretHex = generateRandomHex(64);

    return await ctx.runMutation(this.component.mutations.rotate, {
      keyId: args.keyId,
      gracePeriodMs: args.gracePeriodMs,
      lookupPrefix,
      secretHex,
    }) as RotateResult;
  }

  async list(
    ctx: RunQueryCtx,
    args: { ownerId: string; env?: string; status?: KeyStatus },
  ): Promise<KeyMetadata[]> {
    return await ctx.runQuery(
      this.component.queries.list,
      args,
    ) as unknown as KeyMetadata[];
  }

  async listByTag(
    ctx: RunQueryCtx,
    args: { ownerId: string; tag: string },
  ): Promise<KeyMetadata[]> {
    return await ctx.runQuery(
      this.component.queries.listByTag,
      args,
    ) as unknown as KeyMetadata[];
  }

  async update(
    ctx: RunMutationCtx,
    args: {
      keyId: string;
      name?: string;
      scopes?: string[];
      tags?: string[];
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    await ctx.runMutation(this.component.mutations.update, {
      keyId: args.keyId,
      name: args.name,
      scopes: args.scopes,
      tags: args.tags,
      metadata: args.metadata,
    });
  }

  async disable(ctx: RunMutationCtx, args: { keyId: string }): Promise<void> {
    await ctx.runMutation(this.component.mutations.disable, { keyId: args.keyId });
  }

  async enable(ctx: RunMutationCtx, args: { keyId: string }): Promise<void> {
    await ctx.runMutation(this.component.mutations.enable, { keyId: args.keyId });
  }

  async getUsage(
    ctx: RunQueryCtx,
    args: { keyId: string; period?: { start: number; end: number } },
  ): Promise<UsageStats> {
    return await ctx.runQuery(this.component.queries.getUsage, {
      keyId: args.keyId,
      period: args.period,
    }) as UsageStats;
  }

  async configure(
    ctx: RunMutationCtx,
    args: { cleanupIntervalMs?: number; defaultExpiryMs?: number },
  ): Promise<void> {
    await ctx.runMutation(this.component.mutations.configure, args);
  }
}
