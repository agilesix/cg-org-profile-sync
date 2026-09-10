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
