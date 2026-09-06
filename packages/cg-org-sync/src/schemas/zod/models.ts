import { z } from "zod";
import { CustomFieldSchema } from "@common-grants/sdk/schemas";
import {
  AddressCollectionSchema,
  EmailCollectionSchema,
  IdentifierCollectionSchema,
  PCSOrgTypeSchema,
  PhoneCollectionSchema,
  identifierSchema,
} from "./fields.js";
import {
  CalendarYearSchema,
  DunsSchema,
  EmployerTaxIdSchema,
  SamUeiSchema,
  UTCDateTimeSchema,
  UuidSchema,
} from "./types.js";

// ############################################################################
// Organization identifiers
// ############################################################################

/** Employer Identification Number, assigned by the IRS. */
export const OrgIdEinSchema = identifierSchema(EmployerTaxIdSchema, "org:us:ein");

/** Unique Entity Identifier, issued through SAM.gov. */
export const OrgIdUeiSchema = identifierSchema(SamUeiSchema, "org:us:uei");

/** DUNS number, issued by Dun & Bradstreet. */
export const OrgIdDunsSchema = identifierSchema(DunsSchema, "org:xi:duns");

/**
 * The identifiers an organization carries.
 *
 * Extends the generic collection with the registries CommonGrants defines as
 * base identifiers for organizations. Anything else goes under `otherIds`.
 */
export const OrgIdsSchema = IdentifierCollectionSchema.extend({
  "org:us:ein": OrgIdEinSchema.optional(),
  "org:us:uei": OrgIdUeiSchema.optional(),
  "org:xi:duns": OrgIdDunsSchema.optional(),
});

// ############################################################################
// Organization
// ############################################################################

/** An organization's social media and web presence. */
export const OrgSocialLinksSchema = z.object({
  website: z.url().optional(),
  facebook: z.url().optional(),
  twitterOrX: z.url().optional(),
  bluesky: z.url().optional(),
  instagram: z.url().optional(),
  linkedin: z.url().optional(),

  /** Profiles not covered by the named fields, keyed by platform. */
  otherSocials: z.record(z.string(), z.url()).optional(),
});

/**
 * The fields of an organization profile a client may write.
 *
 * Split out from `OrganizationBaseSchema` because the merge patch body is
 * derived from it: `id` is assigned by the server and never patched.
 */
export const OrgProfileWritableSchema = z.object({
  /** The organization's legal name as registered with relevant authorities. */
  name: z.string(),

  /** Identifiers associated with the organization, keyed by registry code. */
  identifiers: OrgIdsSchema.optional(),

  /** The organization's type within the Philanthropy Classification System. */
  orgType: PCSOrgTypeSchema.optional(),

  addresses: AddressCollectionSchema.optional(),
  phones: PhoneCollectionSchema.optional(),
  emails: EmailCollectionSchema.optional(),

  /** The organization's mission statement. */
  mission: z.string().optional(),

  /** The calendar year the organization was founded. */
  yearFounded: CalendarYearSchema.optional(),

  socials: OrgSocialLinksSchema.optional(),
  customFields: z.record(z.string(), CustomFieldSchema).optional(),
});

/** An organization that can apply for grants. */
export const OrganizationBaseSchema = OrgProfileWritableSchema.extend({
  /** The organization's unique identifier within the hosting system. */
  id: UuidSchema,
});

/**
 * A pointer to an organization, carrying just enough to identify it.
 *
 * Appears wherever another record references an organization.
 */
export const OrgRefSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  identifiers: OrgIdsSchema.optional(),
});

// ############################################################################
// Revisions
// ############################################################################

/**
 * The states a change can be in.
 *
 * `pending` is the only non-terminal one. `custom` lets a receiver name a state
 * of its own and document whether it is terminal.
 */
export const RevisionStatusOptionsEnum = z.enum([
  "pending",
  "accepted",
  "denied",
  "superseded",
  "custom",
]);

/** A revision's state, with room for a human-readable explanation. */
export const RevisionStatusSchema = z.object({
  value: RevisionStatusOptionsEnum,

  /** Used when `value` is `custom`. */
  customValue: z.string().optional(),

  description: z.string().optional(),
});

export type Organization = z.infer<typeof OrganizationBaseSchema>;
export type OrgProfileWritable = z.infer<typeof OrgProfileWritableSchema>;
export type OrgRef = z.infer<typeof OrgRefSchema>;
export type OrgIds = z.infer<typeof OrgIdsSchema>;
export type OrgSocialLinks = z.infer<typeof OrgSocialLinksSchema>;
export type RevisionStatus = z.infer<typeof RevisionStatusSchema>;

/** Timestamps every stored record carries. */
export const RecordTimestampsSchema = z.object({
  createdAt: UTCDateTimeSchema,
  lastModifiedAt: UTCDateTimeSchema,
});
