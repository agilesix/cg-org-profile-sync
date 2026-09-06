import { describe, expect, it } from "vitest";
import protocolOrgs from "./__fixtures__/protocol-orgs.json" with { type: "json" };
import { OrganizationBaseSchema } from "./zod/models.js";

/**
 * The schemas are hand-written, so something has to tie them back to the spec.
 *
 * Rather than diff our shapes against the emitted JSON Schemas — which wrap
 * nearly every field in `allOf`, so a structural comparison fails on shape
 * rather than meaning — this checks behaviour: every record the protocol
 * publishes must parse, and a corpus of records that break a documented rule
 * must not.
 */
describe("OrganizationBaseSchema against the protocol's own fixtures", () => {
  it("has fixtures to check", () => {
    expect(protocolOrgs.length).toBeGreaterThan(0);
  });

  it.each(protocolOrgs.map((org) => [org.name, org] as const))("accepts %s", (_name, org) => {
    const result = OrganizationBaseSchema.safeParse(org);

    expect(result.error?.issues ?? []).toEqual([]);
    expect(result.success).toBe(true);
  });
});

describe("OrganizationBaseSchema rejects records that break a documented rule", () => {
  const valid = protocolOrgs[0]!;

  const invalid: Array<[string, Record<string, unknown>]> = [
    ["no id", omit(valid, "id")],
    ["no name", omit(valid, "name")],
    ["an id that is not a UUID", { ...valid, id: "not-a-uuid" }],
    ["a year that is not four digits", { ...valid, yearFounded: "24" }],
    ["an EIN with a hyphen, which should be stripped first", withEin(valid, "12-3456789")],
    ["a UEI containing O, which the alphabet excludes", withUei(valid, "ABO123456789")],
    ["a PCS code in the wrong format", { ...valid, orgType: { ...pcs(valid), code: "eo000000" } }],
    ["a PCS term in the wrong class", { ...valid, orgType: { ...pcs(valid), class: "Subjects" } }],
    ["an email that is not an address", { ...valid, emails: { primary: "info at example.com" } }],
    [
      "a phone country code with no plus",
      { ...valid, phones: { primary: { countryCode: "1", number: "555-0100" } } },
    ],
    ["an address with no city", { ...valid, addresses: { primary: { street1: "1 Main St" } } }],
    ["a website that is not a URL", { ...valid, socials: { website: "example dot com" } }],
  ];

  it.each(invalid)("rejects %s", (_label, org) => {
    expect(OrganizationBaseSchema.safeParse(org).success).toBe(false);
  });
});

function omit(org: Record<string, unknown>, key: string) {
  const copy = { ...org };
  delete copy[key];
  return copy;
}

function pcs(org: Record<string, unknown>) {
  return org.orgType as Record<string, unknown>;
}

function withEin(org: Record<string, unknown>, id: string) {
  return { ...org, identifiers: { "org:us:ein": { registry: { code: "org:us:ein" }, id } } };
}

function withUei(org: Record<string, unknown>, id: string) {
  return { ...org, identifiers: { "org:us:uei": { registry: { code: "org:us:uei" }, id } } };
}
