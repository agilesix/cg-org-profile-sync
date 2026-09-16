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

/**
 * Every origin in a comma-separated list, normalized, junk dropped.
 *
 * The shape an allow-list arrives in from the environment. Each entry is put
 * through the URL parser and reduced to its origin, so a value someone wrote
 * with a trailing slash, a path, or an explicit default port still compares
 * equal to the origin a browser will report. An entry that does not parse is
 * dropped rather than failing the list: one typo in a variable naming three
 * origins should cost that one origin, not the whole deployment.
 *
 * An unset or empty variable gives `[]`, and every caller has to treat that as
 * "nobody", not "everybody" — which is the direction the two callers here fail
 * in: an empty list becomes `frame-ancestors 'self'`, and `originIfAllowed`
 * refuses everything.
 */
export function parseOriginList(raw: string | undefined): string[] {
  const origins = (raw ?? "")
    .split(",")
    .map((entry) => parseOrigin(entry.trim()))
    .filter((origin): origin is string => origin !== undefined);

  // Deduplicated because two spellings of one origin are one permission, and a
  // repeated entry in a CSP header is noise a reader has to rule out.
  return [...new Set(origins)];
}

/**
 * `requested` as a normalized origin, if and only if it is one of `allowed`.
 *
 * The check behind posting a message out of the widget to whatever page framed
 * it. The origin arrives as a query parameter, which is to say from whoever
 * built the frame URL, so it is a claim rather than a fact — what makes it safe
 * is that the claim has to match something the deployment configured.
 *
 * Compared after parsing for the same reason `sameOriginPath` does it:
 * `http://localhost:5173.evil.test` starts with an allowed origin and is not
 * one, and a prefix check cannot tell the difference.
 */
export function originIfAllowed(
  requested: string | null | undefined,
  allowed: readonly string[],
): string | undefined {
  const origin = parseOrigin(requested);

  return origin !== undefined && allowed.includes(origin) ? origin : undefined;
}

/**
 * One value as its origin, or `undefined` if it is not a usable absolute URL.
 *
 * The single-value form of `parseOriginList`, and what a caller holding one
 * configured origin wants: an origin it can compare and build URLs against, or
 * nothing, with no way to end up carrying a half-parsed string around.
 */
export function parseOrigin(value: string | null | undefined): string | undefined {
  if (!value) return undefined;

  try {
    // Relative to nothing: an allow-list entry has to name its own origin, and
    // `new URL("/x", base)` would silently invent one.
    const { origin } = new URL(value);

    // `null` is what the parser reports for a scheme with no origin of its own
    // — `data:`, `file:`, `blob:` — and it is a string here, not the value.
    return origin === "null" ? undefined : origin;
  } catch {
    return undefined;
  }
}
