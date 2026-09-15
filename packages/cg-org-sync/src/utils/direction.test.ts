import { describe, expect, it } from "vitest";
import type { SourceResolution } from "../types.js";
import { directionOf, syncTargets } from "./direction.js";

function source(overrides: Partial<SourceResolution> & { id: string }): SourceResolution {
  return {
    label: overrides.id,
    orgId: "org-1",
    connection: "connected",
    capabilities: { read: true, write: true },
    ...overrides,
  };
}

describe("directionOf", () => {
  it("is a push when the value came from the host", () => {
    expect(directionOf("portal", "portal")).toBe("push");
  });

  it("is a pull when the value came from another system", () => {
    expect(directionOf("funderhub", "portal")).toBe("pull");
  });

  it("is a push when there is no host", () => {
    // Standalone there is no page to pull anything into.
    expect(directionOf("funderhub", null)).toBe("push");
  });
});

describe("syncTargets", () => {
  it("never offers the source the value came from", () => {
    // It already holds it — offering it would record a change that changes nothing.
    const sources = [source({ id: "portal" }), source({ id: "funderhub" })];

    expect(syncTargets(sources, "portal", null).map((s) => s.id)).toEqual(["funderhub"]);
  });

  it("omits a source that holds no matching record", () => {
    // Nothing there to patch.
    const sources = [source({ id: "portal" }), source({ id: "funderhub", orgId: null })];

    expect(syncTargets(sources, "portal", null).map((s) => s.id)).toEqual([]);
  });

  it("omits a source that failed", () => {
    // Its column is in an error state and its id may not even have resolved.
    const sources = [source({ id: "portal" }), source({ id: "funderhub", error: "unreachable" })];

    expect(syncTargets(sources, "portal", null).map((s) => s.id)).toEqual([]);
  });

  it("omits a source that declares write: false", () => {
    // The criterion's teeth: a read-only system must never be offered, rather
    // than offered and refused after the click.
    const sources = [
      source({ id: "portal" }),
      source({ id: "funderhub", capabilities: { read: true, write: false } }),
    ];

    expect(syncTargets(sources, "portal", null).map((s) => s.id)).toEqual([]);
  });

  it("offers every other writable source on a push", () => {
    const sources = [
      source({ id: "portal" }),
      source({ id: "funderhub" }),
      source({ id: "temelio" }),
    ];

    expect(syncTargets(sources, "portal", "portal").map((s) => s.id)).toEqual([
      "funderhub",
      "temelio",
    ]);
  });

  it("offers only the host on a pull", () => {
    // A pull goes into the page you are on and nowhere else.
    const sources = [
      source({ id: "portal" }),
      source({ id: "funderhub" }),
      source({ id: "temelio" }),
    ];

    expect(syncTargets(sources, "funderhub", "portal").map((s) => s.id)).toEqual(["portal"]);
  });

  it("offers nothing on a pull when the host itself is not a usable target", () => {
    // Falling back to some other system would silently push data somewhere
    // nobody asked for.
    const erroredHost = [
      source({ id: "portal", error: "unreachable" }),
      source({ id: "funderhub" }),
    ];

    expect(syncTargets(erroredHost, "funderhub", "portal")).toEqual([]);

    const readOnlyHost = [
      source({ id: "portal", capabilities: { read: true, write: false } }),
      source({ id: "funderhub" }),
    ];

    expect(syncTargets(readOnlyHost, "funderhub", "portal")).toEqual([]);
  });

  it("treats an unknown host as no host", () => {
    // An unrecognised `?host=` must not be able to narrow or redirect where a
    // change goes — it behaves like standalone.
    const sources = [
      source({ id: "portal" }),
      source({ id: "funderhub" }),
      source({ id: "temelio" }),
    ];

    expect(syncTargets(sources, "portal", "nonexistent").map((s) => s.id)).toEqual([
      "funderhub",
      "temelio",
    ]);
  });
});
