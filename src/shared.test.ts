import { expect, test, describe } from "vitest";
import {
  parseKeyString,
  timingSafeEqual,
  sha256Hex,
  validateTag,
  validateTags,
  KEY_PREFIX_SEPARATOR,
} from "./shared.js";

describe("parseKeyString", () => {
  test("parses a valid secret key", () => {
    const result = parseKeyString("pre_secret_live_12345678_" + "a".repeat(64));
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.prefix).toBe("pre");
      expect(result.type).toBe("secret");
      expect(result.env).toBe("live");
      expect(result.lookupPrefix).toBe("12345678");
      expect(result.secret).toBe("a".repeat(64));
    }
  });

  test("parses a valid pub key", () => {
    const result = parseKeyString("pre_pub_test_12345678_" + "b".repeat(64));
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.type).toBe("pub");
    }
  });

  test("rejects wrong segment count", () => {
    expect(parseKeyString("too_few_parts").valid).toBe(false);
    expect(parseKeyString("a_b_c_d_e_f").valid).toBe(false);
  });

  test("rejects empty segment", () => {
    const result = parseKeyString("pre__live_12345678_" + "a".repeat(64));
    expect(result.valid).toBe(false);
  });

  test("rejects bad type", () => {
    const result = parseKeyString("pre_badtype_live_12345678_" + "a".repeat(64));
    expect(result.valid).toBe(false);
  });

  test("rejects wrong lookupPrefix length", () => {
    const result = parseKeyString("pre_secret_live_short_" + "a".repeat(64));
    expect(result.valid).toBe(false);
  });

  test("rejects wrong secret length", () => {
    const result = parseKeyString("pre_secret_live_12345678_tooshort");
    expect(result.valid).toBe(false);
  });
});

describe("timingSafeEqual", () => {
  test("returns true for equal strings", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
  });

  test("returns false for different strings same length", () => {
    expect(timingSafeEqual("abc", "abd")).toBe(false);
  });

  test("returns false for different length strings", () => {
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });

  test("returns true for empty strings", () => {
    expect(timingSafeEqual("", "")).toBe(true);
  });
});

describe("sha256Hex", () => {
  test("produces consistent 64-char hex output", async () => {
    const hash = await sha256Hex("hello");
    expect(hash).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(hash)).toBe(true);

    // Same input = same output
    const hash2 = await sha256Hex("hello");
    expect(hash2).toBe(hash);
  });

  test("different inputs produce different hashes", async () => {
    const h1 = await sha256Hex("hello");
    const h2 = await sha256Hex("world");
    expect(h1).not.toBe(h2);
  });
});

describe("validateTag", () => {
  test("accepts valid tags", () => {
    expect(() => validateTag("valid")).not.toThrow();
    expect(() => validateTag("valid-tag")).not.toThrow();
    expect(() => validateTag("v2")).not.toThrow();
    expect(() => validateTag("A")).not.toThrow();
  });

  test("rejects tags starting with hyphen", () => {
    expect(() => validateTag("-invalid")).toThrow("Invalid tag");
  });

  test("rejects tags with special chars", () => {
    expect(() => validateTag("no spaces")).toThrow("Invalid tag");
    expect(() => validateTag("no.dots")).toThrow("Invalid tag");
  });
});

describe("validateTags", () => {
  test("validates all tags in array", () => {
    expect(() => validateTags(["valid", "also-valid"])).not.toThrow();
  });

  test("throws on first invalid tag", () => {
    expect(() => validateTags(["valid", "-bad"])).toThrow("Invalid tag");
  });
});

describe("KEY_PREFIX_SEPARATOR", () => {
  test("is underscore", () => {
    expect(KEY_PREFIX_SEPARATOR).toBe("_");
  });
});
