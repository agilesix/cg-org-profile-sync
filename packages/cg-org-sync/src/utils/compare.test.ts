import { describe, expect, it } from "vitest";
import type { Organization } from "../schemas/index.js";
import type { JsonObject } from "../types.js";
import { buildMergePatch, compareProfiles, DEMO_FIELDS, getAtPath } from "./compare.js";
import { applyMergePatch } from "./merge-patch.js";

describe("compareProfiles", () => {
  it("returns one FieldComparison per field, in order, carrying its path and label", () => {
    const portal = { name: "Riverside Community Health Center" } as Organization;
    const funderhub = { name: "Riverside Community Health Center" } as Organization;

    const result = compareProfiles({ portal, funderhub });

    expect(result.map((row) => ({ path: row.path, label: row.label }))).toEqual(
      DEMO_FIELDS.map((field) => ({ path: field.path, label: field.label })),
    );
  });

  it("keys values by source id, holding only the sources that hold the field", () => {
    const portal = { name: "Riverside Community Health Center" } as Organization;
    const funderhub = { name: "Riverside CHC" } as Organization;

    const [nameRow] = compareProfiles({ portal, funderhub }, [
      { path: "name", label: "Legal name" },
    ]);

    expect(nameRow?.values).toEqual({
      portal: "Riverside Community Health Center",
      funderhub: "Riverside CHC",
    });
  });

  it("does not crash and contributes no value when a source's profile is undefined", () => {
    const portal = { name: "Riverside Community Health Center" } as Organization;

    const [nameRow] = compareProfiles({ portal, funderhub: undefined }, [
      { path: "name", label: "Legal name" },
    ]);

    expect(nameRow?.values).toEqual({ portal: "Riverside Community Health Center" });
    expect(nameRow?.distinctCount).toBe(1);
    expect(nameRow?.status).toBe("agree");
  });

  it("treats an absent, null, or empty-string value as not held", () => {
    const portal = { name: "Riverside Community Health Center" } as Organization;
    const funderhub = { name: null } as unknown as Organization;
    const link = { name: "" } as Organization;

    const [nameRow] = compareProfiles({ portal, funderhub, link }, [
      { path: "name", label: "Legal name" },
    ]);

    expect(nameRow?.values).toEqual({ portal: "Riverside Community Health Center" });
    expect(nameRow?.distinctCount).toBe(1);
  });

  it("marks a field agree when every source that holds it has the same value", () => {
    const portal = { name: "Riverside Community Health Center" } as Organization;
    const funderhub = { name: "Riverside Community Health Center" } as Organization;

    const [nameRow] = compareProfiles({ portal, funderhub }, [
      { path: "name", label: "Legal name" },
    ]);

    expect(nameRow?.distinctCount).toBe(1);
    expect(nameRow?.status).toBe("agree");
  });

  it("marks a field differs when the sources that hold it disagree", () => {
    const portal = { name: "Riverside Community Health Center" } as Organization;
    const funderhub = { name: "Riverside CHC" } as Organization;

    const [nameRow] = compareProfiles({ portal, funderhub }, [
      { path: "name", label: "Legal name" },
    ]);

    expect(nameRow?.distinctCount).toBe(2);
    expect(nameRow?.status).toBe("differs");
  });

  it("marks a field agree when no source holds it", () => {
    const portal = {} as Organization;
    const funderhub = {} as Organization;

    const [nameRow] = compareProfiles({ portal, funderhub }, [
      { path: "name", label: "Legal name" },
    ]);

    expect(nameRow?.values).toEqual({});
    expect(nameRow?.distinctCount).toBe(0);
    expect(nameRow?.status).toBe("agree");
  });

  it("marks a field agree when structurally equal objects hold their keys in a different order", () => {
    const portal = {
      addresses: {
        primary: {
          street1: "123 Main St",
          city: "Riverside",
          stateOrProvince: "CA",
          postalCode: "92501",
        },
      },
    } as Organization;
    const funderhub = {
      addresses: {
        primary: {
          postalCode: "92501",
          stateOrProvince: "CA",
          city: "Riverside",
          street1: "123 Main St",
        },
      },
    } as Organization;

    const [addressRow] = compareProfiles({ portal, funderhub }, [
      { path: "addresses.primary", label: "Primary address" },
    ]);

    expect(addressRow?.distinctCount).toBe(1);
    expect(addressRow?.status).toBe("agree");
  });
});

describe("getAtPath", () => {
  it("reads a nested registry key without splitting on its own colon", () => {
    const org = { identifiers: { "org:us:ein": { id: "12-3456789" } } } as Organization;

    expect(getAtPath(org, "identifiers.org:us:ein.id")).toBe("12-3456789");
  });

  it("returns undefined for a path that runs off the end of the object", () => {
    const org = { name: "Riverside" } as Organization;

    expect(getAtPath(org, "addresses.primary.city")).toBeUndefined();
  });

  it("returns undefined for a path that runs through a scalar", () => {
    const org = { name: "Riverside" } as Organization;

    expect(getAtPath(org, "name.first")).toBeUndefined();
  });
});

describe("buildMergePatch", () => {
  it("wraps a nested path's value into an RFC 7396 body", () => {
    const address = { street1: "600 B Street", street2: "Suite 300" };

    expect(buildMergePatch("addresses.primary", address)).toEqual({
      addresses: { primary: { street1: "600 B Street", street2: "Suite 300" } },
    });
  });

  it("returns a flat body for a single-segment path", () => {
    expect(buildMergePatch("name", "Agile Six Applications, Inc.")).toEqual({
      name: "Agile Six Applications, Inc.",
    });
  });

  it("wraps a null value into an RFC 7396 deletion at the leaf", () => {
    expect(buildMergePatch("socials.website", null)).toEqual({
      socials: { website: null },
    });
  });

  it("keeps a path segment holding a colon as a single key", () => {
    expect(buildMergePatch("identifiers.org:us:ein.id", "123456789")).toEqual({
      identifiers: { "org:us:ein": { id: "123456789" } },
    });
  });

  it("round-trips through applyMergePatch, merging rather than replacing the wrapper object", () => {
    const profile = {
      addresses: { primary: { street1: "600 B Street", street2: "Suite 210" } },
    } as JsonObject;

    const patch = buildMergePatch("addresses.primary", { street2: "Suite 300" });

    expect(applyMergePatch(profile, patch)).toEqual({
      addresses: { primary: { street1: "600 B Street", street2: "Suite 300" } },
    });
  });
});
