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

/**
 * The organization this tab is linked to.
 *
 * One key, not one per system: the whole point of the lock is that there is a
 * single organization the widget is about, and every system is asked for its
 * own copy of that one.
 */
const LINKED_ORG_KEY = "link:org";

/**
 * Which systems finished the whole flow, not just the sign-in.
 *
 * A token is no longer the end of connecting: the organization step comes
 * after it, and someone can close the modal in between. Without this, a system
 * holding a token but no chosen organization would read as linked while the
 * widget had nothing to show for it.
 */
const LINKED_SOURCE_PREFIX = "link:linked:";

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
    storage()?.removeItem(`${LINKED_SOURCE_PREFIX}${sourceId}`);
  } catch {
    // As above.
  }
}

/** Record that this system's organization step is done. */
export function rememberLinkedSource(sourceId: string): void {
  try {
    storage()?.setItem(`${LINKED_SOURCE_PREFIX}${sourceId}`, "1");
  } catch {
    // As above.
  }
}

/** The systems that finished the whole flow, organization and all. */
export function readLinkedSources(): string[] {
  const store = storage();
  const linked: string[] = [];

  if (!store) {
    return linked;
  }

  for (let index = 0; index < store.length; index += 1) {
    const key = store.key(index);

    if (key?.startsWith(LINKED_SOURCE_PREFIX)) {
      linked.push(key.slice(LINKED_SOURCE_PREFIX.length));
    }
  }

  return linked;
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

/** The organization this tab has linked, as the browser remembers it. */
export interface LinkedOrg {
  /** Identifier registry it is matched across systems by, e.g. `org:us:ein`. */
  registry: string;

  /** Its id within that registry — the EIN. Empty when the system published none. */
  id: string;

  /** Its name, for the header and as the fallback lock when there is no EIN. */
  name: string;
}

/** Remember which organization this tab is working on. */
export function rememberLinkedOrg(org: LinkedOrg): void {
  try {
    storage()?.setItem(LINKED_ORG_KEY, JSON.stringify(org));
  } catch {
    // As above: the widget still works, it just forgets on reload.
  }
}

/**
 * The organization this tab linked, or `undefined`.
 *
 * Parsed defensively rather than cast. This value decides which organization
 * every later system is asked about, so a half-written or hand-edited entry
 * has to read as "nothing linked" — reaching a `PATCH` under an id that came
 * from a malformed record is how one organization's address lands on another.
 */
export function readLinkedOrg(): LinkedOrg | undefined {
  let raw: string | null | undefined;

  try {
    raw = storage()?.getItem(LINKED_ORG_KEY);
  } catch {
    return undefined;
  }

  if (!raw) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    const { registry, id, name } = (parsed ?? {}) as Partial<LinkedOrg>;

    if (typeof registry !== "string" || typeof id !== "string" || typeof name !== "string") {
      forgetLinkedOrg();
      return undefined;
    }

    return { registry, id, name };
  } catch {
    // Unparseable, and it will still be unparseable next time. Dropping it
    // here means one bad write cannot follow the tab around all session.
    forgetLinkedOrg();
    return undefined;
  }
}

/** Forget it, so the next link starts unlocked. */
export function forgetLinkedOrg(): void {
  try {
    storage()?.removeItem(LINKED_ORG_KEY);
  } catch {
    // As above.
  }
}
