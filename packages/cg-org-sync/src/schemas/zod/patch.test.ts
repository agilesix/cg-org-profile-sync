import { describe, expect, it } from "vitest";
import { OrgPatchDataSchema } from "./patch.js";
import { OrgProfileWritableSchema } from "./models.js";

describe("OrgPatchDataSchema", () => {
  it("covers every writable field and nothing else", () => {
    expect(Object.keys(OrgPatchDataSchema.def.shape).sort()).toEqual(
      Object.keys(OrgProfileWritableSchema.def.shape).sort(),
    );
  });

  it("accepts an empty patch, which changes nothing", () => {
    expect(OrgPatchDataSchema.parse({})).toEqual({});
  });

  it("makes a required base field optional", () => {
    // `name` is required on the profile, but a patch that omits it is valid.
    expect(OrgProfileWritableSchema.safeParse({}).success).toBe(false);
    expect(OrgPatchDataSchema.safeParse({}).success).toBe(true);
  });

  it("keeps an omitted key out of the parsed result", () => {
    const parsed = OrgPatchDataSchema.parse({ mission: "Better public services" });

    expect("mission" in parsed).toBe(true);
    expect("name" in parsed).toBe(false);
  });

  it("keeps an explicit null, so clearing a field survives parsing", () => {
    const parsed = OrgPatchDataSchema.parse({ mission: null });

    expect("mission" in parsed).toBe(true);
    expect(parsed.mission).toBeNull();
  });

  it("allows null inside a nested object", () => {
    const parsed = OrgPatchDataSchema.parse({ socials: { website: null } });

    expect(parsed.socials).toEqual({ website: null });
  });

  it("allows a partial nested object without its required members", () => {
    // `addresses.primary` is required on the profile; a patch may touch one
    // field of it and leave the rest alone.
    const parsed = OrgPatchDataSchema.parse({
      addresses: { primary: { postalCode: "92101" } },
    });

    expect(parsed.addresses).toEqual({ primary: { postalCode: "92101" } });
  });

  it("still enforces the format of the values it is given", () => {
    expect(OrgPatchDataSchema.safeParse({ yearFounded: "24" }).success).toBe(false);
    expect(OrgPatchDataSchema.safeParse({ yearFounded: "2015" }).success).toBe(true);
    expect(OrgPatchDataSchema.safeParse({ emails: { primary: "nope" } }).success).toBe(false);
  });

  it("rejects a misspelled field rather than ignoring it", () => {
    const result = OrgPatchDataSchema.safeParse({ mision: "typo" });

    expect(result.success).toBe(false);
  });

  it("lets a record entry be deleted with null", () => {
    const parsed = OrgPatchDataSchema.parse({ customFields: { legacyCode: null } });

    expect(parsed.customFields).toEqual({ legacyCode: null });
  });
});
