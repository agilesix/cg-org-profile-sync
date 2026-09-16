/**
 * The translation between Temelio's record and a CommonGrants `Organization`.
 *
 * Both directions live here because they have to agree: `toOrganization` is
 * what the widget compares, and `toMetadataPatch` is what a chosen value is
 * written back through. A field that maps one way and not the other would show
 * a disagreement nobody could then resolve.
 *
 * The write direction is a *diff*, not a replacement. Temelio's merge is
 * shallow — a body naming one key leaves the rest alone, but a sub-object sent
 * with one key blanks the rest of that object — so an address goes whole and
 * everything else goes only when it changed.
 */

import type { Address, Organization, OrgSocialLinks } from "@cg-link/org-sync/schemas";
import type { TemelioAddress, TemelioRecord } from "./records.js";

/** The registry code naming Temelio as the system that assigned an id. */
export const TEMELIO_SYSTEM_REGISTRY = "org:temelio:system";

/**
 * Vendor fields with no CommonGrants counterpart, carried as custom fields.
 *
 * These are profile facts somebody typed, so dropping them would lose data the
 * protocol simply has no name for. `customFields` is where the protocol puts
 * exactly that.
 */
const CUSTOM_FIELD_KEYS = [
  "dba",
  "vision",
  "description",
  "guidestarProfile",
  "legalStatus",
  "irsRecipientStatus",
] as const;

/** Every vendor key this mapping reads. */
export const MAPPED_FIELDS: readonly string[] = [
  "nonprofitId",
  "legalName",
  "ein",
  "mission",
  "foundingDate",
  "website",
  "facebook",
  "twitter",
  "instagram",
  "linkedIn",
  "headquarters",
  "mailingAddress",
  "orgEmail",
  "phoneNumber",
  ...CUSTOM_FIELD_KEYS,
];

/**
 * Every vendor key this mapping deliberately leaves behind.
 *
 * Funder-side bookkeeping rather than profile: what this foundation has paid
 * this grantee, which of its tags apply, who owns the relationship. It belongs
 * to the funder's copy, not to the organization, so a sync has no business
 * moving it between systems.
 *
 * Maintained by hand and pinned by a test against the fixture's own keys, so a
 * vendor field that appears and is neither mapped nor listed here fails the
 * suite rather than disappearing quietly.
 */
export const DROPPED_FIELDS: readonly string[] = [
  "foundationId",
  "organizationName",
  "entityType",
  "hasFiscalSponsor",
  "fiscalSponsor",

  // Temelio's own per-foundation custom fields, keyed by UUIDs the foundation
  // defined. Not to be confused with CommonGrants' `customFields`, which is
  // where this mapping puts the *named* vendor fields above.
  "customFields",

  "tags",
  "entityTags",
  "submissionTags",
  "statuses",
  "customStatuses",
  "coloredTags",
  "totalAwarded",
  "nextPaymentDate",
  "foundationPOC",
  "primaryContact",
  "submissionDetails",
  "additionalInfo",
  "ofacFlags",
  "sendEmail",
  "completedOnboarding",
  "completedOnboardingAt",
  "organizationLogo",
  "irsDeterminationLetter",
];

/** What a merge write sends: changed top-level keys, sub-objects whole. */
export type TemelioMetadataPatch = Record<string, string | TemelioAddress>;

/**
 * Read one vendor record as an organization profile.
 *
 * Absent and blank are the same thing on the way in — Temelio holds `null` on
 * a record nobody has edited and `""` on one that was edited and cleared, and
 * neither is a value the comparison should show.
 */
export function toOrganization(record: TemelioRecord): Organization {
  const org: Organization = {
    id: record.nonprofitId,

    // A record always has a name in practice; the empty string keeps the type
    // honest for one that somehow does not, rather than throwing here and
    // taking down a whole list for one bad row.
    name: text(record.legalName) ?? "",
    identifiers: {
      systemId: {
        registry: { code: TEMELIO_SYSTEM_REGISTRY },
        id: record.nonprofitId,
      },
    },
  };

  const ein = employerTaxId(record.ein);

  if (ein && org.identifiers) {
    org.identifiers["org:us:ein"] = {
      registry: {
        code: "org:us:ein",
        url: "https://commongrants.org/registries/org-us-ein",
      },
      id: ein,
    };
  }

  const mission = text(record.mission);

  if (mission) {
    org.mission = mission;
  }

  const yearFounded = year(record.foundingDate);

  if (yearFounded) {
    org.yearFounded = yearFounded;
  }

  const primary = toAddress(record.headquarters);

  if (primary) {
    org.addresses = { primary };

    const mailing = toAddress(record.mailingAddress);

    if (mailing) {
      org.addresses.otherAddresses = { mailing };
    }
  }

  const email = text(record.orgEmail);

  if (email) {
    org.emails = { primary: email };
  }

  const phone = toPhone(record.phoneNumber);

  if (phone) {
    org.phones = { primary: phone };
  }

  const socials = toSocials(record);

  if (socials) {
    org.socials = socials;
  }

  const customFields = toCustomFields(record);

  if (customFields) {
    org.customFields = customFields;
  }

  return org;
}

