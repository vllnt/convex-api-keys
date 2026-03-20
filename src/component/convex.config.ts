import { defineComponent } from "convex/server";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";
import shardedCounter from "@convex-dev/sharded-counter/convex.config.js";
import aggregate from "@convex-dev/aggregate/convex.config.js";
import crons from "@convex-dev/crons/convex.config.js";

const component = defineComponent("apiKeys");

component.use(rateLimiter);
component.use(shardedCounter);
component.use(aggregate, { name: "usageAggregate" });
component.use(crons);

export default component;
