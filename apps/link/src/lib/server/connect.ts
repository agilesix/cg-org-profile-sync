/**
 * The short-lived server-side half of a connect attempt.
 *
 * One cookie per attempt, keyed by the `state` the system will hand back, so
 * two systems can be connected in two tabs at once without either overwriting
 * the other's verifier.
 */

/** Long enough to sign in, short enough that an abandoned attempt clears itself. */
export const CONNECT_TTL_SECONDS = 300;

/** The cookie holding one attempt's verifier, named for its own `state`. */
export function connectCookieName(state: string): string {
  return `link_connect_${state}`;
}

/** What that cookie holds. */
export interface ConnectAttempt {
  sourceId: string;
  verifier: string;
  returnTo: string;
}

/** Read an attempt back, or `undefined` if the cookie is missing or not one. */
export function readAttempt(raw: string | undefined): ConnectAttempt | undefined {
  if (!raw) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    const { sourceId, verifier, returnTo } = (parsed ?? {}) as Partial<ConnectAttempt>;

    if (typeof sourceId !== "string" || typeof verifier !== "string") {
      return undefined;
    }

    return { sourceId, verifier, returnTo: typeof returnTo === "string" ? returnTo : "/" };
  } catch {
    return undefined;
  }
}
