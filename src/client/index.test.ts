import type {
  FunctionReference,
  GenericActionCtx,
  GenericDataModel,
  GenericMutationCtx,
  GenericQueryCtx,
} from "convex/server";
import { expectTypeOf, test } from "vitest";
import type { RunMutationCtx, RunQueryCtx } from "./index.js";

// Checked by `pnpm typecheck:ci`: the ApiKeys methods must accept the `ctx` of
// every Convex function that can run them, including actions and HTTP actions.
test("RunMutationCtx accepts mutation and action contexts", () => {
  expectTypeOf<
    GenericMutationCtx<GenericDataModel>
  >().toExtend<RunMutationCtx>();
  expectTypeOf<GenericActionCtx<GenericDataModel>>().toExtend<RunMutationCtx>();
  expectTypeOf<
    GenericQueryCtx<GenericDataModel>
  >().not.toExtend<RunMutationCtx>();
});

test("RunQueryCtx accepts query, mutation and action contexts", () => {
  expectTypeOf<GenericQueryCtx<GenericDataModel>>().toExtend<RunQueryCtx>();
  expectTypeOf<GenericMutationCtx<GenericDataModel>>().toExtend<RunQueryCtx>();
  expectTypeOf<GenericActionCtx<GenericDataModel>>().toExtend<RunQueryCtx>();
});

test("RunMutationCtx and RunQueryCtx run public and internal references", () => {
  type Ref<Type extends "mutation" | "query", Visibility extends "public" | "internal"> = FunctionReference<
    Type,
    Visibility,
    Record<string, never>,
    null
  >;
  const call = (
    ctx: RunMutationCtx & RunQueryCtx,
    refs: {
      publicMutation: Ref<"mutation", "public">;
      internalMutation: Ref<"mutation", "internal">;
      publicQuery: Ref<"query", "public">;
      internalQuery: Ref<"query", "internal">;
    },
  ) => [
    ctx.runMutation(refs.publicMutation, {}),
    ctx.runMutation(refs.internalMutation, {}),
    ctx.runQuery(refs.publicQuery, {}),
    ctx.runQuery(refs.internalQuery, {}),
  ];
  expectTypeOf(call).toBeFunction();
});
