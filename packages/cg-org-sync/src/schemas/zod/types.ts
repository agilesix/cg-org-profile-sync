import { z } from "zod";

/**
 * Scalar types the org models build on.
 *
 * `UuidSchema`, `UTCDateTimeSchema` and `ISODateSchema` already exist in
 * `@common-grants/sdk/schemas` and are re-exported here so callers have one
 * import for the whole org surface.
 */
export { UuidSchema, UTCDateTimeSchema, ISODateSchema } from "@common-grants/sdk/schemas";

/** A calendar year. */
export const CalendarYearSchema = z.string().regex(/^[0-9]{4}$/, "must be a four-digit year");

/** An email address. */
export const EmailSchema = z.email();

/** An Employer Identification Number, normalized to nine digits. */
export const EmployerTaxIdSchema = z
  .string()
  .regex(/^[0-9]{9}$/, "must be nine digits, with the hyphen stripped");

/**
 * A Unique Entity Identifier issued by SAM.gov.
 *
 * Twelve alphanumeric characters. The alphabet excludes O and I, so the value
 * should be cast to uppercase before storing or comparing.
 */
export const SamUeiSchema = z
  .string()
  .regex(/^[A-HJ-NP-Z0-9]{12}$/, "must be twelve uppercase alphanumerics, excluding O and I");

/** A DUNS number, normalized to nine digits. */
export const DunsSchema = z.string().regex(/^[0-9]{9}$/, "must be nine digits");

export type CalendarYear = z.infer<typeof CalendarYearSchema>;
export type Email = z.infer<typeof EmailSchema>;
export type EmployerTaxId = z.infer<typeof EmployerTaxIdSchema>;
export type SamUei = z.infer<typeof SamUeiSchema>;
export type Duns = z.infer<typeof DunsSchema>;
