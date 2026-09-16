/**
 * Temelio, in memory.
 *
 * Two jobs. It is the offline mode the adapter runs in when there is no
 * sandbox credential — which is how `pnpm e2e` and a fresh checkout work at
 * all — and it is what the unit suite exercises the store against.
 *
 * The record below is the real one, field for field: it was created in the
 * foundation through Temelio's own API and seeded with the values here. That
 * is what lets fixture mode and sandbox mode be swapped for one another
 * without a spec noticing the difference.
 */

import { TEMELIO_ORG_ID } from "@cg-link/seed";
import type { TemelioApi } from "./api.js";
import type { TemelioMetadataPatch } from "./mapping.js";
import { TemelioRecordSchema, type TemelioRecord, type TemelioSummary } from "./records.js";

/**
 * Agile Six as Temelio holds it, in the vendor's own shape.
 *
 * Deliberately raw and untyped: this is what a response body looks like, funder-side
 * bookkeeping included, so parsing it is a real parse rather than a cast. The
 * fields the adapter ignores are here for the same reason — a test asserts
 * that every one of them is accounted for as either mapped or dropped.
 */
export const AGILE_SIX_TEMELIO_RECORD: Record<string, unknown> = {
  // Mapped.
  nonprofitId: TEMELIO_ORG_ID,
  legalName: "Agile Six Applications, Inc.",
  ein: "123456789",
  mission:
    "We use modern technology and user-friendly, accessible design to build better " +
    "government and public services for everyone.",
  foundingDate: "2015-01-01",

  // The old `http://www.` form: this is the drift the demo is about.
  website: "http://www.agile6.com",
  facebook: null,
  twitter: null,
  instagram: null,
  linkedIn: null,
  headquarters: {
    address1: "600 B Street",

    // A suite behind GrantPortal, and the same one FunderHub holds.
    address2: "Suite 210",
    city: "San Diego",
    state: "CA",
    zipcode: "92101",
    country: "US",
  },
  mailingAddress: {
    address1: null,
    address2: null,
    city: null,
    state: null,
    zipcode: null,
    country: null,
  },
  orgEmail: "hello@agile6.com",
  phoneNumber: "+1 619-555-0142",
  dba: null,

  // `""` rather than `null`, because the real record holds `""` here: Temelio
  // writes the empty string where a field has been edited and cleared.
  vision: "",
  description: null,
  guidestarProfile: null,
  legalStatus: null,
  irsRecipientStatus: null,

  // Dropped: the funder's own bookkeeping about this grantee, not the
  // organization's profile.
  foundationId: "3d55c694-5f6c-4f66-94e1-ff411a0b26c6",
  organizationName: "Agile Six Applications, Inc.",
  entityType: "ORGANIZATION",
  hasFiscalSponsor: false,
  fiscalSponsor: null,
  customFields: {},
  tags: [],
  entityTags: [],
  submissionTags: [],
  statuses: [],
  customStatuses: [],
  coloredTags: [],
  totalAwarded: 0,
  nextPaymentDate: null,
  foundationPOC: null,
  primaryContact: null,
  submissionDetails: [],
  additionalInfo: null,
  ofacFlags: null,
  sendEmail: false,
  completedOnboarding: false,
  completedOnboardingAt: null,
  organizationLogo: null,
  irsDeterminationLetter: null,
};

/** The seeded records, parsed, keyed by Temelio's id for each. */
function seedRecords(): Map<string, TemelioRecord> {
  return new Map([[TEMELIO_ORG_ID, TemelioRecordSchema.parse(AGILE_SIX_TEMELIO_RECORD)]]);
}

/**
 * Temelio, in memory, behaving the way the real API does.
 *
 * Faithful in the two ways that matter for anything built on top: a write
 * merges at the top level and replaces a sub-object whole, and a read of
 * something it does not hold answers nothing rather than failing. Get either
 * wrong and fixture mode would prove the adapter works when it does not.
 *
 * No allowlist here. The guard on `TemelioHttpApi` exists to protect a live
 * system shared with real foundations; this one holds a single invented record
 * in a single process, and adding the guard would only mean tests of the guard
 * passing against something that never needed it.
 */
export class FakeTemelioApi implements TemelioApi {
  #records = seedRecords();

  /** What the fake currently holds, so a test can see what a write stored. */
  get records(): ReadonlyMap<string, TemelioRecord> {
    return this.#records;
  }

  async searchByEin(ein: string): Promise<TemelioSummary[]> {
    return [...this.#records.values()]
      .filter((record) => record.ein === ein)
      .map((record) => ({
        id: record.nonprofitId,
        legalName: record.legalName,
        ein: record.ein,
        active: true,
      }));
  }

  async read(nonprofitId: string): Promise<TemelioRecord | undefined> {
    const record = this.#records.get(nonprofitId);

    return record ? structuredClone(record) : undefined;
  }

  async write(nonprofitId: string, patch: TemelioMetadataPatch): Promise<void> {
    const record = this.#records.get(nonprofitId);

    if (!record) {
      return;
    }

    // A shallow spread is the whole of Temelio's merge semantics: a named key
    // is replaced outright — a sub-object included, which is why the mapping
    // sends addresses whole — and an unnamed one is left alone. The cast is
    // the price of a patch being keyed by vendor field names rather than by a
    // type the record shares.
    this.#records.set(nonprofitId, { ...record, ...patch } as TemelioRecord);
  }

  /** Discard every write and return to the seeded records. */
  reset(): void {
    this.#records = seedRecords();
  }
}
