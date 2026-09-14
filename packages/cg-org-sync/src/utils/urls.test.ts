import { describe, expect, it } from "vitest";
import { sameOriginPath } from "./urls.js";

const ORIGIN = "https://link.test";

describe("sameOriginPath", () => {
  it("keeps a plain path", () => {
    expect(sameOriginPath("/", ORIGIN)).toBe("/");
  });

  it("keeps the query, which is how the deep link survives a round trip", () => {
    expect(sameOriginPath("/?registry=org:us:ein&id=123456789", ORIGIN)).toBe(
      "/?registry=org:us:ein&id=123456789",
    );
  });

  it("drops a fragment, which never reaches a server anyway", () => {
    expect(sameOriginPath("/grid#row-3", ORIGIN)).toBe("/grid");
  });

  const elsewhere = [
    ["an absolute URL", "https://evil.test/steal"],
    ["a protocol-relative URL", "//evil.test/steal"],
    // The one a prefix check misses: this looks like a path, and the URL
    // parser folds the backslash into a slash, so it resolves off-origin.
    ["a backslash after the leading slash", "/\\evil.test"],
    ["a backslash pair", "/\\/evil.test"],
    ["another scheme entirely", "javascript:alert(1)"],
    ["a different port on the same host", "https://link.test:8443/"],
  ] as const;

  it.each(elsewhere)("refuses %s", (_label, requested) => {
    expect(sameOriginPath(requested, ORIGIN)).toBeUndefined();
  });

  it("refuses a string the URL parser cannot read at all", () => {
    expect(sameOriginPath("http://[", ORIGIN)).toBeUndefined();
  });
});
