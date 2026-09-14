/**
 * Deciding whether a URL someone handed us points back at us.
 *
 * In the library rather than in the app that needs it because `apps/*` has no
 * test harness, and this is precisely the check that cannot be eyeballed: the
 * obvious version — "starts with `/` but not `//`" — passes `/\evil.test`,
 * which the WHATWG URL parser folds into `https://evil.test/`. A redirect
 * target has to be judged by the same parser the browser will use, not by the
 * shape of the string.
 */

/**
 * `requested` as a path on `origin`, or `undefined` if it points anywhere else.
 *
 * Returns only the path and query, so the caller can redirect to it without
 * re-deciding anything. A fragment is dropped: it never reaches the server,
 * and carrying it adds a way to smuggle text into the redirect for nothing.
 */
export function sameOriginPath(requested: string, origin: string): string | undefined {
  let resolved: URL;

  try {
    resolved = new URL(requested, origin);
  } catch {
    return undefined;
  }

  // Compared after parsing, never before. Every bypass of a prefix check is
  // some spelling the parser reads differently from the way it looks.
  if (resolved.origin !== new URL(origin).origin) {
    return undefined;
  }

  return `${resolved.pathname}${resolved.search}`;
}
