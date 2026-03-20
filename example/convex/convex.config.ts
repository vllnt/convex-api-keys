import { defineApp } from "convex/server";
import apiKeys from "../../src/component/convex.config.js";

const app = defineApp();
app.use(apiKeys);
app.use(apiKeys, { name: "serviceKeys" });

export default app;
