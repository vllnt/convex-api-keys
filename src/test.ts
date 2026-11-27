/// <reference types="vite/client" />
import type { TestConvex } from "convex-test";
import type { GenericSchema, SchemaDefinition } from "convex/server";
import schema from "./component/schema.js";

/* v8 ignore next -- Vite rewrites import.meta.glob into a declaration-only module map */
const modules = import.meta.glob("./component/**/*.ts");

/**
 * Mount the component in a `convex-test` instance. Also register
 * `@convex-dev/sharded-counter/test` at `${name}/shardedCounter`.
 * @param t - The instance returned by `convexTest(schema, modules)`.
 * @param name - Mount name; default `"apiKeys"`.
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
