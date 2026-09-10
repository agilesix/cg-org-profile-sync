import { StaticTokenProvider } from "@cg-link/org-sync/client";
import type { SourceConfig, TokenProvider } from "@cg-link/org-sync/types";
import { env } from "$env/dynamic/private";

/**
 * The systems Link reads and writes.
 *
 * The whole point of the contract is that this list is the only thing that
 * knows how many systems there are: every source speaks the identical
 * CommonGrants org routes, so a third one joins as an entry here rather than as
 * new code. Origins are the dev-server ports from each app's `vite.config.ts`.
 */
export const SOURCES: readonly SourceConfig[] = [
  {
    id: "portal",
    label: "GrantPortal",
    baseUrl: "http://localhost:5173",
  },
  {
    id: "funderhub",
    label: "FunderHub",
    baseUrl: "http://localhost:5174",
    // No `writableFields`, which means "this source accepts every field".
    // FunderHub actually declines `socials`, `yearFounded` and `orgType`, but
    // `SourceConfig.writableFields` is an allowlist, and an allowlist can only
    // be written here by hand-inverting the schema's field set — a second list
    // that drifts the moment the protocol adds a field. The authoritative
    // signal is the sentence FunderHub returns on a patch, which `syncToTargets`
    // already passes through verbatim. A UI that wants to grey a field out
    // ahead of time (#1153-T7) should derive it rather than read it from here.
  },
  // A third system joins by uncommenting this — no other file changes. Set
  // `enabled: false` instead to keep an entry in the registry but out of the
  // demo, which is how a source that is not answering yet gets committed.
  // {
  //   id: "temelio",
  //   label: "Temelio",
  //   baseUrl: "http://localhost:5175",
  //   enabled: false,
  // },
];

/** Which env var holds each source's bearer token. */
const TOKEN_VARS: Readonly<Record<string, string>> = {
  portal: "PORTAL_ACCESS_TOKEN",
  funderhub: "FUNDERHUB_ACCESS_TOKEN",
};

/**
 * Read every configured source's token out of the environment.
 *
 * Called per request, not once at module load: `$env/dynamic/private` is only
 * populated inside a request on the Workers runtime, so a module-level read
 * would come back empty in a deployed isolate.
 *
 * A source whose variable is unset is left out of the map rather than given an
 * empty token. `StaticTokenProvider` then fails that source with "no access
 * token is configured", which is the sentence someone who forgot their `.env`
 * needs — an empty bearer would instead come back as an opaque 401 from the
 * far end.
 */
export function tokenProvider(): TokenProvider {
  const tokens: Record<string, string> = {};

  for (const source of SOURCES) {
    const variable = TOKEN_VARS[source.id];
    const token = variable === undefined ? undefined : env[variable];

    if (token) {
      tokens[source.id] = token;
    }
  }

  return new StaticTokenProvider(tokens);
}
