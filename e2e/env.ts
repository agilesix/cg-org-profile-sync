import { DEMO_USERS, FUNDERHUB_SEEDS, PORTAL_SEEDS, type DemoRole } from "@cg-link/seed";

/**
 * Where the three demo apps live, and what the suite looks the org up by.
 *
 * One module so a port lives in exactly two places — an app's `vite.config.ts`
 * and here — rather than being sprinkled through the config and every spec.
 * These are the same origins `apps/link/src/lib/server/sources.ts` registers,
 * because Link's fan-out and this suite have to be talking to the same pair of
 * systems for any of it to mean anything.
 */

/** GrantPortal: the system holding the current copy of the profile. */
export const PORTAL_ORIGIN = "http://localhost:5173";

/** FunderHub: the partial-coverage system, a suite number behind. */
export const FUNDERHUB_ORIGIN = "http://localhost:5174";

/** Link: the widget, and the only thing the specs make assertions against. */
export const LINK_ORIGIN = "http://localhost:5176";

/**
 * The systems that hold profiles, keyed by `SourceConfig.id`.
 *
 * Link is deliberately absent: it stores nothing, so it has nothing to reset.
 */
export const SYSTEM_ORIGINS: Readonly<Record<string, string>> = {
  portal: PORTAL_ORIGIN,
  funderhub: FUNDERHUB_ORIGIN,
};

/**
 * The registry the widget matches one org across systems by.
 *
 * Re-exported from the library rather than spelled again here: the suite and
 * the thing it is testing have to agree on this string, and two copies is one
 * chance to drift.
 */
export { EIN_REGISTRY } from "@cg-link/org-sync/utils";
import { EIN_REGISTRY } from "@cg-link/org-sync/utils";

/**
 * The two people the demo signs in as, taken from the seed rather than spelled
 * again here.
 *
 * The portals resolve the same list, so the suite and the systems it drives
 * agree on who these people are by construction. A deployment that overrode
 * the addresses through `DEMO_ADMIN_EMAIL` / `DEMO_PORTAL_ONLY_EMAIL` would
 * break that agreement — which is one more reason the suite refuses to run
 * against a portal configured for anything but the fake provider.
 */
function emailFor(role: DemoRole): string {
  const user = DEMO_USERS.find((candidate) => candidate.role === role);

  if (!user) {
    throw new Error(`@cg-link/seed no longer defines a ${role} demo user`);
  }

  return user.email;
}

/** Granted the org on both systems. */
export const ADMIN_EMAIL = emailFor("admin");

/** Granted the org on GrantPortal and nothing on FunderHub — the demo's negative beat. */
export const PORTAL_ONLY_EMAIL = emailFor("portal-only");

/**
 * The organization GrantPortal holds and FunderHub has never heard of.
 *
 * Derived from the seeds rather than named, so it follows them if the demo
 * data changes. This is what makes the organization step's "no organization
 * with that EIN" reachable from a browser: link this one first, then sign in
 * to FunderHub and there is nothing there it could be.
 */
function onlyOnPortal(): { id: string; ein: string; name: string } {
  const funderhubEins = new Set(
    FUNDERHUB_SEEDS.map((seed) => seed.identifiers?.[EIN_REGISTRY]?.id),
  );

  for (const seed of PORTAL_SEEDS) {
    const ein = seed.identifiers?.[EIN_REGISTRY]?.id;

    if (ein !== undefined && !funderhubEins.has(ein)) {
      return { id: seed.id, ein, name: seed.name };
    }
  }

  throw new Error("every GrantPortal org is also on FunderHub, so the no-match beat cannot be run");
}

export const PORTAL_ONLY_ORG = onlyOnPortal();
