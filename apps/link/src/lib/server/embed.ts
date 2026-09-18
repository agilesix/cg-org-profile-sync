import { env } from "$env/dynamic/private";
import { parseOriginList } from "@cg-link/org-sync/utils";

/**
 * Who may frame the widget, and how Link says so.
 *
 * One list with two jobs that have to agree: the `frame-ancestors` policy the
 * browser enforces, and the `?parent=` origin the page is willing to post a
 * message to. Configured once, read in both places, so a host that can frame
 * Link is exactly a host Link will talk back to.
 *
 * Read through a function rather than a module constant because
 * `$env/dynamic/private` is empty at module load under the Cloudflare adapter
 * — the same reason `$lib/server/oauth.ts` builds its config per request.
 */
export function embedOrigins(): string[] {
  return parseOriginList(env.EMBED_ALLOWED_ORIGINS);
}

/**
 * The `frame-ancestors` directive for this deployment.
 *
 * Fails closed: an unset variable yields `'self'` alone, so a Link nobody
 * configured can still be opened directly and cannot be framed by anyone. The
 * alternative default — no header at all — would let any page on the internet
 * frame the widget, which is the one mistake this is here to prevent.
 */
export function frameAncestors(): string {
  return ["frame-ancestors", "'self'", ...embedOrigins()].join(" ");
}
