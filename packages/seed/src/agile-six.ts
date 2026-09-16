import type { Organization } from "@cg-link/org-sync/schemas";

/**
 * Seed profiles for Agile Six, one per system, deliberately out of step.
 *
 * Real values, taken from agile6.com: the legal name, the mission statement,
 * the website, and the LinkedIn and GitHub links.
 *
 * Invented for the demo: the UUIDs, the EIN and UEI, every address, the phone
 * number, the email addresses, and the founding year. The EIN and UEI are the
 * example values published in the CommonGrants registry catalog, so nobody
 * mistakes them for real identifiers.
 *
 * `orgType` is left unset throughout. It takes a Philanthropy Classification
 * System code, and there isn't an honest one to give a for-profit public
 * benefit corporation without inventing a taxonomy entry.
 */

/** The EIN both systems carry, and the key the widget matches the org on. */
export const AGILE_SIX_EIN = "123456789";

export const PORTAL_ORG_ID = "018f2e77-1a2b-7c3d-8e4f-000000000001";
export const FUNDERHUB_ORG_ID = "018f2e77-1a2b-7c3d-8e4f-000000000002";

/**
 * Temelio's id for the org — a real one, not an invented one.
 *
 * The other two ids are made up because the systems that hold them are ours.
 * This record exists in Temelio's own database, created through their API, and
 * the adapter reads it there in sandbox mode. Inventing an id here would give
 * the fixture and the sandbox two different answers to "which record is this",
 * and the whole point of the fixture is to stand in for the sandbox exactly.
 */
export const TEMELIO_ORG_ID = "412fd95e-f4aa-41c0-96da-5822254f280a";

const LEGAL_NAME = "Agile Six Applications, Inc.";

const MISSION =
  "We use modern technology and user-friendly, accessible design to build better " +
  "government and public services for everyone.";

/**
 * GrantPortal's copy: complete, and the one that is actually current.
 *
 * This is where someone updates their profile, so it holds the newer suite
 * number and the working email address.
 */
export const PORTAL_SEED: Organization = {
  id: PORTAL_ORG_ID,
  name: LEGAL_NAME,
  identifiers: {
    systemId: {
      registry: { code: "org:grants.gov:system" },
      id: PORTAL_ORG_ID,
    },
    "org:us:ein": {
      registry: {
        code: "org:us:ein",
        url: "https://commongrants.org/registries/org-us-ein",
      },
      id: AGILE_SIX_EIN,
    },
    "org:us:uei": {
      registry: {
        code: "org:us:uei",
        url: "https://commongrants.org/registries/org-us-uei",
      },
      id: "AB0123456789",
    },
  },
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
  phones: {
    primary: { countryCode: "+1", number: "619-555-0142", isMobile: false },
  },
  emails: { primary: "hello@agile6.com" },
  mission: MISSION,
  yearFounded: "2015",
  socials: {
    website: "https://agile6.com",
    linkedin: "https://www.linkedin.com/company/agilesix/",
    otherSocials: { github: "https://github.com/agilesix" },
  },
};

/**
 * FunderHub's copy: the same organization, remembered less well.
 *
 * Four disagreements to find, each standing for a way these copies drift apart
 * in practice:
 *
 * - the address is a suite behind, because nobody told the funder about a move
 * - the email points at a mailbox that no longer routes anywhere
 * - the mission was never filled in
 * - the socials and founding year are absent because FunderHub does not model
 *   them at all, which is why a sync has to patch rather than replace
 */
export const FUNDERHUB_SEED: Organization = {
  id: FUNDERHUB_ORG_ID,
  name: LEGAL_NAME,
  identifiers: {
    systemId: {
      registry: { code: "org:funderhub:system" },
      id: FUNDERHUB_ORG_ID,
    },
    "org:us:ein": {
      registry: {
        code: "org:us:ein",
        url: "https://commongrants.org/registries/org-us-ein",
      },
      id: AGILE_SIX_EIN,
    },
  },
  addresses: {
    primary: {
      street1: "600 B Street",
      street2: "Suite 210",
      city: "San Diego",
      stateOrProvince: "CA",
      country: "US",
      postalCode: "92101",
    },
  },
  phones: {
    primary: { countryCode: "+1", number: "619-555-0142", isMobile: false },
  },
  emails: { primary: "grants@agile6.com" },
};

/**
 * Fields FunderHub declines to store.
 *
 * A patch that sets one of these is not an error; the widget drops it from the
 * outgoing body and reports it as skipped, so the person can see that the value
 * went to the systems that can hold it and no further.
 */
export const FUNDERHUB_UNWRITABLE_FIELDS = ["socials", "yearFounded", "orgType"] as const;

/**
 * Temelio's copy: a third opinion, so the grid has more than two columns.
 *
 * Drifted its own way rather than agreeing with either of the others, because
 * three systems that split two-to-one on a field is the picture the demo is
 * about — someone has to choose which copy is right, and a tie makes that
 * choice look automatic.
 *
 * - the website is the old `http://www.` form, so all three systems differ
 * - the suite number sides with FunderHub, so GrantPortal is the odd one out
 * - no LinkedIn, because Temelio's record has nowhere to put the GitHub link
 *   either and a profile that is merely *less complete* is the common case
 *
 * The values match what the real Temelio record holds, field for field. That
 * is what lets the adapter's fixture and the live sandbox be swapped for each
 * other without a spec noticing.
 */
export const TEMELIO_SEED: Organization = {
  id: TEMELIO_ORG_ID,
  name: LEGAL_NAME,
  identifiers: {
    systemId: {
      registry: { code: "org:temelio:system" },
      id: TEMELIO_ORG_ID,
    },
    "org:us:ein": {
      registry: {
        code: "org:us:ein",
        url: "https://commongrants.org/registries/org-us-ein",
      },
      id: AGILE_SIX_EIN,
    },
  },
  addresses: {
    primary: {
      street1: "600 B Street",
      street2: "Suite 210",
      city: "San Diego",
      stateOrProvince: "CA",
      country: "US",
      postalCode: "92101",
    },
  },
  phones: {
    primary: { countryCode: "+1", number: "619-555-0142" },
  },
  emails: { primary: "hello@agile6.com" },
  mission: MISSION,
  yearFounded: "2015",
  socials: { website: "http://www.agile6.com" },
};
