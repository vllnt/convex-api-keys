/// <reference types="vite/client" />
import type { TestConvex } from "convex-test";
import type { GenericSchema, SchemaDefinition } from "convex/server";
import schema from "./component/schema.js";

/* v8 ignore next -- Vite rewrites import.meta.glob into a declaration-only module map */
const modules = import.meta.glob("./component/**/*.ts");

export function register(
  t: TestConvex<SchemaDefinition<GenericSchema, boolean>>,
  name: string = "apiKeys",
): void {
  t.registerComponent(name, schema, modules);
}

/* v8 ignore next -- declaration-only compatibility export; properties are tested above */
export default { register, schema, modules };
