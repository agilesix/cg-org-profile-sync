import { describe, expect, it } from "vitest";
import type { Organization } from "../schemas/index.js";
import type { FieldChange, JsonObject } from "../types.js";
import {
  buildMergePatch,
  compareProfiles,
  DEMO_FIELDS,
  getAtPath,
  sameJsonValue,
} from "./compare.js";
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

  it("agrees on every field when a single source is compared against nothing", () => {
    const portal = {
      name: "Riverside Community Health Center",
      socials: { website: "https://riversidechc.test" },
      addresses: { primary: { street1: "123 Main St", city: "Riverside" } },
    } as Organization;

    const rows = compareProfiles({ portal });
    const heldPaths = new Set(["name", "socials.website", "addresses.primary"]);

    // Every row is agree with a single source, regardless of which fields
    // DEMO_FIELDS carries — derived off it rather than a fixed-length array so
    // adding a field to the demo doesn't also break this fixture's assertion.
    expect(rows.map((row) => row.status)).toEqual(DEMO_FIELDS.map(() => "agree"));
    expect(rows.map((row) => row.distinctCount)).toEqual(
      DEMO_FIELDS.map((field) => (heldPaths.has(field.path) ? 1 : 0)),
    );
  });

  it("agrees on a field held by two sources and missing at a third", () => {
    // #1190-T6: a field two systems hold and a third simply has no record of
    // must read as agree, not as a disagreement the absent source never made.
    const portal = { mission: "Connect veterans to the benefits they've earned." } as Organization;
    const funderhub = {
      mission: "Connect veterans to the benefits they've earned.",
    } as Organization;
    const temelio = {} as Organization;

    const [missionRow] = compareProfiles({ portal, funderhub, temelio }, [
      { path: "mission", label: "Mission" },
    ]);

    expect(missionRow?.values).toEqual({
      portal: "Connect veterans to the benefits they've earned.",
      funderhub: "Connect veterans to the benefits they've earned.",
    });

    // Not merely `undefined` under that key: `toEqual` reads an undefined
    // property and an absent one as the same thing, and the widget renders a
    // cell for every key it finds.
    expect(missionRow?.values).not.toHaveProperty("temelio");
    expect(missionRow?.distinctCount).toBe(1);
    expect(missionRow?.status).toBe("agree");
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

  it("sorts keys at every depth, not just the top level of the object", () => {
    const portal = {
      addresses: {
        primary: { city: "Riverside", extra: { a: "1", b: "2" } },
      },
    } as unknown as Organization;
    const funderhub = {
      addresses: {
        primary: { extra: { b: "2", a: "1" }, city: "Riverside" },
      },
    } as unknown as Organization;

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

    expect(buildMergePatch([{ path: "addresses.primary", value: address }])).toEqual({
      addresses: { primary: { street1: "600 B Street", street2: "Suite 300" } },
    });
  });

  it("returns a flat body for a single-segment path", () => {
    expect(buildMergePatch([{ path: "name", value: "Agile Six Applications, Inc." }])).toEqual({
      name: "Agile Six Applications, Inc.",
    });
  });

  it("wraps a null value into an RFC 7396 deletion at the leaf", () => {
    expect(buildMergePatch([{ path: "socials.website", value: null }])).toEqual({
      socials: { website: null },
    });
  });

  it("keeps a path segment holding a colon as a single key", () => {
    expect(buildMergePatch([{ path: "identifiers.org:us:ein.id", value: "123456789" }])).toEqual({
      identifiers: { "org:us:ein": { id: "123456789" } },
    });
  });

  it("round-trips through applyMergePatch, merging rather than replacing the wrapper object", () => {
    const profile = {
      addresses: { primary: { street1: "600 B Street", street2: "Suite 210" } },
    } as JsonObject;

    const patch = buildMergePatch([{ path: "addresses.primary", value: { street2: "Suite 300" } }]);

    expect(applyMergePatch(profile, patch)).toEqual({
      addresses: { primary: { street1: "600 B Street", street2: "Suite 300" } },
    });
  });

  it("deletes the field for real when the null body is applied", () => {
    const profile = {
      name: "Agile Six Applications, Inc.",
      socials: { website: "https://agile6.com", linkedin: "https://linkedin.test/agilesix" },
    } as JsonObject;

    const patch = buildMergePatch([{ path: "socials.website", value: null }]);

    expect(applyMergePatch(profile, patch)).toEqual({
      name: "Agile Six Applications, Inc.",
      socials: { linkedin: "https://linkedin.test/agilesix" },
    });
  });

  it("merges several changes under the same parent into one object", () => {
    const changes: FieldChange[] = [
      { path: "socials.website", value: "https://agile6.com" },
      { path: "socials.linkedin", value: "https://linkedin.test/agilesix" },
    ];

    expect(buildMergePatch(changes)).toEqual({
      socials: {
        website: "https://agile6.com",
        linkedin: "https://linkedin.test/agilesix",
      },
    });
  });

  it("lands changes under different parents side by side", () => {
    const address = { street1: "600 B Street", street2: "Suite 300" };
    const changes: FieldChange[] = [
      { path: "name", value: "Agile Six Applications, Inc." },
      { path: "addresses.primary", value: address },
    ];

    expect(buildMergePatch(changes)).toEqual({
      name: "Agile Six Applications, Inc.",
      addresses: { primary: address },
    });
  });

  it("still clears a field with null when it is one of several changes", () => {
    const changes: FieldChange[] = [
      { path: "name", value: "Agile Six Applications, Inc." },
      { path: "socials.website", value: null },
    ];

    expect(buildMergePatch(changes)).toEqual({
      name: "Agile Six Applications, Inc.",
      socials: { website: null },
    });
  });

  it("rejects a duplicate path", () => {
    const changes: FieldChange[] = [
      { path: "name", value: "Agile Six Applications, Inc." },
      { path: "name", value: "Something Else, Inc." },
    ];

    expect(() => buildMergePatch(changes)).toThrow(/duplicate/i);
  });

  it("rejects a path that is a prefix of another, in either order", () => {
    const parentFirst: FieldChange[] = [
      { path: "socials", value: { website: "https://agile6.com" } },
      { path: "socials.website", value: "https://agile6.com" },
    ];
    const childFirst: FieldChange[] = [
      { path: "socials.website", value: "https://agile6.com" },
      { path: "socials", value: { website: "https://agile6.com" } },
    ];

    expect(() => buildMergePatch(parentFirst)).toThrow(/prefix|overlap/i);
    expect(() => buildMergePatch(childFirst)).toThrow(/prefix|overlap/i);
  });

  it("does not treat a path as a prefix unless the overlap lands on a segment boundary", () => {
    const changes: FieldChange[] = [
      { path: "soc", value: "not a real field" },
      { path: "socials", value: { website: "https://agile6.com" } },
    ];

    expect(buildMergePatch(changes)).toEqual({
      soc: "not a real field",
      socials: { website: "https://agile6.com" },
    });
  });

  it("builds one body with three roots over the three fields #1190-T6 adds", () => {
    const changes: FieldChange[] = [
      { path: "mission", value: "Connect veterans to the benefits they've earned." },
      { path: "emails.primary", value: "info@riversidechc.test" },
      { path: "phones.primary.number", value: "555-0100" },
    ];

    const body = buildMergePatch(changes);

    expect(Object.keys(body)).toHaveLength(3);
    expect(body).toEqual({
      mission: "Connect veterans to the benefits they've earned.",
      emails: { primary: "info@riversidechc.test" },
      phones: { primary: { number: "555-0100" } },
    });
  });
});

