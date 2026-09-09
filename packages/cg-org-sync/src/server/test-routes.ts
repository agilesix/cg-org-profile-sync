import type { ResettableOrgStore } from "./store.js";

/**
 * The shared body of each system's `POST /__test/reset`.
 *
 * Test-only code inside the library, which is a trade rather than an accident:
 * the end-to-end suite needs every system back at its seed between specs, and
 * the alternative is each app hand-rolling the same three lines. Nothing mounts
 * this by itself — an app has to wire it to a route, and gating that route
 * behind an environment flag so it cannot exist in a deployed Worker is the
 * app's job.
 */
export async function resetStore(store: ResettableOrgStore): Promise<Response> {
  await store.reset();

  return new Response(null, { status: 204 });
}
