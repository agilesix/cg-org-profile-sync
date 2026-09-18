import type { Handle } from "@sveltejs/kit";
import { frameAncestors } from "$lib/server/embed.js";

/**
 * Say who may frame the widget, on every page Link serves.
 *
 * A hook rather than SvelteKit's `kit.csp` config because the allow-list comes
 * from the environment: `svelte.config.js` is read at build time, and the
 * origins a deployment embeds into are not known then.
 *
 * Only on HTML. `frame-ancestors` is about documents, and putting a policy on
 * Link's JSON routes would be a line every reader of those responses has to
 * decide is irrelevant.
 */
export const handle: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);

  if ((response.headers.get("content-type") ?? "").startsWith("text/html")) {
    response.headers.set("content-security-policy", frameAncestors());
  }

  return response;
};
