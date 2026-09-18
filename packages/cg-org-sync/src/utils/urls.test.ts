import { describe, expect, it } from "vitest";
import { originIfAllowed, parseOrigin, parseOriginList, sameOriginPath } from "./urls.js";

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

describe("parseOrigin", () => {
  it("normalizes a URL to its origin", () => {
    expect(parseOrigin("https://portal.test:443/embed/?x=1")).toBe("https://portal.test");
    expect(parseOrigin("http://localhost:5173")).toBe("http://localhost:5173");
  });

  const notAbsolute = [
    ["undefined", undefined],
    ["null", null],
    ["an empty string", ""],
    ["a string the URL parser cannot read at all", "not a url"],
    ["a bare path, with no base to resolve it against", "/orgs/1"],
  ] as const;

  it.each(notAbsolute)("is undefined for %s", (_label, value) => {
    expect(parseOrigin(value)).toBeUndefined();
  });

  const noOriginOfItsOwn = [
    ["a data URL", "data:text/html,hi"],
    ["a file URL", "file:///tmp/x"],
  ] as const;

  it.each(noOriginOfItsOwn)(
    'is undefined for %s, which the parser reports as the string "null"',
    (_label, value) => {
      expect(parseOrigin(value)).toBeUndefined();
    },
  );
});

describe("parseOriginList", () => {
  it("splits a comma-separated list and normalizes each entry to an origin", () => {
    expect(parseOriginList("http://localhost:5173, http://localhost:5174")).toEqual([
      "http://localhost:5173",
      "http://localhost:5174",
    ]);

    expect(parseOriginList("https://portal.test:443/embed/")).toEqual(["https://portal.test"]);
  });

  it("drops blank and unparseable entries rather than failing the whole list", () => {
    expect(parseOriginList("http://localhost:5173, , not a url, ,http://localhost:5174")).toEqual([
      "http://localhost:5173",
      "http://localhost:5174",
    ]);
  });

  it("is empty for an unset or empty variable", () => {
    expect(parseOriginList(undefined)).toEqual([]);
    expect(parseOriginList("")).toEqual([]);
  });

  it("de-duplicates entries that normalize to the same origin", () => {
    expect(parseOriginList("http://localhost:5173, http://localhost:5173/")).toEqual([
      "http://localhost:5173",
    ]);
  });
});

describe("originIfAllowed", () => {
  const ALLOWED = ["http://localhost:5173", "http://localhost:5174"];

  it("returns the normalized origin when it is on the list", () => {
    expect(originIfAllowed("http://localhost:5173/", ["http://localhost:5173"])).toBe(
      "http://localhost:5173",
    );
  });

  it("refuses an origin that is not on the list", () => {
    expect(originIfAllowed("http://evil.test", ALLOWED)).toBeUndefined();
  });

  const unusable = [
    ["null", null],
    ["undefined", undefined],
    ["an empty string", ""],
    ["a string the URL parser cannot read at all", "not a url"],
  ] as const;

  it.each(unusable)("refuses %s", (_label, requested) => {
    expect(originIfAllowed(requested, ALLOWED)).toBeUndefined();
  });

  it("refuses everything when the allow-list is empty", () => {
    expect(originIfAllowed("http://localhost:5173", [])).toBeUndefined();
  });

  it("compares after parsing, not by string prefix", () => {
    expect(originIfAllowed("http://localhost:5173.evil.test", ALLOWED)).toBeUndefined();
  });
});
