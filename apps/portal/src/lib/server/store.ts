import { PORTAL_SEED } from "@cg-link/seed";
import { MemoryOrgStore, type OrgRoutesConfig } from "@cg-link/org-sync/server";

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
export const orgRoutes: OrgRoutesConfig = { store, source: "portal" };
