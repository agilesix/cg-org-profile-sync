/**
 * The browser's half of connecting: one access token per system, for this tab.
 *
 * `sessionStorage` rather than a cookie or `localStorage`, deliberately. The
 * tokens are short-lived and per person, and a tab that closes should take
 * them with it — nothing a portal issued here should still be sitting in a
 * browser tomorrow. Link never verifies them; it forwards them, and the system
 * that issued one decides whether it is still good.
 *
 * Client-safe: no `$env`, no server imports, so the page can import it.
 */

const TOKEN_PREFIX = "link:token:";
const DENIED_PREFIX = "link:denied:";

/** What one system's connect attempt came to. */
export interface ConnectMessage {
  type: "cg-link:connect";
  sourceId: string;
  token: string | null;
  denied: boolean;
}

/**
 * Every wrapper below swallows its own failure.
 *
 * `sessionStorage` throws rather than returning nothing when a browser has
 * storage switched off, and in a third-party iframe it can throw on access
 * alone. The widget has to open either way; it simply will not remember
 * anything, and the person connects again.
 */
function storage(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

/** Every token this tab holds, keyed by source id. */
export function readTokens(): Record<string, string> {
  const store = storage();
  const tokens: Record<string, string> = {};

  if (!store) {
    return tokens;
  }

  for (let index = 0; index < store.length; index += 1) {
    const key = store.key(index);

    if (key?.startsWith(TOKEN_PREFIX)) {
      const token = store.getItem(key);

      if (token) {
        tokens[key.slice(TOKEN_PREFIX.length)] = token;
      }
    }
  }

  return tokens;
}

/** The sources that told us this person has no access there. */
export function readDenied(): string[] {
  const store = storage();
  const denied: string[] = [];

  if (!store) {
    return denied;
  }

  for (let index = 0; index < store.length; index += 1) {
    const key = store.key(index);

    if (key?.startsWith(DENIED_PREFIX)) {
      denied.push(key.slice(DENIED_PREFIX.length));
    }
  }

  return denied;
}

/** Remember one system's token, and clear any earlier refusal from it. */
export function rememberToken(sourceId: string, token: string): void {
  try {
    storage()?.setItem(`${TOKEN_PREFIX}${sourceId}`, token);
    storage()?.removeItem(`${DENIED_PREFIX}${sourceId}`);
  } catch {
    // Nothing to do: the token stays in memory for this page only.
  }
}

/** Remember that a system has no organization for this person. */
export function rememberDenied(sourceId: string): void {
  try {
    storage()?.setItem(`${DENIED_PREFIX}${sourceId}`, "1");
    storage()?.removeItem(`${TOKEN_PREFIX}${sourceId}`);
  } catch {
    // As above.
  }
}

/** Drop whatever we knew about one system, so Reconnect starts clean. */
export function forget(sourceId: string): void {
  try {
    storage()?.removeItem(`${TOKEN_PREFIX}${sourceId}`);
    storage()?.removeItem(`${DENIED_PREFIX}${sourceId}`);
  } catch {
    // As above.
  }
}

/**
 * Listen for a popup reporting back, and return the unsubscribe.
 *
 * The origin check is the whole security of this: `message` fires for anything
 * any window posts, so without it any page that got a handle on this one could
 * hand the widget a token of its choosing and have it forwarded to a real
 * system.
 */
export function listenForConnect(onConnect: (message: ConnectMessage) => void): () => void {
  const handler = (event: MessageEvent) => {
    if (event.origin !== window.location.origin) {
      return;
    }

    const data = event.data as Partial<ConnectMessage> | null;

    if (data?.type !== "cg-link:connect" || typeof data.sourceId !== "string") {
      return;
    }

    onConnect({
      type: "cg-link:connect",
      sourceId: data.sourceId,
      token: typeof data.token === "string" ? data.token : null,
      denied: Boolean(data.denied),
    });
  };

  window.addEventListener("message", handler);

  return () => window.removeEventListener("message", handler);
}
