import type { SourceConfig } from "@cg-link/org-sync/types";
import { isConnectable } from "@cg-link/org-sync/utils";

/**
 * The systems Link reads and writes, plus the ones it only names.
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
 *
 * The `coming-soon` entries below are named and not wired up. A picker with two
 * rows in it does not look like a network a nonprofit would recognise, and the
 * honest way to show the shape of one is to list systems that really exist and
 * say on the row that this demo cannot connect them yet.
 */
export const SOURCES: readonly SourceConfig[] = [
  {
    id: "portal",
    label: "GrantPortal",
    website: "grantportal.example.gov",
    baseUrl: "http://localhost:5173",
    authorizeUrl: "http://localhost:5173/oauth/authorize",
    tokenUrl: "http://localhost:5173/token",
    capabilities: { read: true, write: true },
  },
  {
    id: "funderhub",
    label: "FunderHub",
    website: "funderhub.example.org",
    baseUrl: "http://localhost:5174",
    authorizeUrl: "http://localhost:5174/oauth/authorize",
    tokenUrl: "http://localhost:5174/token",
    capabilities: { read: true, write: true },

    // What FunderHub will not store, written out here by hand.
    //
    // This is Link-level knowledge and a straight duplicate of the list
    // FunderHub itself enforces — smoke and mirrors, honestly. The protocol
    // does not define a way for a system to publish what it can store in
    // v0.4.0, so the alternatives are to duplicate it or to let someone click
    // Sync and be told afterwards that the field went nowhere.
    //
    // The duplication is safe because the server's rule remains the
    // authoritative one: a field named here is never sent, and a field this
    // list gets wrong can only ever over-block. Anything it misses is still
    // dropped by FunderHub and named in the sentence it returns.
    unwritableFields: ["socials", "yearFounded", "orgType"],
  },

  {
    // Not a CommonGrants-native system at all: an adapter in front of a vendor
    // who has never heard of the protocol, which is the whole reason it is
    // here. From this registry's point of view that is invisible — same
    // routes, same flow, one more entry — and that invisibility is the claim
    // the demo is making.
    id: "temelio",
    label: "Temelio",
    website: "temelio.com",
    baseUrl: "http://localhost:5175",
    authorizeUrl: "http://localhost:5175/oauth/authorize",
    tokenUrl: "http://localhost:5175/token",

    // Writable as of #1190-T4. A push lands as a merge write against the
    // vendor's own API, which is the point the whole adapter is making: a
    // system nobody built for this contract can still receive a change through
    // it.
    capabilities: { read: true, write: true },

    // The two the adapter declines, for the same reason FunderHub's are here:
    // a funder cannot rename a grantee through the vendor's API, and the
    // vendor has no field that maps to `orgType`. Kept in step with
    // `apps/temelio-adapter/src/lib/server/store.ts` by hand, and safe the
    // same way — the adapter still says so itself if this list is wrong.
    unwritableFields: ["name", "orgType"],
  },

  // Named, not wired up. Every one of these is a real product, listed the way
  // Plaid lists a bank it has not integrated: the name and the site, and a row
  // that will not start a flow.
  //
  // `baseUrl` is a `.invalid` host on purpose. The field is required, there is
  // no API origin to give, and `.invalid` is reserved by RFC 2606 precisely so
  // it can never resolve — so a bug that got past `isConnectable` and tried to
  // contact one of these fails immediately and loudly rather than reaching
  // some real company's servers.
  comingSoon("simpler-grants", "SimplerGrants", "simpler.grants.gov"),
  comingSoon("fluxx", "Fluxx", "fluxx.io"),
  comingSoon("submittable", "Submittable", "submittable.com"),
  comingSoon("foundant", "Foundant GLM", "foundant.com"),
];

/** One of the systems the picker names but cannot connect. */
function comingSoon(id: string, label: string, website: string): SourceConfig {
  return { id, label, website, baseUrl: `https://${id}.invalid`, status: "coming-soon" };
}

/**
 * The sources the demo actually talks to.
 *
 * `isConnectable` is the library's rule, not a local one, so this and the
 * fan-out agree by construction — a `coming-soon` entry is skipped by both,
 * and the route cannot forget to filter.
 */
export function enabledSources(): readonly SourceConfig[] {
  return SOURCES.filter(isConnectable);
}

/**
 * Every source the picker lists, connectable or not.
 *
 * Distinct from `enabledSources` because the picker's job is to show the
 * network and `enabled: false` is the one thing it still hides — that flag
 * means "committed as configuration but out of this demo", which is different
 * from "named so people can see it is coming".
 */
export function catalogSources(): readonly SourceConfig[] {
  return SOURCES.filter((source) => source.enabled !== false);
}

/**
 * One source by id, or `undefined` if it is not one this widget can connect.
 *
 * Built on `enabledSources`, so that now covers three cases: not in the
 * registry at all, `enabled: false`, and `coming-soon`. The last is why
 * `/api/connect/start` refuses a named-but-unwired system without a check of
 * its own.
 */
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
