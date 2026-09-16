import { describe, expect, it } from "vitest";
import { OrganizationBaseSchema } from "@cg-link/org-sync/schemas";
import type { Organization } from "@cg-link/org-sync/schemas";
import { TEMELIO_SEED } from "@cg-link/seed";
import { AGILE_SIX_TEMELIO_RECORD } from "./fixture.js";
import {
  DROPPED_FIELDS,
  MAPPED_FIELDS,
  TEMELIO_SYSTEM_REGISTRY,
  toMetadataPatch,
  toOrganization,
} from "./mapping.js";
import { TemelioRecordSchema } from "./records.js";
import type { TemelioAddress, TemelioRecord } from "./records.js";

/** An address with every field empty, so a filled one can be told apart from it. */
const emptyAddress: TemelioAddress = {
  address1: null,
  address2: null,
  city: null,
  state: null,
  zipcode: null,
  country: null,
};

/** A complete headquarters, since `addresses.otherAddresses` needs a primary to hang from. */
const headquarters: TemelioAddress = {
  address1: "600 B Street",
  address2: null,
  city: "San Diego",
  state: "CA",
  zipcode: "92101",
  country: "US",
};

/** A record with every optional field unset, for hand-built cases that only need a few. */
const emptyRecord: TemelioRecord = {
  nonprofitId: "412fd95e-f4aa-41c0-96da-5822254f280a",
  legalName: "Test Org",
  ein: null,
  mission: null,
  foundingDate: null,
  website: null,
  facebook: null,
  twitter: null,
  instagram: null,
  linkedIn: null,
  orgEmail: null,
  phoneNumber: null,
  dba: null,
  vision: null,
  description: null,
  guidestarProfile: null,
  legalStatus: null,
  irsRecipientStatus: null,
  headquarters: null,
  mailingAddress: null,
};

describe("toOrganization", () => {
  it("matches the CommonGrants-shape seed for the same vendor record", () => {
    const record = TemelioRecordSchema.parse(AGILE_SIX_TEMELIO_RECORD);

    expect(toOrganization(record)).toEqual(TEMELIO_SEED);
  });

  it("parses under the shared organization schema", () => {
    const record = TemelioRecordSchema.parse(AGILE_SIX_TEMELIO_RECORD);
    const result = OrganizationBaseSchema.safeParse(toOrganization(record));

    expect(result.error?.issues ?? []).toEqual([]);
    expect(result.success).toBe(true);
  });

  it("carries the nonprofit id as both the record id and the system identifier", () => {
    const record = TemelioRecordSchema.parse(AGILE_SIX_TEMELIO_RECORD);
    const org = toOrganization(record);

    expect(org.id).toBe(record.nonprofitId);
    expect(org.identifiers?.systemId?.registry?.code).toBe(TEMELIO_SYSTEM_REGISTRY);
    expect(org.identifiers?.systemId?.id).toBe(record.nonprofitId);
    expect(org.identifiers?.["org:us:ein"]?.id).toBe(record.ein);
  });

  it("treats an empty string the same as a null field", () => {
    const withEmptyStrings: TemelioRecord = {
      ...emptyRecord,
      ein: "",
      mission: "",
      foundingDate: "",
      website: "",
      facebook: "",
      twitter: "",
      instagram: "",
      linkedIn: "",
      orgEmail: "",
      phoneNumber: "",
      dba: "",
      vision: "",
      description: "",
      guidestarProfile: "",
      legalStatus: "",
      irsRecipientStatus: "",
    };

    expect(toOrganization(withEmptyStrings)).toEqual(toOrganization(emptyRecord));
    expect(toOrganization(emptyRecord).mission).toBeUndefined();
  });

  it("produces no ein identifier when the record has none", () => {
    const org = toOrganization({ ...emptyRecord, ein: null });

    expect(org.identifiers?.["org:us:ein"]).toBeUndefined();
  });

  it("reduces a founding date to its calendar year", () => {
    expect(toOrganization({ ...emptyRecord, foundingDate: null }).yearFounded).toBeUndefined();
    expect(toOrganization({ ...emptyRecord, foundingDate: "2015-01-01" }).yearFounded).toBe("2015");
  });

  it("leaves otherAddresses unset when the mailing address is empty", () => {
    expect(
      toOrganization({ ...emptyRecord, headquarters, mailingAddress: null }).addresses
        ?.otherAddresses,
    ).toBeUndefined();
    expect(
      toOrganization({ ...emptyRecord, headquarters, mailingAddress: emptyAddress }).addresses
        ?.otherAddresses,
    ).toBeUndefined();
  });

  it("carries a filled mailing address as the mailing entry in otherAddresses", () => {
    const mailingAddress: TemelioAddress = {
      address1: "PO Box 1",
      address2: null,
      city: "San Diego",
      state: "CA",
      zipcode: "92101",
      country: "US",
    };

    const org = toOrganization({ ...emptyRecord, headquarters, mailingAddress });

    expect(org.addresses?.otherAddresses?.mailing).toEqual({
      street1: "PO Box 1",
      city: "San Diego",
      stateOrProvince: "CA",
      country: "US",
      postalCode: "92101",
    });
  });

  it("drops an address the protocol cannot represent rather than half-filling one", () => {
    // CommonGrants requires a street, city, region, country and postal code
    // together; Temelio requires none of them. There is no honest way to turn
    // a partial vendor address into a valid one, and a mailing address has
    // nowhere to live without a primary to hang it from.
    const partial: TemelioAddress = { ...emptyAddress, address1: "600 B Street" };

    expect(toOrganization({ ...emptyRecord, headquarters: partial }).addresses).toBeUndefined();
    expect(
      toOrganization({ ...emptyRecord, mailingAddress: headquarters }).addresses,
    ).toBeUndefined();
  });

  it("carries the fields with no CommonGrants counterpart as custom fields", () => {
    const org = toOrganization({
      ...emptyRecord,
      dba: "A6",
      vision: "",
      description: "Digital services",
      guidestarProfile: "https://guidestar.example/agile-six",
      legalStatus: "501(c)3",
      irsRecipientStatus: null,
    });

    expect(org.customFields).toEqual({
      dba: { name: "dba", fieldType: "string", value: "A6" },
      description: { name: "description", fieldType: "string", value: "Digital services" },
      guidestarProfile: {
        name: "guidestarProfile",
        fieldType: "string",
        value: "https://guidestar.example/agile-six",
      },
      legalStatus: { name: "legalStatus", fieldType: "string", value: "501(c)3" },
    });
  });
});

