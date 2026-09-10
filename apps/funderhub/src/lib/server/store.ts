import { FUNDERHUB_SEED, FUNDERHUB_UNWRITABLE_FIELDS } from "@cg-link/seed";
import { MemoryOrgStore, type OrgRoutesConfig } from "@cg-link/org-sync/server";

/**
 * FunderHub's copy of the org profiles.
 *
 * Module-level, so it is created once per Worker isolate and every request in
 * that isolate sees the same writes. Nothing outlives the isolate — which is
 * the whole of this system's durability story for the demo, and the reason the
 * store sits behind an interface a D1-backed one can take over.
 */
export const store = new MemoryOrgStore([FUNDERHUB_SEED]);

/**
 * What the shared handlers need to know about this system.
 *
 * The `unwritableFields` are what makes FunderHub interesting: it is the
 * partial-coverage vendor, so a patch setting `socials` is accepted, dropped,
 * and named back to the sender rather than rejected. GrantPortal declares none.
 */
export const orgRoutes: OrgRoutesConfig = {
  store,
  source: "funderhub",
  unwritableFields: FUNDERHUB_UNWRITABLE_FIELDS,
};
