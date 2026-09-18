import { failure } from "@cg-link/org-sync/server";
import { env } from "$env/dynamic/private";
import { error } from "@sveltejs/kit";
import { resetFixture } from "$lib/server/store.js";
import type { RequestHandler } from "./$types.js";

/**
 * `POST /__test/reset` — put the fake Temelio back to its seed.
 *
 * Behind `ENABLE_TEST_ROUTES`, like the two portals'. The difference is what
 * happens in sandbox mode: there is no reset to give, because the records live
 * in a system shared with other people, so this refuses rather than answering
 * 204 to something it did not do. A spec that believed it had isolation it did
 * not have would fail later, somewhere else, for a reason nobody could see.
 *
 * This is the only way the suite can meet a sandbox adapter: it pins
 * `TEMELIO_MODE=fixture` on one it starts, so the case left is a server it
 * joined — a `pnpm dev` running the demo. Hence the remedy in the sentence.
 */
export const POST: RequestHandler = () => {
  if (env.ENABLE_TEST_ROUTES !== "true") {
    error(404, "Not Found");
  }

  return resetFixture()
    ? new Response(null, { status: 204 })
    : failure(
        409,
        "This adapter is in sandbox mode, and Temelio's own records cannot be reset. " +
          "The e2e suite pins TEMELIO_MODE=fixture on an adapter it starts itself, so " +
          "stop this dev server and re-run it — or set TEMELIO_MODE=fixture here.",
      );
};