describe("MAPPED_FIELDS and DROPPED_FIELDS", () => {
  it("classify every key the fixture carries, without overlap", () => {
    const fixtureKeys = new Set(Object.keys(AGILE_SIX_TEMELIO_RECORD));
    const mapped = new Set(MAPPED_FIELDS);
    const dropped = new Set(DROPPED_FIELDS);
    const overlap = [...mapped].filter((key) => dropped.has(key));

    expect(mapped.size).toBeGreaterThan(0);
    expect(dropped.size).toBeGreaterThan(0);
    expect(overlap).toEqual([]);
    expect(new Set([...mapped, ...dropped])).toEqual(fixtureKeys);
  });
});

/** The seed with a different EIN, however it happens to be punctuated. */
function withEin(org: Organization, id: string): Organization {
  return {
    ...org,
    identifiers: { ...org.identifiers, "org:us:ein": { registry: { code: "org:us:ein" }, id } },
  };
}

describe("toMetadataPatch", () => {
  it("reports only the field that changed", () => {
    const after: Organization = { ...TEMELIO_SEED, socials: { website: "https://agile6.com" } };

    expect(toMetadataPatch(TEMELIO_SEED, after)).toEqual({ website: "https://agile6.com" });
  });

  it("sends the whole headquarters object when only the suite number changes", () => {
    const after: Organization = {
      ...TEMELIO_SEED,
      addresses: {
        primary: {
          street1: "600 B Street",
          street2: "Suite 300",
          city: "San Diego",
          stateOrProvince: "CA",
          country: "US",
          postalCode: "92101",
        },
      },
    };

    expect(toMetadataPatch(TEMELIO_SEED, after).headquarters).toEqual({
      address1: "600 B Street",
      address2: "Suite 300",
      city: "San Diego",
      state: "CA",
      zipcode: "92101",
      country: "US",
    });
  });

  it("clears a removed field to an empty string rather than null", () => {
    const after: Organization = { ...TEMELIO_SEED };
    delete after.mission;

    expect(toMetadataPatch(TEMELIO_SEED, after)).toEqual({ mission: "" });
  });

  it("ignores a changed name, since a funder cannot rename its grantee", () => {
    const after: Organization = { ...TEMELIO_SEED, name: "Something Else, Inc." };

    expect(toMetadataPatch(TEMELIO_SEED, after)).toEqual({});
  });

  it("is empty when nothing changed", () => {
    expect(toMetadataPatch(TEMELIO_SEED, TEMELIO_SEED)).toEqual({});
  });

  it("writes an EIN as the bare digits Temelio indexes it by", () => {
    const after = withEin(TEMELIO_SEED, "99-8877665");

    expect(toMetadataPatch(TEMELIO_SEED, after)).toEqual({ ein: "998877665" });
  });

  it("reports no change when the same EIN is merely punctuated differently", () => {
    // The same nine digits, hyphenated the way a human writes them. Comparing
    // the raw strings would send a write on every sync and, worse, store a
    // value Temelio's digits-only index would then fail to match.
    const after = withEin(TEMELIO_SEED, "12-3456789");

    expect(toMetadataPatch(TEMELIO_SEED, after)).toEqual({});
  });

  it("never clears the EIN, which is what the organization is matched by", () => {
    const withoutEin: Organization = { ...TEMELIO_SEED, identifiers: { systemId: {} } };

    expect(toMetadataPatch(TEMELIO_SEED, withoutEin)).toEqual({});
    expect(toMetadataPatch(TEMELIO_SEED, withEin(TEMELIO_SEED, "not-an-ein"))).toEqual({});
  });
});