/**
 * What to send Temelio so its record matches `after`.
 *
 * Only the keys that changed, because a merge write leaves everything it does
 * not name alone — which is how a vendor field this adapter has never heard of
 * survives a sync it was never part of.
 *
 * `name` is never included. A foundation cannot rename its grantee through
 * this route: Temelio accepts the field, answers 200, and stores nothing.
 * Sending it would turn a refusal into a silent one.
 */
export function toMetadataPatch(before: Organization, after: Organization): TemelioMetadataPatch {
  const from = writableFields(before);
  const to = writableFields(after);
  const patch: TemelioMetadataPatch = {};

  for (const key of Object.keys(to) as (keyof TemelioWritable)[]) {
    const wanted = to[key];
    const held = from[key];

    if (sameValue(held, wanted)) {
      continue;
    }

    if (key === "headquarters" || key === "mailingAddress") {
      // Whole object or nothing: Temelio's merge replaces a sub-object rather
      // than merging into it, so sending only the line that changed would
      // blank the rest of the address.
      patch[key] = (wanted as TemelioAddress | undefined) ?? EMPTY_ADDRESS;
      continue;
    }

    if (key === "ein" && wanted === undefined) {
      // Every other field can be cleared by removing it. This one cannot: the
      // EIN is how the organization is matched across systems, so a sync that
      // blanked it would cut the record loose from its own counterparts — and
      // the one way to arrive here is a value too malformed to normalize,
      // which is the weakest possible reason to erase an identifier.
      continue;
    }

    // The empty string, not `null`. Temelio ignores a `null` on this route —
    // the field keeps its old value — so clearing with one would report a
    // change that never happened.
    patch[key] = (wanted as string | undefined) ?? "";
  }

  // Restated on every write, changed or not, because Temelio drops it
  // otherwise. Verified against the vendor on 2026-09-16: a write naming any
  // other field leaves that field's value in place and silently blanks `ein` —
  // it is the one key on this record that does not merge.
  //
  // Left as-is when there is nothing to write, since an empty body is never
  // sent and so can clear nothing.
  //
  // This matters more than a stray null would: the EIN is how the widget finds
  // this organization at all, so losing it does not corrupt the record, it
  // makes the record invisible. The first push to Temelio would appear to
  // succeed and the next comparison would show Temelio holding no profile.
  if (Object.keys(patch).length > 0 && to.ein !== undefined) {
    patch["ein"] = to.ein;
  }

  return patch;
}

/** The vendor fields a foundation may write, projected out of a profile. */
interface TemelioWritable {
  ein: string | undefined;
  mission: string | undefined;
  foundingDate: string | undefined;
  website: string | undefined;
  facebook: string | undefined;
  twitter: string | undefined;
  instagram: string | undefined;
  linkedIn: string | undefined;
  headquarters: TemelioAddress | undefined;
  mailingAddress: TemelioAddress | undefined;
  orgEmail: string | undefined;
  phoneNumber: string | undefined;
  dba: string | undefined;
  vision: string | undefined;
  description: string | undefined;
  guidestarProfile: string | undefined;
  legalStatus: string | undefined;
  irsRecipientStatus: string | undefined;
}

const EMPTY_ADDRESS: TemelioAddress = {
  address1: "",
  address2: "",
  city: "",
  state: "",
  zipcode: "",
  country: "",
};

/**
 * The same projection `toOrganization` reverses, so a round trip is a no-op.
 *
 * Both sides of the diff go through here rather than one side being compared
 * to a raw record: a value Temelio spells differently from CommonGrants would
 * otherwise read as a change on every single write.
 */
function writableFields(org: Organization): TemelioWritable {
  return {
    // Normalized on the way out as well as in. Temelio's search index stores
    // EINs as nine bare digits and matches them exactly, so a hyphenated one
    // written through here would land in the record and then match nothing —
    // including the lookup this demo finds the organization by.
    ein: employerTaxId(org.identifiers?.["org:us:ein"]?.id),
    mission: org.mission,
    foundingDate: org.yearFounded ? `${org.yearFounded}-01-01` : undefined,
    website: org.socials?.website,
    facebook: org.socials?.facebook,
    twitter: org.socials?.twitterOrX,
    instagram: org.socials?.instagram,
    linkedIn: org.socials?.linkedin,
    headquarters: fromAddress(org.addresses?.primary),
    mailingAddress: fromAddress(org.addresses?.otherAddresses?.["mailing"]),
    orgEmail: org.emails?.primary,
    phoneNumber: org.phones?.primary
      ? `${org.phones.primary.countryCode} ${org.phones.primary.number}`
      : undefined,
    ...customFieldValues(org),
  };
}

