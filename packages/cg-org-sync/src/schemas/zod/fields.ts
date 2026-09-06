import { z } from "zod";
import { EmailSchema, UuidSchema } from "./types.js";

/** The SDK already models these, so the org schemas reuse them as-is. */
export {
  CustomFieldSchema,
  CustomFieldTypeEnum,
  SystemMetadataSchema,
} from "@common-grants/sdk/schemas";

// ############################################################################
// Addresses
// ############################################################################

/** A mailing address. */
export const AddressSchema = z.object({
  /** The primary street address line. */
  street1: z.string(),

  /** Additional street address information, such as a suite or apartment number. */
  street2: z.string().optional(),

  /** The city or municipality name. */
  city: z.string(),

  /** The state, province, or region name. */
  stateOrProvince: z.string(),

  /** The country name or ISO country code. */
  country: z.string(),

  /** The postal or ZIP code. */
  postalCode: z.string(),

  latitude: z.number().optional(),
  longitude: z.number().optional(),

  /** Additional geospatial data in GeoJSON format. */
  geography: z.record(z.string(), z.unknown()).optional(),
});

/** A primary address plus any others, keyed by a descriptive label. */
export const AddressCollectionSchema = z.object({
  primary: AddressSchema,
  otherAddresses: z.record(z.string(), AddressSchema).optional(),
});

// ############################################################################
// Phones and emails
// ############################################################################

/** A phone number. */
export const PhoneSchema = z.object({
  /** The international country code, such as "+1" for US and Canada. */
  countryCode: z.string().regex(/^\+[1-9][0-9]{0,3}$/, "must look like +1"),

  /** The local number, without the country code. */
  number: z.string(),

  extension: z.string().optional(),
  isMobile: z.boolean().optional(),
});

/** A primary phone number plus a fax line and any others. */
export const PhoneCollectionSchema = z.object({
  primary: PhoneSchema,
  fax: PhoneSchema.optional(),
  otherPhones: z.record(z.string(), PhoneSchema).optional(),
});

/** A primary email address plus any others, keyed by a descriptive label. */
export const EmailCollectionSchema = z.object({
  primary: EmailSchema,
  otherEmails: z.record(z.string(), EmailSchema).optional(),
});

// ############################################################################
// Identifiers
// ############################################################################

/** Whether an identifier value is still in use or has been retired. */
export const IdentifierStatusEnum = z.enum(["active", "archived"]);

/** Registry-level facts shared by every record in a registry. */
export const RegistryRefSchema = z.object({
  /** Canonical CommonGrants registry code, `<schema>:<scope>:<prop>`. */
  code: z.string().optional(),

  /** Link to the catalog entry for this registry. */
  url: z.url().optional(),
});

/**
 * Build an identifier schema for a registry with a known id format.
 *
 * The protocol pins the registry code and value type per registry, which is
 * what lets `org:us:ein` reject a UEI and vice versa.
 */
export function identifierSchema<TId extends z.ZodType>(idSchema: TId, code?: string) {
  return z.object({
    registry: z
      .object({
        code: code ? z.literal(code).optional() : z.string().optional(),
        url: z.url().optional(),
      })
      .optional(),

    /** The primary value, when the registry has a single canonical one. */
    id: idSchema.optional(),

    /** Every known value for this record in this registry, including retired ones. */
    allIds: z.array(z.object({ id: idSchema, status: IdentifierStatusEnum })).optional(),
  });
}

/** An identifier issued to a record by any registry. */
export const IdentifierSchema = identifierSchema(z.string());

/**
 * The hosting system's own identifier for a record.
 *
 * The value is the record's UUID within that system; the registry code names
 * the system, such as `org:grants.gov:system`.
 */
export const SystemIdSchema = identifierSchema(UuidSchema);

/** A collection of identifiers associated with a record. */
export const IdentifierCollectionSchema = z.object({
  systemId: SystemIdSchema.optional(),

  /** Identifiers from registries the protocol does not define on the model. */
  otherIds: z.record(z.string(), IdentifierSchema).optional(),
});

// ############################################################################
// Philanthropy Classification System
// ############################################################################

/** The class a PCS term belongs to. */
export const PCSClassEnum = z.enum([
  "Organization types",
  "Subjects",
  "Population groups",
  "Transaction types",
  "Support strategies",
]);

/**
 * A Philanthropy Classification System term.
 *
 * @see https://taxonomy.candid.org/
 */
export const PCSTermSchema = z.object({
  /** The plain language term. */
  term: z.string(),

  class: PCSClassEnum,

  /** The code for this term. */
  code: z.string().regex(/^[A-Z]{2}[0-9]{6}$/, "must look like EO000000"),

  description: z.string().optional(),
});

/** A PCS term narrowed to the organization type class. */
export const PCSOrgTypeSchema = PCSTermSchema.extend({
  class: z.literal("Organization types"),
});

export type Address = z.infer<typeof AddressSchema>;
export type AddressCollection = z.infer<typeof AddressCollectionSchema>;
export type Phone = z.infer<typeof PhoneSchema>;
export type PhoneCollection = z.infer<typeof PhoneCollectionSchema>;
export type EmailCollection = z.infer<typeof EmailCollectionSchema>;
export type Identifier = z.infer<typeof IdentifierSchema>;
export type SystemId = z.infer<typeof SystemIdSchema>;
export type IdentifierCollection = z.infer<typeof IdentifierCollectionSchema>;
export type PCSTerm = z.infer<typeof PCSTermSchema>;
export type PCSOrgType = z.infer<typeof PCSOrgTypeSchema>;
