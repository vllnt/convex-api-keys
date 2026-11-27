/// <reference types="vite/client" />
import type { TestConvex } from "convex-test";
import type { GenericSchema, SchemaDefinition } from "convex/server";
import schema from "./component/schema.js";

/* v8 ignore next -- Vite rewrites import.meta.glob into a declaration-only module map */
const modules = import.meta.glob("./component/**/*.ts");

/**
 * Mount the component in a `convex-test` instance. It does not register the
 * `@convex-dev/sharded-counter` child component: register it yourself at
 * `${name}/shardedCounter`, as in the example.
 * @param t - The instance returned by `convexTest(schema, modules)`.
 * @param name - Mount name; default `"apiKeys"`.
 * @example
 * ```ts
 * import shardedCounterTest from "@convex-dev/sharded-counter/test";
 * register(t);
 * shardedCounterTest.register(t, "apiKeys/shardedCounter");
 * ```
 */
export function register(
  t: TestConvex<SchemaDefinition<GenericSchema, boolean>>,
  name: string = "apiKeys",
): void {
  t.registerComponent(name, schema, modules);
}

/** `{ register, schema, modules }`: the helper, the component schema and its modules. */
/* v8 ignore next -- declaration-only compatibility export; properties are tested above */
export default { register, schema, modules };
