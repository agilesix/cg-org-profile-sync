/**
 * Temelio's records, as this adapter reads them.
 *
 * The shape here is the *per-funder* copy of a grantee's profile — the one a
 * foundation account can actually reach. A nonprofit's own record sits behind
 * a different permission and answers 403 to us, so the surface CommonGrants
 * gets retrofitted onto is the funder's copy. That is the single most
 * surprising thing about this integration and the reason this file exists.
 *
 * Only the fields the mapping reads are declared. Unknown keys are stripped on
 * the way in, which is safe in a way it would not be for `MemoryOrgStore`: a
 * write here sends *only the top-level keys that changed*, so a vendor field
 * this adapter has never heard of is never overwritten — it simply stays where
 * it is, on Temelio's side.
 *
 * That argument stops at the top level. An address is sent whole, because
 * Temelio replaces a sub-object rather than merging into it, so it is rebuilt
 * from the six keys declared below and any seventh one the vendor grew would
 * be dropped by an address edit. Six is what the API documented and the
 * sandbox returned; it is an assumption to re-check whenever the vendor's
 * shape is looked at again, not something the vendor promises.
 */

import { z } from "zod";

/**
 * A postal address in Temelio's spelling.
 *
 * Every field is nullable because the vendor leaves them so: a record the UI
 * has never touched holds `null`, and one it has touched and cleared holds
 * `""`. Both mean empty here.
 */
export const TemelioAddressSchema = z.object({
  address1: z.string().nullish(),
  address2: z.string().nullish(),
  city: z.string().nullish(),
  state: z.string().nullish(),
  zipcode: z.string().nullish(),
  country: z.string().nullish(),
});

/** One grantee's profile as the foundation holds it. */
export const TemelioRecordSchema = z.object({
  /** Temelio's id for the grantee. The only identifier on the record. */
  nonprofitId: z.string(),

  /** The legal name. Read-only for a funder — see `mapping.ts`. */
  legalName: z.string().nullish(),

  /** Nine digits, no hyphen. Temelio's search index matches on this exactly. */
  ein: z.string().nullish(),

  mission: z.string().nullish(),

  /** `YYYY-MM-DD`. CommonGrants models only the year. */
  foundingDate: z.string().nullish(),

  website: z.string().nullish(),
  facebook: z.string().nullish(),

  /** Still `twitter` on the vendor side; `twitterOrX` in CommonGrants. */
  twitter: z.string().nullish(),
  instagram: z.string().nullish(),

  /** Capital I, unlike CommonGrants' `linkedin`. */
  linkedIn: z.string().nullish(),

  headquarters: TemelioAddressSchema.nullish(),
  mailingAddress: TemelioAddressSchema.nullish(),

  orgEmail: z.string().nullish(),

  /** A free string, such as `+1 619-555-0142` — not split into parts. */
  phoneNumber: z.string().nullish(),

  // No CommonGrants counterpart. These ride along in `customFields` rather
  // than being dropped, because they are profile facts a person entered.
  dba: z.string().nullish(),
  vision: z.string().nullish(),
  description: z.string().nullish(),
  guidestarProfile: z.string().nullish(),

  /** Free text, such as `501(c)3` — not an enum, and not a PCS org type. */
  legalStatus: z.string().nullish(),
  irsRecipientStatus: z.string().nullish(),
});

/**
 * One row of Temelio's grantee search.
 *
 * The whole row, not just the parts the adapter uses. A search result is a
 * lookup answer rather than a profile — narrowing it here would mean a caller
 * that wants the name it matched has to go and read the record again.
 */
export const TemelioSummarySchema = z.object({
  id: z.string(),
  legalName: z.string().nullish(),
  ein: z.string().nullish(),
  dba: z.string().nullish(),
  entityType: z.string().nullish(),

  /** Temelio keeps retired grantees in the index; the adapter wants live ones. */
  active: z.boolean().nullish(),
  created: z.string().nullish(),
});

/** A page of grantee search results. */
export const TemelioSearchPageSchema = z.object({
  data: z.array(TemelioSummarySchema),
});

/**
 * Temelio's error envelope.
 *
 * `message` is optional on purpose: most failures carry one, but a request
 * refused by a filter ahead of the controller answers a bare framework body
 * with `error` and no `message` at all. A client that assumed `message` would
 * report `undefined` for exactly the failure a caller most needs explained.
 */
export const TemelioErrorSchema = z.object({
  status: z.number().nullish(),
  message: z.string().nullish(),
  error: z.string().nullish(),
  path: z.string().nullish(),
});

export type TemelioAddress = z.infer<typeof TemelioAddressSchema>;
export type TemelioRecord = z.infer<typeof TemelioRecordSchema>;
export type TemelioSummary = z.infer<typeof TemelioSummarySchema>;
