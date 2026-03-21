import type { GenericActionCtx, GenericMutationCtx, GenericQueryCtx, GenericDataModel } from "convex/server";
import type { ComponentApi } from "../component/_generated/component.js";
import { createConvexLogger } from "@vllnt/logger/convex";
import { sha256Hex } from "../shared.js";

const log = createConvexLogger("api-keys:client");
import type {
  ApiKeyConfig,
  CreateKeyOptions,
  CreateKeyResult,
  ValidationResult,
  KeyMetadata,
  UsageStats,
  RotateResult,
  KeyType,
  KeyStatus,
} from "./types.js";

export type { ApiKeyConfig, CreateKeyOptions, CreateKeyResult, ValidationResult, KeyMetadata, UsageStats, RotateResult, KeyType, KeyStatus };

type RunMutationCtx = Pick<GenericMutationCtx<GenericDataModel>, "runMutation">;
type RunQueryCtx = Pick<GenericQueryCtx<GenericDataModel>, "runQuery">;
type RunActionCtx = Pick<GenericActionCtx<GenericDataModel>, "runAction">;

function generateRandomHex(length: number): string {
  const bytes = new Uint8Array(length / 2);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export class ApiKeys {
  private component: ComponentApi;
  private config: ApiKeyConfig;

  constructor(component: ComponentApi, config?: ApiKeyConfig) {
    this.component = component;
    this.config = config ?? {};
  }

  async create(
    ctx: RunMutationCtx,
    options: CreateKeyOptions,
  ): Promise<CreateKeyResult> {
    const prefix = this.config.prefix ?? "vk";
    const type = options.type ?? this.config.defaultType ?? "secret";
    const typeShort = type === "publishable" ? "pub" : "secret";
    const env = options.env ?? "live";

    const lookupPrefix = generateRandomHex(8);
    const secretHex = generateRandomHex(64);

    const rawKey = [prefix, typeShort, env, lookupPrefix, secretHex].join("_");
    const hash = await sha256Hex(rawKey);

    const result = await ctx.runMutation(this.component.public.create, {
      name: options.name,
      ownerId: options.ownerId,
      type,
      scopes: options.scopes,
      tags: options.tags,
      env,
      metadata: options.metadata,
      remaining: options.remaining,
      expiresAt: options.expiresAt,
      keyPrefix: prefix,
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
    const result = await ctx.runMutation(this.component.public.validate, {
      key: args.key,
    });
    return result as ValidationResult;
  }

  async revoke(
    ctx: RunMutationCtx,
    args: { keyId: string },
  ): Promise<void> {
    await ctx.runMutation(this.component.public.revoke, {
      keyId: args.keyId as never,
    });
  }

  async revokeByTag(
    ctx: RunMutationCtx,
    args: { ownerId: string; tag: string },
  ): Promise<{ revokedCount: number }> {
    return await ctx.runMutation(this.component.public.revokeByTag, args);
  }

  async rotate(
    ctx: RunMutationCtx,
    args: { keyId: string; gracePeriodMs?: number },
  ): Promise<RotateResult> {
    const lookupPrefix = generateRandomHex(8);
    const secretHex = generateRandomHex(64);

    const oldKey = await ctx.runMutation(this.component.public.rotate, {
      keyId: args.keyId as never,
      gracePeriodMs: args.gracePeriodMs,
      lookupPrefix,
      secretHex,
      hash: await sha256Hex(
        [this.config.prefix ?? "vk", "secret", "live", lookupPrefix, secretHex].join("_"),
      ),
    }) as { newKeyId: string; newKey: string; oldKeyExpiresAt: number };

    return oldKey;
  }

  async list(
    ctx: RunQueryCtx,
    args: { ownerId: string; env?: string; status?: KeyStatus },
  ): Promise<KeyMetadata[]> {
    const result = await ctx.runQuery(this.component.public.list, args);
    return result as unknown as KeyMetadata[];
  }

  async listByTag(
    ctx: RunQueryCtx,
    args: { ownerId: string; tag: string },
  ): Promise<KeyMetadata[]> {
    const result = await ctx.runQuery(this.component.public.listByTag, args);
    return result as unknown as KeyMetadata[];
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
    await ctx.runMutation(this.component.public.update, {
      keyId: args.keyId as never,
      name: args.name,
      scopes: args.scopes,
      tags: args.tags,
      metadata: args.metadata,
    });
  }

  async disable(ctx: RunMutationCtx, args: { keyId: string }): Promise<void> {
    await ctx.runMutation(this.component.public.disable, {
      keyId: args.keyId as never,
    });
  }

  async enable(ctx: RunMutationCtx, args: { keyId: string }): Promise<void> {
    await ctx.runMutation(this.component.public.enable, {
      keyId: args.keyId as never,
    });
  }

  async getUsage(
    ctx: RunQueryCtx,
    args: { keyId: string; period?: { start: number; end: number } },
  ): Promise<UsageStats> {
    const result = await ctx.runQuery(this.component.public.getUsage, {
      keyId: args.keyId as never,
      period: args.period,
    });
    return result as UsageStats;
  }

  async configure(
    ctx: RunMutationCtx,
    args: { cleanupIntervalMs?: number; defaultExpiryMs?: number },
  ): Promise<void> {
    await ctx.runMutation(this.component.public.configure, args);
  }
}
