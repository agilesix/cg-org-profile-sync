import { PORTAL_SEED } from "@cg-link/seed";
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
export const SYSTEM_ID = "portal";

/**
 * GrantPortal's copy of the org profiles.
 *
 * Module-level, so it is created once per Worker isolate and every request in
 * that isolate sees the same writes. Nothing outlives the isolate — which is
 * the whole of this system's durability story for the demo, and the reason the
 * store sits behind an interface a D1-backed one can take over.
 */
export const store = new MemoryOrgStore([PORTAL_SEED]);

/**
 * What the shared handlers need to know about this system.
 *
 * No `unwritableFields`: GrantPortal is the full-coverage system in the demo,
 * so it stores every field the protocol models. FunderHub is the one that
 * declines things.
 */
const orgRoutes: OrgRoutesConfig = { store, source: SYSTEM_ID };

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
