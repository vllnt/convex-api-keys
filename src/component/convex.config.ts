import { defineComponent } from "convex/server";
import shardedCounter from "@convex-dev/sharded-counter/convex.config.js";

/** The API keys component definition. Mount it with `app.use(apiKeys)` in `convex/convex.config.ts`. */
const component = defineComponent("apiKeys");

component.use(shardedCounter);

export default component;