describe("sameJsonValue", () => {
  it("treats equal primitives and objects as the same value", () => {
    expect(sameJsonValue("a", "a")).toBe(true);
    expect(sameJsonValue({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it("treats different values as different", () => {
    expect(sameJsonValue("a", "b")).toBe(false);
    expect(sameJsonValue({ a: 1 }, { a: 2 })).toBe(false);
  });

  it("treats a cleared field and an absent one as the same value", () => {
    // This is the case that mattered: a merge patch clears a field by setting
    // it to `null`, and `applyMergePatch` honours that by deleting the key
    // rather than storing `null` — so a target that clears a field correctly
    // comes back with the key absent, i.e. `undefined`, not `null`. Reading
    // this the other way — that a store snapshot must literally carry `null`
    // to count as "cleared" — would report a successful clear as a failure.
    expect(sameJsonValue(undefined, null)).toBe(true);
    expect(sameJsonValue(null, undefined)).toBe(true);
    expect(sameJsonValue(undefined, undefined)).toBe(true);
    expect(sameJsonValue(null, null)).toBe(true);
  });

  it("still tells a real value apart from an absent or cleared one", () => {
    expect(sameJsonValue("https://agile6.com", undefined)).toBe(false);
    expect(sameJsonValue("https://agile6.com", null)).toBe(false);
    expect(sameJsonValue(undefined, "https://agile6.com")).toBe(false);
  });

  it("ignores key order when comparing objects", () => {
    const address1 = { street1: "600 B Street", city: "San Diego" };
    const address2 = { city: "San Diego", street1: "600 B Street" };

    expect(sameJsonValue(address1, address2)).toBe(true);
  });
});
