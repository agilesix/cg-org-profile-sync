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
