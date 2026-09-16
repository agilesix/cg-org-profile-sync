/**
 * This system's store, and which Temelio it is talking to.
 *
 * The adapter runs in one of two modes. `sandbox` talks to Temelio's real API
 * with a foundation key; `fixture` answers from an in-memory fake of it. The
 * fake is not a test double bolted on here — it is how the demo runs on a
 * laptop with no vendor credential, and how `pnpm e2e` runs at all, so it is a
 * first-class mode rather than a fallback.
 */

import { TEMELIO_ORG_ID } from "@cg-link/seed";
import { scopedStore, type OrgRoutesConfig, type Principal } from "@cg-link/org-sync/server";
import { env } from "$env/dynamic/private";
import { TemelioHttpApi, type TemelioApi } from "./temelio/api.js";
import { FakeTemelioApi } from "./temelio/fixture.js";
import { TemelioOrgStore } from "./temelio/store.js";

/**
 * This system's id.
 *
 * The `source` recorded on every change and the `aud` every access token it
 * accepts must name. A token minted by GrantPortal names GrantPortal and is
 * refused here, which is the whole point of minting one per system.
 */
export const SYSTEM_ID = "temelio";

/** Which Temelio this adapter is in front of. */
export type TemelioMode = "fixture" | "sandbox";

interface Adapter {
  /** The env values this was built from, so a change rebuilds it. */
  builtFrom: string;
  mode: TemelioMode;
  api: TemelioApi;
  store: TemelioOrgStore;

  /** The grantees this adapter serves, which is also what the admin is granted. */
  allowlist: readonly string[];
}

/**
 * Built once per isolate, on the first request.
 *
 * Not at module load: `$env/dynamic/private` is empty until a request is in
 * flight on the Workers runtime, so anything read there comes back unset. And
 * not per request: in fixture mode the fake holds the writes, so rebuilding it
 * would throw away everything anyone had just done.
 */
let adapter: Adapter | undefined;

function current(): Adapter {
  const mode: TemelioMode = env.TEMELIO_MODE === "sandbox" ? "sandbox" : "fixture";
  const origin = env.TEMELIO_API_ORIGIN ?? "";
  const foundationId = env.TEMELIO_FOUNDATION_ID ?? "";
  const apiKey = env.TEMELIO_API_TOKEN ?? "";
  const configured = env.TEMELIO_ORG_ALLOWLIST ?? "";
  const builtFrom = JSON.stringify([mode, origin, foundationId, apiKey, configured]);

  if (adapter?.builtFrom === builtFrom) {
    return adapter;
  }

  const allowlist = configured
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  // Fixture mode knows which grantee it holds, so it needs no configuration to
  // be useful — which is what makes a fresh checkout work with no `.env` at
  // all beyond the mode.
  const serving = allowlist.length > 0 ? allowlist : mode === "fixture" ? [TEMELIO_ORG_ID] : [];

  const api =
    mode === "sandbox"
      ? new TemelioHttpApi({ origin, foundationId, apiKey, allowlist: serving })
      : new FakeTemelioApi();

  adapter = {
    builtFrom,
    mode,
    api,
    allowlist: serving,
    store: new TemelioOrgStore({ api, allowlist: serving }),
  };

  announce(adapter);

  return adapter;
}

/**
 * Say which Temelio this is, once, where a presenter will see it.
 *
 * A demo that silently ran on the fake when it was meant to be proving the
 * real integration would be the worst possible failure of this app — it would
 * look exactly like success. One line at start-up is the cheapest guard
 * against that, and it is why this is a `console.info` nobody can turn off
 * rather than a debug flag.
 */
function announce({ mode, allowlist }: Adapter): void {
  const identity = env.IDENTITY_PROVIDER === "fake" ? "the stand-in sign-in form" : "Google";

  console.info(
    `Temelio adapter: ${mode} mode, ${allowlist.length} grantee(s), signing people in with ${identity}.`,
  );

  if (mode === "sandbox" && allowlist.length === 0) {
    console.warn(
      "TEMELIO_ORG_ALLOWLIST is empty, so this adapter serves no organizations and will write to none.",
    );
  }
}

/** Which Temelio this adapter is in front of, for the landing page to say so. */
export function temelioMode(): TemelioMode {
  return current().mode;
}

/**
 * Fields this system accepts in a patch and cannot store.
 *
 * Declared rather than discovered, so the shared handler drops them and names
 * them in the response — the sender hears that the value went no further,
 * instead of reading "accepted" about a change that did not happen.
 *
 * `name` because a funder cannot rename its grantee through Temelio's API: it
 * accepts the field, answers 200, and stores nothing. That silent success is
 * precisely what this list exists to convert into a sentence.
 *
 * `orgType` because Temelio has no field for it. Its own entity type is a
 * two-value flag, and its legal status is free text — neither is a
 * Philanthropy Classification System term, and inventing one to round-trip
 * through would put a taxonomy code on a record nobody chose.
 *
 * Top-level keys only, which is all the protocol's own rule allows. So
 * `socials` is absent from this list even though Temelio stores only five of
 * its links: the alternative is blocking the website, which is the field the
 * demo is about.
 */
const UNWRITABLE_FIELDS = ["name", "orgType"] as const;

/**
 * What the shared handlers need to know about this system.
 */
export function routesFor(principal: Principal | undefined): OrgRoutesConfig {
  return {
    store: scopedStore(current().store, principal),
    source: SYSTEM_ID,
    unwritableFields: UNWRITABLE_FIELDS,
  };
}

/**
 * The organizations this adapter serves, which is what its admin is granted.
 *
 * Unlike the two portals, the grants cannot come from the seed: in sandbox
 * mode these ids are whatever Temelio assigned, and the seed has never heard
 * of them.
 */
export function servedOrgIds(): readonly string[] {
  return current().allowlist;
}

/**
 * Put the fake back to its seed, or refuse.
 *
 * `false` in sandbox mode, and the route turns that into a refusal rather than
 * a quiet no-op. Temelio's sandbox is a live system shared with other people:
 * there is no reset to give, and pretending otherwise would let a spec believe
 * it had isolation it did not have.
 */
export function resetFixture(): boolean {
  const { api, mode } = current();

  if (mode !== "fixture" || !(api instanceof FakeTemelioApi)) {
    return false;
  }

  api.reset();

  return true;
}
