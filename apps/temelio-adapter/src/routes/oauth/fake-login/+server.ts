import { fakeLoginPage } from "@cg-link/org-sync/server";
import { error } from "@sveltejs/kit";
import { usingFakeIdentity } from "$lib/server/oauth.js";
import type { RequestHandler } from "./$types.js";

/**
 * `GET /oauth/fake-login` — a form that stands in for Google.
 *
 * Behind `IDENTITY_PROVIDER=fake`, and 404 otherwise, for the same reason the
 * portals' is: a sign-in page that accepts any address on request is not a
 * thing to advertise.
 */
export const GET: RequestHandler = ({ url }) => {
  if (!usingFakeIdentity()) {
    error(404, "Not Found");
  }

  return fakeLoginPage(url.searchParams.get("state") ?? "", {
    loginHint: url.searchParams.get("login_hint") ?? undefined,
    systemLabel: "Temelio",
  });
};