/** The named vendor fields, read back out of `customFields`. */
function customFieldValues(
  org: Organization,
): Pick<TemelioWritable, (typeof CUSTOM_FIELD_KEYS)[number]> {
  const values = {} as Pick<TemelioWritable, (typeof CUSTOM_FIELD_KEYS)[number]>;

  for (const key of CUSTOM_FIELD_KEYS) {
    const value = org.customFields?.[key]?.value;

    values[key] = typeof value === "string" ? value : undefined;
  }

  return values;
}

/** Whether two projected values are the same, comparing addresses by content. */
function sameValue(
  held: string | TemelioAddress | undefined,
  wanted: string | TemelioAddress | undefined,
): boolean {
  if (held === undefined || wanted === undefined || typeof held === "string") {
    return held === wanted;
  }

  return JSON.stringify(held) === JSON.stringify(wanted as TemelioAddress);
}

/** A value, or `undefined` when the vendor holds nothing meaningful. */
function text(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();

  return trimmed ? trimmed : undefined;
}

/** Nine digits, or nothing. An EIN in any other shape is not one we can match on. */
function employerTaxId(value: string | null | undefined): string | undefined {
  const digits = text(value)?.replace(/[^0-9]/g, "");

  return digits?.length === 9 ? digits : undefined;
}

/** The year out of a `YYYY-MM-DD` founding date. */
function year(value: string | null | undefined): string | undefined {
  const match = /^([0-9]{4})-[0-9]{2}-[0-9]{2}$/.exec(text(value) ?? "");

  return match?.[1];
}

/**
 * A complete address, or nothing.
 *
 * CommonGrants requires a street, city, region, country and postal code
 * together; Temelio requires none of them. A half-filled vendor address cannot
 * become a valid one, and guessing at the missing parts would put an address
 * on screen that nobody entered.
 */
function toAddress(value: TemelioAddress | null | undefined): Address | undefined {
  const street1 = text(value?.address1);
  const city = text(value?.city);
  const stateOrProvince = text(value?.state);
  const country = text(value?.country);
  const postalCode = text(value?.zipcode);

  if (!street1 || !city || !stateOrProvince || !country || !postalCode) {
    return undefined;
  }

  const street2 = text(value?.address2);

  return {
    street1,
    ...(street2 ? { street2 } : {}),
    city,
    stateOrProvince,
    country,
    postalCode,
  };
}

/** The same address in Temelio's spelling, with `""` where we hold nothing. */
function fromAddress(address: Address | undefined): TemelioAddress | undefined {
  if (!address) {
    return undefined;
  }

  return {
    address1: address.street1,
    address2: address.street2 ?? "",
    city: address.city,
    state: address.stateOrProvince,
    zipcode: address.postalCode,
    country: address.country,
  };
}

/**
 * Split Temelio's free-form phone string into a country code and a number.
 *
 * CommonGrants models the two separately and validates the country code, so a
 * string that does not start with one is left out rather than forced into a
 * shape it does not have.
 */
function toPhone(
  value: string | null | undefined,
): { countryCode: string; number: string } | undefined {
  const match = /^(\+[1-9][0-9]{0,3})[\s.-]*(.+)$/.exec(text(value) ?? "");
  const countryCode = match?.[1];
  const number = match?.[2]?.trim();

  return countryCode && number ? { countryCode, number } : undefined;
}

/** The vendor's social links, under the names CommonGrants gives them. */
function toSocials(record: TemelioRecord): OrgSocialLinks | undefined {
  const socials: OrgSocialLinks = {};
  const pairs = [
    ["website", record.website],
    ["facebook", record.facebook],
    ["instagram", record.instagram],
    ["linkedin", record.linkedIn],
    ["twitterOrX", record.twitter],
  ] as const;

  for (const [key, value] of pairs) {
    const url = text(value);

    if (url) {
      socials[key] = url;
    }
  }

  return Object.keys(socials).length > 0 ? socials : undefined;
}

/** The vendor fields the protocol has no name for, as custom fields. */
function toCustomFields(record: TemelioRecord): Organization["customFields"] | undefined {
  const customFields: NonNullable<Organization["customFields"]> = {};

  for (const key of CUSTOM_FIELD_KEYS) {
    const value = text(record[key]);

    if (value) {
      customFields[key] = { name: key, fieldType: "string", value };
    }
  }

  return Object.keys(customFields).length > 0 ? customFields : undefined;
}
