import { PORTAL_ORG_ID } from "./agile-six.js";
import { FUNDERHUB_SEEDS, PORTAL_SEEDS } from "./other-orgs.js";

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

/**
 * Which of the demo's two people a user is.
 *
 * Independent of the address they sign in with, because that address is
 * decided the day before and arrives from the environment. A caller that needs
 * to know which person this is asks the role, not the email.
 */
export type DemoRole = "admin" | "portal-only";

/** A person the demo can sign in as, and what they may touch on each system. */
export interface DemoUser {
  role: DemoRole;

  /** The address the identity provider returns for them. */
  email: string;

  /** Org ids this person may touch, keyed by system id (`portal`, `funderhub`). */
  grants: Readonly<Record<string, readonly string[]>>;
}

export const DEMO_USERS: readonly DemoUser[] = [
  {
    // The nonprofit's own admin: the same organizations on both systems, which
    // is what makes a comparison across the two of them theirs to act on.
    //
    // Granted every seeded org rather than one. The organization picker asks
    // each system what this person may touch there, and a list of one is a
    // chooser with nothing to choose — so the demo's "select your
    // organization" step needs the admin to genuinely have several. Derived
    // from the seeds so an org added there cannot be left ungranted here.
    role: "admin",
    email: "admin@example.org",
    grants: {
      portal: PORTAL_SEEDS.map((seed) => seed.id),
      funderhub: FUNDERHUB_SEEDS.map((seed) => seed.id),
    },
  },
  {
    // Deliberately granted one organization, not all of GrantPortal's. This
    // person is the demo's negative beat twice over: a stranger to FunderHub,
    // and — when the picker opens on GrantPortal — someone with exactly one
    // organization to their name, which is what a real applicant looks like.
    role: "portal-only",
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
 * The demo users, with any supplied address replacing that role's placeholder.
 *
 * An absent or empty override leaves the placeholder in place. That matters
 * more than it looks: an unset environment variable must not blank out an
 * address, because an empty email matches nobody and would silently strip that
 * person's access on the morning of the demo.
 */
export function demoUsers(
  emails: Partial<Record<DemoRole, string | undefined>> = {},
): readonly DemoUser[] {
  return DEMO_USERS.map((user) => {
    const override = emails[user.role];

    return override ? { ...user, email: override } : user;
  });
}

/**
 * Which orgs `email` may touch on `systemId`, among `users`.
 *
 * Empty for an unknown person, and for a known person with no grant on that
 * system — "no record of you here" and "you may touch nothing here" are the
 * same answer to a store that is about to filter by it.
 *
 * Matched case-insensitively — see `find`.
 */
export function grantsFor(
  systemId: string,
  email: string,
  users: readonly DemoUser[] = DEMO_USERS,
): readonly string[] {
  return find(email, users)?.grants[systemId] ?? [];
}

/**
 * Which of the demo's people `email` is, if any.
 *
 * The coarser question `grantsFor` cannot answer for every system. A system
 * whose org ids come from its own environment — the Temelio adapter, whose
 * grantees are whatever that foundation holds — has no way to look itself up
 * in a seed that has never heard of those ids. It can only ask who this is,
 * and decide for itself what that person may touch.
 *
 * `undefined` for anyone unknown, which is the answer that matters most: a
 * stranger must come back as nobody rather than as whoever the list starts
 * with.
 */
export function roleFor(
  email: string,
  users: readonly DemoUser[] = DEMO_USERS,
): DemoRole | undefined {
  return find(email, users)?.role;
}

/**
 * One demo user by address, matched case-insensitively.
 *
 * An identity provider may hand back `Admin@…` for someone seeded as
 * `admin@…`, and a case-sensitive lookup would read that as a different person
 * and silently strip their access. Shared by both lookups so they cannot come
 * to disagree about who somebody is.
 */
function find(email: string, users: readonly DemoUser[]): DemoUser | undefined {
  const normalized = email.toLowerCase();

  return users.find((candidate) => candidate.email.toLowerCase() === normalized);
}
