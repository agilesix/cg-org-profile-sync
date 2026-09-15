import { capabilitiesOf, originIfAllowed } from "@cg-link/org-sync/utils";
import { DEFAULT_EIN, EIN_REGISTRY } from "$lib/demo.js";
import { embedOrigins } from "$lib/server/embed.js";
import { enabledSources } from "$lib/server/sources.js";
import type { PageServerLoad } from "./$types.js";

/**
 * What the page needs before anyone has connected anything.
 *
 * No longer a comparison. The widget now opens on the list of systems it can
 * talk to, because it holds no credentials of its own — until the person has
 * signed in with at least one, there is nothing to read and nobody to read it
 * as. That is the Plaid pattern, and it wants the connect list first anyway.
 *
 * `?registry=` and `?id=` are still honoured so a demo can be deep-linked at a
 * particular org, and they survive the sign-in round trip because the connect
 * flow carries them back.
 *
 * `?host=` and `?parent=` are how the embed loader introduces the page around
 * it. Both are judged here rather than trusted: `host` has to name a system
 * this Link is configured for, and `parent` has to be an origin this Link
 * allows to frame it. Either one unrecognised comes back as `null`, which the
 * page reads as "standalone" — the safe end of the guess.
 */
export const load: PageServerLoad = ({ url }) => {
  const registry = url.searchParams.get("registry") || EIN_REGISTRY;
  const id = url.searchParams.get("id") || DEFAULT_EIN;

  // Only what the browser has any use for. `baseUrl`, `authorizeUrl` and
  // `tokenUrl` stay on the server: the Connect control goes through Link's own
  // `/api/connect/start`, so the page never needs a system's address.
  const sources = enabledSources().map((source) => ({
    id: source.id,
    label: source.label,
    capabilities: capabilitiesOf(source),
  }));

  const requestedHost = url.searchParams.get("host");
  const host = sources.find((source) => source.id === requestedHost) ?? null;

  return {
    registry,
    id,
    sources,

    /** The system whose page is framing us, when it is one we know. */
    host: host && { id: host.id, label: host.label },

    /**
     * Where a message to the host may be posted, or `null`.
     *
     * Resolved on the server so the page has nothing to decide: a `parent` the
     * deployment did not allow never reaches the browser, so there is no way
     * for a later edit to the component to start trusting it by accident.
     */
    parentOrigin: originIfAllowed(url.searchParams.get("parent"), embedOrigins()) ?? null,
  };
};
