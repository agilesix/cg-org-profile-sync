import { createPkcePair } from "@cg-link/org-sync/client";
import { sameOriginPath } from "@cg-link/org-sync/utils";
import { error, redirect } from "@sveltejs/kit";
import { CLIENT_ID, connectRedirectUri, sourceById } from "$lib/server/sources.js";
import { CONNECT_TTL_SECONDS, connectCookieName } from "$lib/server/connect.js";
import type { RequestHandler } from "./$types.js";

/**
 * `GET /api/connect/start?source=<id>` — begin one system's OAuth flow.
 *
 * The PKCE verifier is generated here and kept in an `HttpOnly` cookie rather
 * than handed to the page: the browser half never needs it, and a verifier the
 * page could read is one a script on the page could steal along with the code.
 *
 * `SameSite=Lax` is enough because the cookie is set in the very window that
 * will receive the callback — the tab, or the popup when Link is embedded —
 * and a top-level GET redirect back from the portal carries Lax cookies.
 */
export const GET: RequestHandler = async ({ url, cookies }) => {
  const source = sourceById(url.searchParams.get("source"));

  if (!source?.authorizeUrl) {
    error(400, "That is not a system this widget is configured to connect to.");
  }

  const { verifier, challenge } = await createPkcePair();
  const state = crypto.randomUUID();

  cookies.set(
    connectCookieName(state),
    JSON.stringify({ sourceId: source.id, verifier, returnTo: safeReturnTo(url) }),
    {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: url.protocol === "https:",
      maxAge: CONNECT_TTL_SECONDS,
    },
  );

  const authorize = new URL(source.authorizeUrl);

  authorize.searchParams.set("client_id", CLIENT_ID);
  authorize.searchParams.set("redirect_uri", connectRedirectUri(url.origin));
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "S256");
  authorize.searchParams.set("state", state);

  const loginHint = url.searchParams.get("login_hint");

  if (loginHint) {
    // Passed through so connecting the second system is one click rather than
    // a second sign-in.
    authorize.searchParams.set("login_hint", loginHint);
  }

  redirect(302, authorize.toString());
};

/**
 * Where to send the browser once the flow finishes.
 *
 * Only a path on Link's own origin. This value comes off a query string and
 * ends up in a redirect, so anything else makes this route an open redirect —
 * and the obvious check for it does not work: `/\evil.test` starts with one
 * slash and not two, and the URL parser still resolves it to another origin.
 * `sameOriginPath` decides by parsing, which is what the browser will do.
 */
function safeReturnTo(url: URL): string {
  const requested = url.searchParams.get("return");

  return (requested ? sameOriginPath(requested, url.origin) : undefined) ?? "/";
}
