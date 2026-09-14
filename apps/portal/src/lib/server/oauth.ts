import {
  FakeIdentityProvider,
  GoogleIdentityProvider,
  type IdentityProvider,
  type OAuthConfig,
} from "@cg-link/org-sync/server";
import { demoUsers, grantsFor } from "@cg-link/seed";
import { env } from "$env/dynamic/private";
import { signingKey } from "./keys.js";
import { SYSTEM_ID } from "./store.js";

/**
 * This system as an OAuth authorization server.
 *
 * Built per request rather than once at module load, for the same reason the
 * signing key is: `$env/dynamic/private` is only populated inside a request on
 * the Workers runtime, so anything read at module load comes back empty.
 *
 * Note the variable is `SYSTEM_ORIGIN`, not `PUBLIC_ORIGIN`. SvelteKit's
 * `$env/dynamic/private` deliberately excludes everything starting with
 * `PUBLIC_`, so a variable by that name would always read as unset here.
 */

/** True when this system is running the dev-only fake identity provider. */
export function usingFakeIdentity(): boolean {
  return env.IDENTITY_PROVIDER === "fake";
}

/**
 * What the OAuth handlers need to know about this system, or `undefined` when
 * it has no signing key and so cannot mint anything.
 *
 * `url` supplies the origin when `SYSTEM_ORIGIN` is unset, which keeps a local
 * checkout working without one. A deployment behind a proxy should set it:
 * the origin ends up in the callback URL Google is asked to return to, and
 * Google matches that against the client's registered URIs exactly.
 */
export async function oauthConfig(url: URL): Promise<OAuthConfig | undefined> {
  const key = await signingKey();

  if (!key) {
    return undefined;
  }

  // The demo's two people, with whatever addresses this deployment gave them.
  // Resolved per request so the day-before decision is a restart, not a build.
  const users = demoUsers({
    admin: env.DEMO_ADMIN_EMAIL,
    "portal-only": env.DEMO_PORTAL_ONLY_EMAIL,
  });

  return {
    key,
    systemId: SYSTEM_ID,
    issuer: env.SYSTEM_ORIGIN || url.origin,
    identity: identityProvider(),
    // One entry: Link is the only client, and the redirect is where the
    // authorization code goes. Unset, this list is empty and every authorize
    // request is refused, which is the right way round to fail — and
    // `onProblem` below says so in the log, since from the outside that looks
    // like the client's mistake rather than a missing variable.
    //
    // Trimmed because this is compared to what Link sends as an exact string:
    // a trailing slash here would refuse every request with a message about
    // the `redirect_uri` being unregistered.
    redirectUris: env.LINK_ORIGIN ? [`${env.LINK_ORIGIN.replace(/\/+$/, "")}/oauth/callback`] : [],
    grantsFor: (email) => grantsFor(SYSTEM_ID, email, users),
    onProblem: (problem, cause) => {
      // The client is told `access_denied` and nothing else, so this is the
      // only record of what actually happened. The Google path is the one that
      // needs it: no test can reach it, and a wrong client secret, an
      // unreachable JWKS and a skewed clock all look the same from outside.
      console.error(`OAuth: ${problem}.`);

      if (cause !== undefined) {
        console.error(cause);
      }
    },
  };
}

/** Google, or the stand-in that lets the demo and the e2e suite run offline. */
function identityProvider(): IdentityProvider {
  if (usingFakeIdentity()) {
    return new FakeIdentityProvider();
  }

  return new GoogleIdentityProvider({
    clientId: env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
  });
}
