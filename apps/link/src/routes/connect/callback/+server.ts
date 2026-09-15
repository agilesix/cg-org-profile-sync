import { json } from "@sveltejs/kit";
import { CLIENT_ID, connectRedirectUri, sourceById } from "$lib/server/sources.js";
import { connectCookieName, readAttempt } from "$lib/server/connect.js";
import type { RequestHandler } from "./$types.js";

/**
 * `GET /connect/callback` — where a system sends its authorization code.
 *
 * The code is exchanged here, server to server, rather than in the browser:
 * the portals put no CORS headers on `/token`, and the verifier lives in an
 * `HttpOnly` cookie the page cannot read anyway.
 *
 * Two exits, because Link runs two ways. Embedded (#1189-T2) the flow happens
 * in a popup, so the token is posted to the opener and the popup closes.
 * Standalone it happens in the tab itself, so the token goes into
 * `sessionStorage` and the tab returns to the widget. `Accept:
 * application/json` takes a third exit for the e2e suite, which needs a token
 * without driving a browser.
 */
export const GET: RequestHandler = async ({ url, cookies, request, fetch }) => {
  const state = url.searchParams.get("state") ?? "";
  const attempt = state ? readAttempt(cookies.get(connectCookieName(state))) : undefined;

  // Consumed either way: an attempt is good for exactly one callback.
  if (state) {
    cookies.delete(connectCookieName(state), { path: "/" });
  }

  const result = await resolve(url, attempt, fetch);

  return wantsJson(request)
    ? json(result, { status: "problem" in result ? 400 : 200 })
    : page(result, attempt?.returnTo ?? "/");
};

/** What a finished attempt amounts to. */
type ConnectResult =
  { sourceId: string; token: string } | { sourceId: string; denied: true } | { problem: string };

/** Turn the callback into one of those three, without throwing. */
async function resolve(
  url: URL,
  attempt: ReturnType<typeof readAttempt>,
  fetch: typeof globalThis.fetch,
): Promise<ConnectResult> {
  if (!attempt) {
    // A `state` we never issued, or one whose cookie has aged out. Both mean
    // the same thing to the person: start again.
    return { problem: "That sign-in attempt has expired. Close this and try connecting again." };
  }

  const source = sourceById(attempt.sourceId);

  if (!source?.tokenUrl) {
    return { problem: "That system is no longer configured." };
  }

  const refused = url.searchParams.get("error");

  if (refused) {
    // `access_denied` is the demo's negative beat, not a failure: the person
    // signed in fine, and this system simply has no organization for them.
    // Reported as a state of that source, so the widget can say so in its
    // column rather than raising a banner.
    return { sourceId: source.id, denied: true };
  }

  const code = url.searchParams.get("code");

  if (!code) {
    return { problem: "That system sent back neither a code nor a reason." };
  }

  try {
    const response = await fetch(source.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: connectRedirectUri(url.origin),
        code_verifier: attempt.verifier,
        client_id: CLIENT_ID,
      }),
    });

    const body: unknown = await response.json();
    const token = (body as { access_token?: unknown } | null)?.access_token;

    if (!response.ok || typeof token !== "string") {
      return { problem: `${source.label} would not issue a token for that sign-in.` };
    }

    return { sourceId: source.id, token };
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);

    return { problem: `${source.label} could not be reached: ${detail}` };
  }
}

/** True when the caller wants the result rather than a page — the e2e suite. */
function wantsJson(request: Request): boolean {
  return (request.headers.get("accept") ?? "").includes("application/json");
}

/**
 * The tiny page that hands the result to whichever window is listening.
 *
 * The result is embedded as JSON in a `type="application/json"` block and
 * parsed, rather than interpolated into the script itself: a token is opaque
 * text from another system, and building JavaScript out of it by concatenation
 * is how that stops being safe.
 */
function page(result: ConnectResult, returnTo: string): Response {
  const body = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Connecting…</title>
  </head>
  <body>
    <p id="message">Finishing up…</p>
    <script type="application/json" id="result">${jsonForScript(result)}</script>
    <script type="application/json" id="return-to">${jsonForScript(returnTo)}</script>
    <script>
      (function () {
        var result = JSON.parse(document.getElementById("result").textContent);
        var returnTo = JSON.parse(document.getElementById("return-to").textContent);

        if (result.problem) {
          document.getElementById("message").textContent = result.problem;
          return;
        }

        // Embedded: the flow ran in a popup, so the opener is the widget.
        // Targeted at this exact origin so the token cannot be posted anywhere
        // else, and so the listener can check where it came from.
        if (window.opener) {
          window.opener.postMessage(
            { type: "cg-link:connect", sourceId: result.sourceId, token: result.token || null,
              denied: Boolean(result.denied) },
            window.location.origin,
          );
          window.close();
          return;
        }

        try {
          if (result.denied) {
            sessionStorage.setItem("link:denied:" + result.sourceId, "1");
          } else {
            sessionStorage.setItem("link:token:" + result.sourceId, result.token);
            sessionStorage.removeItem("link:denied:" + result.sourceId);
          }
        } catch (e) {
          // Private browsing, or storage switched off. The widget still opens;
          // it simply will not remember this system.
        }

        location.replace(returnTo);
      })();
    </script>
  </body>
</html>`;

  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

/** JSON safe to sit inside a `<script>` block. */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
