import { expect, test, describe, vi } from "vitest";
import { createLogger } from "./log.js";

describe("createLogger", () => {
  test("info logs with scope prefix", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const log = createLogger("test");
    log.info("hello", { key: "value" });
    expect(spy).toHaveBeenCalledWith("[test]", "hello", { key: "value" });
    spy.mockRestore();
  });

  test("info logs without data", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const log = createLogger("test");
    log.info("hello");
    expect(spy).toHaveBeenCalledWith("[test]", "hello", "");
    spy.mockRestore();
  });

  test("warn logs with scope prefix", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = createLogger("test");
    log.warn("warning", { detail: 1 });
    expect(spy).toHaveBeenCalledWith("[test]", "warning", { detail: 1 });
    spy.mockRestore();
  });

  test("warn logs without data", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = createLogger("test");
    log.warn("warning");
    expect(spy).toHaveBeenCalledWith("[test]", "warning", "");
    spy.mockRestore();
  });

  test("error logs with scope prefix", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = createLogger("test");
    log.error("oops", { code: 500 });
    expect(spy).toHaveBeenCalledWith("[test]", "oops", { code: 500 });
    spy.mockRestore();
  });

  test("error logs without data", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = createLogger("test");
    log.error("oops");
    expect(spy).toHaveBeenCalledWith("[test]", "oops", "");
    spy.mockRestore();
  });
});
