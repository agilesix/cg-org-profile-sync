import {
  FakeIdentityProvider,
  GoogleIdentityProvider,
  type IdentityProvider,
  type OAuthConfig,
} from "@cg-link/org-sync/server";
import { demoUsers, roleFor } from "@cg-link/seed";
import { env } from "$env/dynamic/private";
import { signingKey } from "./keys.js";
import { servedOrgIds, SYSTEM_ID } from "./store.js";

/**
 * This system as an OAuth authorization server.
 *
 * The same shape the two portals use, with one difference that matters: the
 * grants cannot come from the seed. A portal knows its own org ids because it
 * seeded them; this adapter's ids are whatever Temelio assigned the grantees
 * in `TEMELIO_ORG_ALLOWLIST`, which no seed has heard of. So it asks the seed
 * only who this person is, and decides for itself what they may touch here.
 */

/** True when this system is running the dev-only fake identity provider. */
export function usingFakeIdentity(): boolean {
  return env.IDENTITY_PROVIDER === "fake";
}

/**
 * What the OAuth handlers need to know about this system, or `undefined` when
 * it has no signing key and so cannot mint anything.
 */
export async function oauthConfig(url: URL): Promise<OAuthConfig | undefined> {
  const key = await signingKey();

  if (!key) {
    return undefined;
  }

  const users = demoUsers({
    admin: env.DEMO_ADMIN_EMAIL,
    "portal-only": env.DEMO_PORTAL_ONLY_EMAIL,
  });

  return {
    key,
    systemId: SYSTEM_ID,
    issuer: env.SYSTEM_ORIGIN || url.origin,
    identity: identityProvider(),
    redirectUris: env.LINK_ORIGIN
      ? [`${env.LINK_ORIGIN.replace(/\/+$/, "")}/connect/callback`]
      : [],

    // The admin gets every grantee this adapter serves; everybody else gets
    // nothing, and Temelio refuses them the way FunderHub does. That is the
    // beat the demo turns on, and it has to hold for a system whose records we
    // do not own as much as for the two we do.
    grantsFor: (email) => (roleFor(email, users) === "admin" ? servedOrgIds() : []),
    onProblem: (problem, cause) => {
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
