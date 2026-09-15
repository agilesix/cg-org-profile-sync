import { capabilitiesOf, isConnectable } from "@cg-link/org-sync/utils";
import { DEFAULT_EIN, EIN_REGISTRY } from "$lib/demo.js";
import { catalogSources } from "$lib/server/sources.js";
import type { PageServerLoad } from "./$types.js";

/**
 * What the page needs before anyone has linked anything.
 *
 * Not a comparison, and no longer even a connect list. The widget opens on a
 * title and one button, because Link holds no credentials of its own — until
 * the person has signed in with a system there is nothing to read and nobody
 * to read it as. Everything after that button happens in the modal.
 *
 * The catalog still comes from the server, because the modal has to render the
 * whole list the moment it opens. It is the picker's contents, not a secret:
 * names, sites, and whether each can be connected yet.
 *
 * `?registry=` and `?id=` are still honoured so a demo can be deep-linked at a
 * particular org, and they survive the sign-in round trip because the connect
 * flow carries them back.
 */
export const load: PageServerLoad = ({ url }) => {
  const registry = url.searchParams.get("registry") || EIN_REGISTRY;
  const id = url.searchParams.get("id") || DEFAULT_EIN;

  // Only what the browser has any use for. `baseUrl`, `authorizeUrl` and
  // `tokenUrl` stay on the server: the Connect control goes through Link's own
  // `/api/connect/start`, so the page never needs a system's address.
  const sources = catalogSources().map((source) => ({
    id: source.id,
    label: source.label,
    website: source.website ?? null,
    capabilities: capabilitiesOf(source),
    connectable: isConnectable(source),
  }));

  return { registry, id, sources };
};
