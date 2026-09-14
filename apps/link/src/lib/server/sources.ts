import type { SourceConfig } from "@cg-link/org-sync/types";

/**
 * The systems Link reads and writes.
 *
 * The whole point of the contract is that this list is the only thing that
 * knows how many systems there are: every source speaks the identical
 * CommonGrants org routes, so a third one joins as an entry here rather than as
 * new code. Origins are the dev-server ports from each app's `vite.config.ts`.
 *
 * Link holds no credentials of its own any more. Each system issues its own
 * token through its own OAuth flow, the browser keeps them for the session, and
 * Link forwards them — so what used to be a pair of variables in Link's `.env`
 * is now `authorizeUrl` and `tokenUrl` per entry.
 */
export const SOURCES: readonly SourceConfig[] = [
  {
    id: "portal",
    label: "GrantPortal",
    baseUrl: "http://localhost:5173",
    authorizeUrl: "http://localhost:5173/oauth/authorize",
    tokenUrl: "http://localhost:5173/token",
    capabilities: { read: true, write: true },
  },
  {
    id: "funderhub",
    label: "FunderHub",
    baseUrl: "http://localhost:5174",
    authorizeUrl: "http://localhost:5174/oauth/authorize",
    tokenUrl: "http://localhost:5174/token",
    capabilities: { read: true, write: true },
    // No `writableFields`, which means "this source accepts every field".
    // FunderHub actually declines `socials`, `yearFounded` and `orgType`, but
    // `SourceConfig.writableFields` is an allowlist, and an allowlist can only
    // be written here by hand-inverting the schema's field set — a second list
    // that drifts the moment the protocol adds a field. The authoritative
    // signal is the sentence FunderHub returns on a patch, which `syncToTargets`
    // already passes through verbatim.
    //
    // `capabilities` is the coarser statement — whether this system can be read
    // from and written to at all — and is what the connect screen labels each
    // source with. #1191-T2 is where a field-level "cannot store this" greys
    // out the Sync button ahead of time.
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

/** The sources the demo is actually talking to. */
export function enabledSources(): readonly SourceConfig[] {
  return SOURCES.filter((source) => source.enabled !== false);
}

/** One source by id, or `undefined` if it is not in the registry or is disabled. */
export function sourceById(id: string | null): SourceConfig | undefined {
  return id === null ? undefined : enabledSources().find((source) => source.id === id);
}

/**
 * Where every system sends an authorization code back to.
 *
 * Built from the request's own origin rather than configured, so a checkout on
 * another port needs no second variable — but it has to match the
 * `LINK_ORIGIN` each portal registered, or the portal refuses the request
 * before the person ever sees a sign-in page.
 */
export function connectRedirectUri(origin: string): string {
  return `${origin}/connect/callback`;
}

/** The client id every system in this demo knows Link by. */
export const CLIENT_ID = "link";
