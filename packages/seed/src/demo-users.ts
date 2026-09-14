import { FUNDERHUB_ORG_ID, PORTAL_ORG_ID } from "./agile-six.js";

/**
 * The people the demo signs in as, and what each may touch on each system.
 *
 * Grants live here, next to the seed profiles they point at, because they are
 * the same kind of fact: invented data that makes the demo say something. The
 * thing they make it say is that access is per system — one person can be
 * known to GrantPortal and a stranger to FunderHub, and FunderHub answers "no
 * such org" rather than showing them a profile they have no claim on.
 *
 * The emails are placeholders. The real accounts get decided the day before
 * and arrive through the environment; #1188-T2 is where that override lands.
 */

/** A person the demo can sign in as, and what they may touch on each system. */
export interface DemoUser {
  /** The address the identity provider returns for them. */
  email: string;

  /** Org ids this person may touch, keyed by system id (`portal`, `funderhub`). */
  grants: Readonly<Record<string, readonly string[]>>;
}

export const DEMO_USERS: readonly DemoUser[] = [
  {
    // The nonprofit's own admin: the same organization on both systems, which
    // is what makes a comparison across the two of them theirs to act on.
    email: "admin@example.org",
    grants: {
      portal: [PORTAL_ORG_ID],
      funderhub: [FUNDERHUB_ORG_ID],
    },
  },
  {
    email: "portal-only@example.org",
    grants: {
      portal: [PORTAL_ORG_ID],
      // Spelled out rather than left absent. This empty list is the demo's
      // point — connecting FunderHub as this person succeeds, and the org they
      // can see on GrantPortal is simply not there.
      funderhub: [],
    },
  },
];

/**
 * Which orgs `email` may touch on `systemId`.
 *
 * Empty for an unknown person, and for a known person with no grant on that
 * system — "no record of you here" and "you may touch nothing here" are the
 * same answer to a store that is about to filter by it.
 *
 * Matched case-insensitively: an identity provider may hand back `Admin@…` for
 * someone seeded as `admin@…`, and a case-sensitive lookup would read that as
 * a different person and silently strip their access.
 */
export function grantsFor(systemId: string, email: string): readonly string[] {
  const normalized = email.toLowerCase();
  const user = DEMO_USERS.find((candidate) => candidate.email.toLowerCase() === normalized);

  return user?.grants[systemId] ?? [];
}
