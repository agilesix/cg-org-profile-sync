import { FUNDERHUB_SEEDS, FUNDERHUB_UNWRITABLE_FIELDS } from "@cg-link/seed";
import {
  MemoryOrgStore,
  scopedStore,
  type OrgRoutesConfig,
  type Principal,
} from "@cg-link/org-sync/server";

/**
 * This system's id.
 *
 * One constant for two jobs that have to agree: the `source` recorded on every
 * change this system applies, and the `aud` every access token it accepts must
 * name. A token minted for another system names another audience and is
 * refused here, which is the whole point of minting one per system.
 */
export const SYSTEM_ID = "funderhub";

/**
 * FunderHub's copy of the org profiles.
 *
 * Module-level, so it is created once per Worker isolate and every request in
 * that isolate sees the same writes. Nothing outlives the isolate — which is
 * the whole of this system's durability story for the demo, and the reason the
 * store sits behind an interface a D1-backed one can take over.
 *
 * Three organizations, Agile Six first, the same as GrantPortal — but with
 * FunderHub's own record ids, since no two systems agree on those.
 */
export const store = new MemoryOrgStore(FUNDERHUB_SEEDS);

/**
 * What the shared handlers need to know about this system.
 *
 * The `unwritableFields` are what makes FunderHub interesting: it is the
 * partial-coverage vendor, so a patch setting `socials` is accepted, dropped,
 * and named back to the sender rather than rejected. GrantPortal declares none.
 */
const orgRoutes: OrgRoutesConfig = {
  store,
  source: SYSTEM_ID,
  unwritableFields: FUNDERHUB_UNWRITABLE_FIELDS,
};

/**
 * This system's org routes, narrowed to whoever the request is.
 *
 * Every handler goes through here rather than through `orgRoutes` directly, so
 * a route cannot serve the unscoped store by forgetting to wrap it. An absent
 * principal — a route somehow reached without passing the guard — is granted
 * nothing, so the mistake shows up as an empty list rather than as everything.
 */
export function routesFor(principal: Principal | undefined): OrgRoutesConfig {
  return { ...orgRoutes, store: scopedStore(store, principal) };
}
