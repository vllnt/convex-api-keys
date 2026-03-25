/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    mutations: {
      configure: FunctionReference<
        "mutation",
        "internal",
        { cleanupIntervalMs?: number; defaultExpiryMs?: number },
        null,
        Name
      >;
      create: FunctionReference<
        "mutation",
        "internal",
        {
          env?: string;
          expiresAt?: number;
          keyPrefix?: string;
          metadata?: any;
          name: string;
          ownerId: string;
          remaining?: number;
          scopes?: Array<string>;
          tags?: Array<string>;
          type?: "secret" | "publishable";
        },
        { key: string; keyId: string },
        Name
      >;
      disable: FunctionReference<
        "mutation",
        "internal",
        { keyId: string; ownerId: string },
        null,
        Name
      >;
      enable: FunctionReference<
        "mutation",
        "internal",
        { keyId: string; ownerId: string },
        null,
        Name
      >;
      revoke: FunctionReference<
        "mutation",
        "internal",
        { keyId: string; ownerId: string },
        null,
        Name
      >;
      revokeByTag: FunctionReference<
        "mutation",
        "internal",
        { ownerId: string; tag: string },
        { revokedCount: number },
        Name
      >;
      rotate: FunctionReference<
        "mutation",
        "internal",
        {
          gracePeriodMs?: number;
          keyId: string;
          ownerId: string;
        },
        { newKey: string; newKeyId: string; oldKeyExpiresAt: number },
        Name
      >;
      update: FunctionReference<
        "mutation",
        "internal",
        {
          keyId: string;
          metadata?: any;
          name?: string;
          ownerId: string;
          scopes?: Array<string>;
          tags?: Array<string>;
        },
        null,
        Name
      >;
      validate: FunctionReference<
        "mutation",
        "internal",
        { key: string },
        | {
            env: string;
            keyId: string;
            metadata?: any;
            ownerId: string;
            remaining?: number;
            scopes: Array<string>;
            tags: Array<string>;
            type: "secret" | "publishable";
            valid: true;
          }
        | { reason: string; valid: false },
        Name
      >;
    };
    queries: {
      getUsage: FunctionReference<
        "query",
        "internal",
        { keyId: string; ownerId: string },
        { remaining?: number; total: number },
        Name
      >;
      list: FunctionReference<
        "query",
        "internal",
        {
          env?: string;
          ownerId: string;
          status?:
            | "active"
            | "disabled"
            | "revoked"
            | "rotating"
            | "expired"
            | "exhausted";
        },
        Array<{
          createdAt: number;
          env: string;
          expiresAt?: number;
          keyId: string;
          lastUsedAt?: number;
          lookupPrefix: string;
          metadata?: any;
          name: string;
          remaining?: number;
          scopes: Array<string>;
          status:
            | "active"
            | "disabled"
            | "revoked"
            | "rotating"
            | "expired"
            | "exhausted";
          tags: Array<string>;
          type: "secret" | "publishable";
        }>,
        Name
      >;
      listByTag: FunctionReference<
        "query",
        "internal",
        { ownerId: string; tag: string },
        Array<{
          createdAt: number;
          env: string;
          expiresAt?: number;
          keyId: string;
          lastUsedAt?: number;
          lookupPrefix: string;
          metadata?: any;
          name: string;
          remaining?: number;
          scopes: Array<string>;
          status:
            | "active"
            | "disabled"
            | "revoked"
            | "rotating"
            | "expired"
            | "exhausted";
          tags: Array<string>;
          type: "secret" | "publishable";
        }>,
        Name
      >;
    };
  };
