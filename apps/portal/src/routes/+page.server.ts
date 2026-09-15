import { PORTAL_ORG_ID } from "@cg-link/seed";
import { store } from "$lib/server/store.js";
import type { PageServerLoad } from "./$types.js";

/**
 * The seeded organization this system's profile link points at.
 *
 * Resolved here rather than in the page so the seed's three profiles stay out
 * of the browser bundle for the sake of one id, and read through the store so
 * the link is labelled with the name the system currently holds rather than
 * the one it started with.
 */
export const load: PageServerLoad = async () => {
  const org = await store.read(PORTAL_ORG_ID);

  return { profile: org ? { id: org.id, name: org.name } : null };
};
