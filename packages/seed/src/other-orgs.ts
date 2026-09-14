import type { Organization } from "@cg-link/org-sync/schemas";
import { FUNDERHUB_SEED, PORTAL_SEED } from "./agile-six.js";

/**
 * The other organizations each system holds, so the picker has a choice in it.
 *
 * Wholly invented — the names, the EINs, the addresses and the email addresses
 * belong to nobody. They exist for one beat of the demo: after signing in, a
 * person is shown the organizations that system says they may touch, and a
 * list of one proves nothing about a chooser. They are also what the second
 * connect greys out, since a person links one organization at a time.
 *
 * Deliberately undramatic. Agile Six is the org the demo is *about* — the
 * drifted copies, the disagreeing address, the field FunderHub declines. These
 * two agree with themselves across both systems, so they can never be mistaken
 * for a second story the grid is trying to tell.
 *
 * Neither carries `socials`. FunderHub does not model them at all, and giving
 * GrantPortal a website for an invented nonprofit would put a URL nobody owns
 * on screen.
 */

/** What both systems' copies of one organization are built from. */
interface SharedOrg {
  /** The EIN both systems publish for it, and the key they are matched by. */
  ein: string;

  name: string;

  /** Identical on both systems, so this org never reads as drift. */
  address: NonNullable<Organization["addresses"]>["primary"];

  email: string;

  /** The id GrantPortal assigned it. */
  portalId: string;

  /** The id FunderHub assigned it, which is deliberately a different one. */
  funderhubId: string;
}

const SHARED_ORGS: readonly SharedOrg[] = [
  {
    ein: "112233445",
    name: "Rivermark Youth Coalition",
    address: {
      street1: "1400 Market Street",
      street2: "Suite 12",
      city: "Sacramento",
      stateOrProvince: "CA",
      country: "US",
      postalCode: "95814",
    },
    email: "contact@rivermarkyouth.org",
    portalId: "018f2e77-1a2b-7c3d-8e4f-000000000003",
    funderhubId: "018f2e77-1a2b-7c3d-8e4f-000000000004",
  },
  {
    ein: "556677889",
    name: "Tallgrass Literacy Project",
    address: {
      street1: "220 Elm Avenue",
      city: "Lincoln",
      stateOrProvince: "NE",
      country: "US",
      postalCode: "68508",
    },
    email: "hello@tallgrassliteracy.org",
    portalId: "018f2e77-1a2b-7c3d-8e4f-000000000005",
    funderhubId: "018f2e77-1a2b-7c3d-8e4f-000000000006",
  },
];

/**
 * One system's copy of a shared organization.
 *
 * Derived rather than written out twice. Four hand-maintained literals would
 * be four chances for two copies of the same org to drift apart in a way the
 * grid would then report as a disagreement — which is the one thing these orgs
 * exist not to do. Only the record id and the system-assigned identifier
 * differ between the copies, which is exactly what differs between two real
 * systems holding the same organization.
 */
function copyFor(shared: SharedOrg, orgId: string, systemRegistry: string): Organization {
  return {
    id: orgId,
    name: shared.name,
    identifiers: {
      systemId: {
        registry: { code: systemRegistry },
        id: orgId,
      },
      "org:us:ein": {
        registry: {
          code: "org:us:ein",
          url: "https://commongrants.org/registries/org-us-ein",
        },
        id: shared.ein,
      },
    },
    addresses: { primary: shared.address },
    emails: { primary: shared.email },
  };
}

/** GrantPortal's copies of the two other organizations. */
export const PORTAL_OTHER_SEEDS: readonly Organization[] = SHARED_ORGS.map((shared) =>
  copyFor(shared, shared.portalId, "org:grants.gov:system"),
);

/** FunderHub's copies of the same two organizations. */
export const FUNDERHUB_OTHER_SEEDS: readonly Organization[] = SHARED_ORGS.map((shared) =>
  copyFor(shared, shared.funderhubId, "org:funderhub:system"),
);

/**
 * Everything GrantPortal holds, Agile Six first.
 *
 * Order matters: `MemoryOrgStore` lists in seed order, and the picker shows
 * that order, so the organization the demo is about is the one already at the
 * top of the list rather than something the presenter has to hunt for.
 */
export const PORTAL_SEEDS: readonly Organization[] = [PORTAL_SEED, ...PORTAL_OTHER_SEEDS];

/** Everything FunderHub holds, Agile Six first, for the same reason. */
export const FUNDERHUB_SEEDS: readonly Organization[] = [FUNDERHUB_SEED, ...FUNDERHUB_OTHER_SEEDS];
