import { defineComponent } from "convex/server";
import shardedCounter from "@convex-dev/sharded-counter/convex.config.js";

const component = defineComponent("apiKeys");

component.use(shardedCounter);

export default component;
