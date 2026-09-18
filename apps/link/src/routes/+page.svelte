<!--
  The widget: read every connected system's copy of one org, show where they
  disagree, and push a chosen value back to the systems the person picks.

  It opens on nothing — a title and one button — because Link holds no
  credentials of its own. Everything up to the first token happens in
  `LinkModal`: pick a system, sign in to it in that system's own window, come
  back linked. That is the Plaid shape, and it is also the honest one here,
  since each system decides for itself who may touch what.

  The fan-outs both live in `@cg-link/org-sync/client`; nothing here knows how
  many systems there are, which is the point — a third source is an entry in
  `$lib/server/sources.ts` and this file does not change.
-->

<script lang="ts">
  import { SOURCE_TOKENS_HEADER, sourceTokensHeader } from "@cg-link/org-sync/client";
  import { blockedChanges } from "@cg-link/org-sync/utils";
  import { onMount, untrack } from "svelte";
  import type {
    ApiError,
    CompareResult,
    JsonValue,
    OrgListResult,
    OrgLock,
    OrgSummary,
    SyncResult,
    SyncTargetResult,
  } from "$lib/api-types.js";
  import ComparisonGrid from "$lib/components/ComparisonGrid.svelte";
  import LinkModal from "$lib/components/LinkModal.svelte";
  import SyncResults from "$lib/components/SyncResults.svelte";
  import {
    EIN_REGISTRY,
    directionOf,
    formatFieldValue,
    syncTargets,
    type ConnectOutcome,
    type Selection,
    type SyncDirection,
    type SystemView,
  } from "$lib/demo.js";
  import {
    forget,
    listenForConnect,
    readDenied,
    readLinkedOrg,
    readLinkedSources,
    readTokens,
    rememberDenied,
    rememberLinkedOrg,
    rememberLinkedSource,
    rememberToken,
    type LinkedOrg,
  } from "$lib/tokens.js";
  import type { PageData } from "./$types.js";

  let { data }: { data: PageData } = $props();

  /**
   * The organization this tab is working on, or null until one is picked.
   *
   * Everything downstream reads from here: which org the grid compares, which
   * id a sync writes under, and what later systems are locked to. It is the
   * one piece of state the widget cannot proceed without, which is why the
   * page shows nothing but a button until it is set.
   */
  let linkedOrg = $state<LinkedOrg | null>(null);

  /** The last system linked, so the banner can name it. */
  let banner = $state<string | null>(null);

  /**
   * One access token per system this tab has signed in with.
   *
   * Read from `sessionStorage` on mount rather than rendered into the page:
   * they are the browser's, not the server's, and a token that appeared in
   * server-rendered HTML would be a token in every proxy's log.
   */
  let tokens = $state<Record<string, string>>({});

  /** Systems that signed us in and then said we have no organization there. */
  let denied = $state<string[]>([]);

  /**
   * Systems that finished the whole flow, organization and all.
   *
   * Separate from holding a token, because the two came apart when the
   * organization step landed: someone can sign in and close the modal before
   * choosing, and a chip that said "Linked" for that would be claiming
   * something the widget cannot act on.
   */
  let linkedSources = $state<string[]>([]);

  /** Null until at least one system is connected — there is nothing to read before that. */
  let comparison = $state.raw<CompareResult | null>(null);
  /**
   * The value chosen in each row, keyed by field path.
   *
   * A map rather than a list so picking again in a row replaces that row's
   * pick instead of adding a second one — two choices for one field would be
   * a merge patch that means two things, which `buildMergePatch` refuses.
   */
  let selections = $state<Record<string, Selection>>({});
  let targets = $state<string[]>([]);
  let results = $state.raw<SyncTargetResult[] | null>(null);

  /**
   * The direction the published results describe.
   *
   * Captured when the change is sent rather than read off the current pick:
   * the grid re-reads afterwards and a pick can change under the result lines,
   * and a line that said "pulled into" about a push would be worse than one
   * that said nothing.
   */
  let syncedDirection = $state<SyncDirection | null>(null);

  /** One flag for both requests: neither should overlap itself or the other. */
  let busy = $state(false);

  /** Something Link itself refused or could not do. Per-target failures are not this. */
  let problem = $state<string | null>(null);

  /** Whether the picker is up, and how the attempt it is watching ended. */
  let modalOpen = $state(false);
  let outcome = $state<ConnectOutcome | null>(null);

  /** Set from `?resume=` so a same-tab round trip reopens where it left off. */
  let resume = $state<{ sourceId: string; step: "sign-in" | "orgs" } | null>(null);

  /**
   * What the grid is reading, derived from the linked organization.
   *
   * Derived rather than stored: there is exactly one organization in play, and
   * a second copy of its identifier is a second thing to keep in step. A
   * mismatch here would have the grid showing one record and a sync writing
   * another.
   */
  const registry = $derived(linkedOrg?.registry ?? EIN_REGISTRY);
  const id = $derived(linkedOrg?.id ?? "");

  /** What later systems may be linked to. Null while nothing is linked. */
  const lock = $derived<OrgLock | null>(
    linkedOrg === null ? null : { ein: linkedOrg.id || null, name: linkedOrg.name },
  );

  /**
   * Whether the browser has taken the page over.
   *
   * Every control here is server-rendered, so it is clickable a moment before
   * it does anything. Publishing hydration as `data-ready` gives the Playwright
   * specs something to wait for that is true rather than a sleep — without it
   * a fast click lands on inert markup and is silently lost.
   */
  let ready = $state(false);

  /**
   * Whether the widget is running inside somebody else's page.
   *
   * Two conditions, both required: the deployment has to allow the origin that
   * claims to be framing us (`data.parentOrigin`, decided on the server), and
   * we have to actually be in a frame. The second is what keeps a standalone
   * Link opened with a stray `?parent=` from growing a Close button that
   * closes nothing, and it can only be answered in the browser.
   */
  let framed = $state(false);

  const embedded = $derived(framed && data.parentOrigin !== null);

  /**
   * The popup being waited on, so closing it by hand is not silence.
   *
   * A window someone shut is not a refusal and not an error; without this the
   * modal would spin on a window that is gone.
   */
  let watching: { sourceId: string; timer: ReturnType<typeof setInterval> } | null = null;

  onMount(() => {
    tokens = readTokens();
    denied = readDenied();
    framed = window.self !== window.top;
    linkedSources = readLinkedSources();
    linkedOrg = adoptLinkedOrg();
    resumeFromUrl();
    ready = true;

    // A window reporting back. `listenForConnect` checks the origin; anything
    // else is ignored.
    const stop = listenForConnect((message) => {
      stopWatching();

      if (message.denied) {
        rememberDenied(message.sourceId);
        denied = [...new Set([...denied, message.sourceId])];
        tokens = Object.fromEntries(
          Object.entries(tokens).filter(([sourceId]) => sourceId !== message.sourceId),
        );
        outcome = { sourceId: message.sourceId, result: "denied" };
      } else if (message.token) {
        rememberToken(message.sourceId, message.token);
        tokens = { ...tokens, [message.sourceId]: message.token };
        denied = denied.filter((sourceId) => sourceId !== message.sourceId);
        outcome = { sourceId: message.sourceId, result: "token" };
      }

      void reload();
    });

    // Only now, with the listener below attached: the host answers this with
    // a token, and a reply that arrived earlier would land on nothing.
    const stopHost = listenForHostToken();

    postToHost({ type: "cg-link:ready" });

    void reload();

    return () => {
      stopWatching();
      stop();
      stopHost();
    };
  });

  /**
   * Take the access token the host page offers for its own system.
   *
   * The widget is embedded on the system it is about, so the host is in a
   * position to vouch for the person in front of it, and making them sign in
   * to the page they are already on proves nothing. Every other system still
   * signs in for itself — which is the beat the demo turns on, and this does
   * not touch it.
   *
   * Three checks before the token is kept, and none is redundant: `message`
   * fires for anything any window posts, so the origin check is what stops a
   * page other than our host speaking; `window.parent` is what stops a sibling
   * frame on that origin speaking for it; and `data.host` is what stops a
   * host handing us a token for a system it is not — otherwise the page we are
   * framed by could put a credential of its choosing in the column of any
   * system in the registry.
   */
  function listenForHostToken(): () => void {
    const handler = (event: MessageEvent) => {
      if (data.parentOrigin === null || event.origin !== data.parentOrigin) return;
      if (event.source !== window.parent) return;

      const message = event.data as { type?: string; token?: unknown } | null;

      if (message?.type !== "cg-link:host-token") return;
      if (typeof message.token !== "string" || message.token === "") return;
      if (data.host === null) return;

      adoptHostToken(data.host.id, message.token);
    };

    window.addEventListener("message", handler);

    return () => window.removeEventListener("message", handler);
  }

  /**
   * Connect the host system with a token it issued itself.
   *
   * Recorded as a linked source as well as a token holder. The organization
   * step is what normally moves a system from "signed in" to "linked", and
   * there is nothing to choose here: the frame was opened at one organization
   * and `adoptLinkedOrg` has already taken it from the URL. Without this the
   * host would sit on a "Choose an organization" button for a choice of one.
   */
  function adoptHostToken(sourceId: string, token: string): void {
    if (tokens[sourceId] === token) return;

    rememberToken(sourceId, token);
    rememberLinkedSource(sourceId);

    tokens = { ...tokens, [sourceId]: token };
    linkedSources = [...new Set([...linkedSources, sourceId])];
    denied = denied.filter((candidate) => candidate !== sourceId);

    void reload();
  }

  /** Systems Link can talk to, each with what it allows and where it stands. */
  const sourceStates = $derived(
    data.sources
      .filter((source) => source.connectable)
      .map((source) => {
        const row = comparison?.sources.find((candidate) => candidate.id === source.id);
        const connection = denied.includes(source.id)
          ? "denied"
          : row?.connection === "expired"
            ? "expired"
            : tokens[source.id]
              ? // Signed in, but the organization step may still be
                // outstanding — closing the modal on it leaves exactly that.
                linkedSources.includes(source.id)
                ? "connected"
                : "pending-org"
              : "not-connected";

        return { ...source, connection };
      }),
  );

  /** Only the systems worth a chip: one nothing has happened with says nothing. */
  const chips = $derived(sourceStates.filter((source) => source.connection !== "not-connected"));

  const connectedCount = $derived(Object.keys(tokens).length);

  /**
   * Whether there is a system left to link.
   *
   * The grid's invitation column asks for another one, so it has to disappear
   * once there is no other one to ask for — an invitation that opens a picker
   * with nothing choosable in it is worse than no invitation.
   */
  const canAddSource = $derived(
    sourceStates.some((source) => source.connection === "not-connected"),
  );

  /**
   * The system whose page we are embedded in, or `null` standalone.
   *
   * Already validated server-side against the registry, so an unrecognised
   * `?host=` arrives as `null` and everything below reads as standalone.
   */
  const host = $derived(data.host?.id ?? null);

  /**
   * Labels come from the registry, not the comparison.
   *
   * The comparison is null until something is connected, and a source that is
   * down is still a source with a name — falling back to an id in either case
   * would put `funderhub` on screen where FunderHub belongs.
   */
  const labels = $derived(
    Object.fromEntries(data.sources.map((source) => [source.id, source.label])),
  );

  /**
   * What is picked, in the order the grid shows the rows.
   *
   * Ordered by the comparison rather than by when each was clicked, so the
   * panel reads down the grid the way the person just read it — and so the
   * list does not reshuffle when someone changes their mind about one row.
   */
  const picks = $derived(
    (comparison?.fields ?? [])
      .map((field) => selections[field.path])
      .filter((pick): pick is Selection => pick !== undefined),
  );

  /** Where the picked values came from, which is what decides the direction. */
  const pickedSourceIds = $derived(picks.map((pick) => pick.sourceId));

  /**
   * Which way the picks travel: out of the host, or into it.
   *
   * One direction for the whole set. Picks from two systems have no single
   * direction, and `directionOf` calls that a push — so the pull's "only the
   * host" rule applies exactly when every pick came from one other system,
   * which is the case where "bring this into the page I am on" means something.
   */
  const direction = $derived(picks.length === 0 ? null : directionOf(pickedSourceIds, host));

  /**
   * The systems a change could actually reach, given what is picked.
   *
   * `syncTargets` holds the rules — not a source every pick came from, nothing
   * with an error or no record, nothing that declares `write: false`, and on a
   * pull only the host. They live in the library because they decide where a
   * change is sent, which is not a thing to leave untested in a template.
   */
  const candidates = $derived(syncTargets(comparison?.sources ?? [], pickedSourceIds, host));

  /**
   * The targets a sync would actually go to.
   *
   * `targets` is what the person checked; `candidates` is what is reachable
   * *now*. A refresh in between can drop a system out — it stops answering,
   * or turns out to hold no record — and a check box for a system that is no
   * longer offered must not still be able to send it a patch. Intersecting
   * the two is what keeps the Sync button honest about what it will do.
   */
  const chosen = $derived(
    targets.filter((target) => candidates.some((source) => source.id === target)),
  );

  /**
   * The chosen targets that cannot store something picked, and what.
   *
   * Asked before anything is sent, which is the whole point of the ticket: a
   * system that drops a field answers 200 and says so in its message, so
   * without this the only way to find out is to click Sync and read the bad
   * news afterwards. `blockedChanges` is the library's rule rather than a
   * comparison written out here, so this and `syncToTargets`' own refusal
   * cannot disagree about what is blocked.
   *
   * Only the targets actually checked count. Unchecking the blocking system,
   * or removing the pick, is what clears it.
   */
  const blocked = $derived(
    chosen
      .map((id) => {
        const source = comparison?.sources.find((row) => row.id === id);
        const fields = source === undefined ? [] : blockedChanges(picks, source);

        return { id, label: labels[id] ?? id, fields };
      })
      .filter((target) => target.fields.length > 0),
  );

  const canSync = $derived(picks.length > 0 && chosen.length > 0 && blocked.length === 0 && !busy);

  /** Every request to Link's own API carries the whole set of tokens, or none. */
  function authHeaders(): Record<string, string> {
    return { [SOURCE_TOKENS_HEADER]: sourceTokensHeader(tokens) };
  }

  /**
   * Where the sign-in round trip should come back to.
   *
   * Carries only `resume`. The linked organization is in `sessionStorage`,
   * which survives a same-tab navigation, so putting it in the query as well
   * was both redundant and wrong: with nothing linked yet the parameter went
   * out empty, and the server read a present-but-empty `?id=` as a deep link
   * and defaulted it — inventing a lock before anyone had chosen anything.
   */
  function returnPath(sourceId: string): string {
    return `/?${new URLSearchParams({ resume: sourceId })}`;
  }

  /**
   * Which organization this tab is working on, when it opens.
   *
   * A deep link wins over what is stored, because `?id=` is what the presenter
   * typed and the stored value is only what this tab happened to do last. It
   * also replaces the stored one, so the rest of the session agrees with the
   * address bar rather than quietly disagreeing with it.
   *
   * A deep link carries no name — only the demo script knows it — so the
   * header shows the identifier until the first comparison fills the name in.
   */
  function adoptLinkedOrg(): LinkedOrg | null {
    const deepLink = untrack(() => data.deepLink);

    if (deepLink) {
      const linked: LinkedOrg = { ...deepLink, name: "" };

      rememberLinkedOrg(linked);

      return linked;
    }

    return readLinkedOrg() ?? null;
  }

  /** Ask one system which organizations this person may touch there. */
  async function loadOrgs(sourceId: string): Promise<OrgListResult> {
    const response = await fetch(`/api/orgs?source=${encodeURIComponent(sourceId)}`, {
      headers: authHeaders(),
    });

    // 401 is how the route spells "not connected", and it carries the same
    // body as every other answer — so it is read rather than thrown on.
    return (await response.json()) as OrgListResult;
  }

  /**
   * Adopt the organization someone picked, and read it everywhere.
   *
   * The first system to be linked decides the organization; every later one is
   * locked to it, which is what `lock` above hands back to the modal.
   */
  function onLinked(source: SystemView, org: OrgSummary): void {
    const linked: LinkedOrg = {
      registry: EIN_REGISTRY,
      id: org.ein ?? "",
      name: org.name,
    };

    linkedOrg = linked;
    rememberLinkedOrg(linked);

    linkedSources = [...new Set([...linkedSources, source.id])];
    rememberLinkedSource(source.id);

    banner = `${source.label} linked`;
    problem = null;

    void reload();
  }

  /**
   * Pick the flow back up after a round trip that navigated this tab.
   *
   * Only the blocked-popup path gets here, and by the time it does the answer
   * is already in `sessionStorage` — the callback wrote it before sending us
   * back. So what reopens is decided by what we came back holding, not by the
   * step we left on: a token means the sign-in finished and there is nothing
   * left to ask, a refusal means the modal should say so, and neither means
   * they never got that far and should see the button again.
   *
   * Reopening on "sign in to GrantPortal" after GrantPortal had just signed
   * them in is the bug this exists to prevent.
   *
   * The parameter is then stripped, so a reload is an ordinary page load
   * rather than a replay of a round trip that already happened.
   */
  function resumeFromUrl(): void {
    const url = new URL(window.location.href);
    const requested = url.searchParams.get("resume");

    if (!requested) return;

    url.searchParams.delete("resume");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);

    if (denied.includes(requested)) {
      resume = { sourceId: requested, step: "sign-in" };
      outcome = { sourceId: requested, result: "denied" };
      modalOpen = true;
    } else if (tokens[requested]) {
      // Signed in, but a token is not the end of the flow: which organization
      // is still outstanding, and closing here would leave the system linked
      // to nothing. `?resume=` is only ever present immediately after a round
      // trip, so this cannot re-ask someone who already answered.
      resume = { sourceId: requested, step: "orgs" };
      modalOpen = true;
    } else {
      // They never got as far as signing in. Honoured only if it names a
      // system we could actually connect; the modal ignores anything else
      // rather than opening an empty step.
      resume = { sourceId: requested, step: "sign-in" };
      modalOpen = true;
    }
  }

  function stopWatching(): void {
    if (watching) {
      clearInterval(watching.timer);
      watching = null;
    }
  }

  /**
   * Notice a popup that was closed without finishing.
   *
   * A successful flow also closes the window, so the message listener clears
   * this first — and the short delay covers the ordering, since a popup that
   * posts and closes in the same tick can be seen as `closed` a moment before
   * the message is delivered.
   */
  function watchPopup(sourceId: string, popup: Window): void {
    stopWatching();

    const timer = setInterval(() => {
      if (!popup.closed) return;

      stopWatching();

      setTimeout(() => {
        if (outcome?.sourceId === sourceId) return;

        outcome = { sourceId, result: "abandoned" };
      }, 400);
    }, 500);

    watching = { sourceId, timer };
  }

  /**
   * Send the person through one system's sign-in, in that system's own window.
   *
   * A popup rather than this tab, always: the modal has to stay up to show
   * what is happening and to receive the token, and Google will not render its
   * sign-in inside anyone else's page. A browser that blocks the popup falls
   * back to navigating, which is why this answers whether the window opened.
   */
  function startConnect(source: SystemView): boolean {
    const start = `/api/connect/start?${new URLSearchParams({
      source: source.id,
      return: returnPath(source.id),
    })}`;

    // A fixed window name, so clicking twice reuses the one window rather than
    // leaving an orphan nobody will finish signing in to.
    const popup = window.open(start, "cg-link-connect", "width=520,height=680");

    if (!popup) {
      problem = "Your browser blocked the sign-in window, so this tab will go there instead.";
      window.location.href = start;

      return false;
    }

    outcome = null;
    watchPopup(source.id, popup);

    return true;
  }

  function openPicker(): void {
    problem = null;
    outcome = null;
    resume = null;
    modalOpen = true;
  }

  function closePicker(): void {
    stopWatching();
    modalOpen = false;
    resume = null;
  }

  /**
   * Reopen the organization step for a system already signed in.
   *
   * No second OAuth round trip: the token is still good, and the only thing
   * outstanding is which organization. Making someone sign in again to answer
   * a question they closed a modal on would be punishing them for it.
   */
  function finishLinking(sourceId: string): void {
    outcome = null;
    resume = { sourceId, step: "orgs" };
    modalOpen = true;
  }

  /** Drop what we knew about a system and start its sign-in again. */
  function reconnect(sourceId: string): void {
    forget(sourceId);
    tokens = Object.fromEntries(
      Object.entries(tokens).filter(([candidate]) => candidate !== sourceId),
    );
    denied = denied.filter((candidate) => candidate !== sourceId);
    resume = { sourceId, step: "sign-in" };
    outcome = null;
    modalOpen = true;
  }

  /**
   * Take a source's value as the correct one.
   *
   * Every other system that holds a record is checked by default: the demo's
   * usual move is "this one is right, fix the rest", and unchecking is cheaper
   * than checking. A source with no record of the org is left out entirely —
   * there is nothing there to patch, and offering it would only produce a
   * failed row.
   */
  function pick(path: string, label: string, sourceId: string, value: JsonValue): void {
    const offered = offeredTargets();

    selections = { ...selections, [path]: { path, label, sourceId, value } };
    retarget(offered);
  }

  /** Drop one row's pick, leaving the others alone. */
  function unpick(path: string): void {
    const offered = offeredTargets();
    const remaining = { ...selections };
    delete remaining[path];

    selections = remaining;
    retarget(offered);
  }

  /**
   * The systems the panel is currently offering as targets.
   *
   * Empty before the first pick, because the fieldset is not rendered until
   * something is chosen — so a system nobody has had the chance to uncheck yet
   * counts as new rather than as deliberately left out.
   */
  function offeredTargets(): string[] {
    return picks.length === 0 ? [] : candidates.map((source) => source.id);
  }

  /**
   * Re-offer the reachable systems after the picks change, honouring the
   * choices already made about them.
   *
   * A system the person just brought into range is checked, keeping the
   * default from before multi-pick: the usual move is "this one is right, fix
   * the rest". A system that was already on offer keeps whatever they left it
   * on, because re-checking one they had deliberately unchecked would undo a
   * decision on a click that had nothing to do with it — and with several rows
   * in play that click now happens all the time.
   *
   * `candidates` is derived from `picks`, and deriveds in Svelte 5 are
   * recomputed on read, so it already reflects the change just made; `offered`
   * has to be captured by the caller *before* that change for the same reason.
   * Both adding and removing a pick can move a system in or out of the list,
   * which is why this is not only done on the way in.
   */
  function retarget(offered: readonly string[]): void {
    targets = candidates
      .map((source) => source.id)
      .filter((id) => targets.includes(id) || !offered.includes(id));

    results = null;
    syncedDirection = null;
    problem = null;
  }

  /** Whatever was thrown, as something worth putting on screen. */
  function describe(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause);
  }

  function toggleTarget(sourceId: string): void {
    targets = targets.includes(sourceId)
      ? targets.filter((target) => target !== sourceId)
      : [...targets, sourceId];
  }

  /**
   * Read one org through Link's own route, and adopt it only if that worked.
   *
   * `registry`/`id` derive from the linked organization now, so there is no
   * second copy to keep in step: the grid and a later sync cannot disagree
   * about which record they are on, which is what writing one organization's
   * address onto another would take.
   *
   * Reports its own failures rather than throwing, because both callers would
   * otherwise repeat the same handling, and a `fetch` that rejects (Link
   * itself down, connection dropped) would leave the page on stale data with
   * no explanation while `busy` quietly cleared.
   *
   * A source that is down is not this: that comes back inside a 200 and is
   * rendered as a column in an error state.
   */
  async function load(nextRegistry: string, nextId: string): Promise<boolean> {
    const query = new URLSearchParams({ registry: nextRegistry, id: nextId });

    try {
      const response = await fetch(`/api/compare?${query}`, { headers: authHeaders() });

      if (!response.ok) {
        problem = `Reading the systems failed (${response.status}).`;
        return false;
      }

      comparison = (await response.json()) as CompareResult;

      // A deep link arrives with no name — only an EIN — so the header would
      // otherwise show an identifier where an organization belongs. The grid
      // has just told us what the systems call it.
      if (linkedOrg !== null && linkedOrg.name === "") {
        const named = comparison.fields.find((field) => field.path === "name");
        const name = Object.values(named?.values ?? {}).find(
          (value): value is string => typeof value === "string" && value !== "",
        );

        if (name !== undefined) {
          linkedOrg = { ...linkedOrg, name };
          rememberLinkedOrg(linkedOrg);
        }
      }

      return true;
    } catch (cause) {
      problem = `The systems could not be read: ${describe(cause)}`;
      return false;
    }
  }

  /**
   * Read the linked org, if there is one and anyone to read it as.
   *
   * Both halves are required now. Without a token every column would come back
   * "not connected"; without a linked organization there is no record to ask
   * about at all, since the widget no longer guesses at a default EIN.
   */
  async function reload(): Promise<boolean> {
    if (connectedCount === 0 || linkedOrg === null || id === "") {
      comparison = null;
      return false;
    }

    return await load(registry, id);
  }

  /** Re-read the org already on screen. */
  function refresh(): Promise<boolean> {
    return load(registry, id);
  }

  /**
   * Tell the host page something happened, if there is a host to tell.
   *
   * Always targeted at `data.parentOrigin` rather than `"*"`: the message
   * names the systems a change reached, and a wildcard target would hand that
   * to whatever page happened to be framing us instead of to the one the
   * deployment allows.
   */
  function postToHost(message: { type: string; [key: string]: unknown }): void {
    if (!embedded || data.parentOrigin === null) return;

    window.parent.postMessage(message, data.parentOrigin);
  }

  /** Ask the host to take the frame away. It owns the overlay, so it decides. */
  function close(): void {
    postToHost({ type: "cg-link:close" });
  }

  /**
   * Send the picked value to every checked target, then re-read.
   *
   * The result lines are published *after* the refresh, so a result line with
   * no error beside it means the grid is already the post-change state. The
   * specs wait on those lines rather than on a timeout, and that is what makes
   * the wait sufficient — a refresh that failed says so, loudly, because
   * otherwise the results would be describing a grid from before the change.
   */
  async function sync(): Promise<void> {
    if (!canSync) return;

    busy = true;
    results = null;
    syncedDirection = null;
    problem = null;

    try {
      const response = await fetch("/api/sync", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          registry,
          id,
          changes: picks.map(({ path, value }) => ({ path, value })),
          targets: chosen,
        }),
      });

      const body: unknown = await response.json();

      if (!response.ok) {
        problem = (body as ApiError).message || `The sync was refused (${response.status}).`;
        return;
      }

      const refreshed = await refresh();

      results = (body as SyncResult).results;
      syncedDirection = direction;

      // After the refresh, so a host that re-reads on this message sees the
      // post-change values rather than racing Link's own re-read. Sent even
      // when a target failed: the host's copy may still have changed, and the
      // per-target results are in the message for it to say so.
      postToHost({
        type: "cg-link:synced",
        targets: chosen,
        results: (body as SyncResult).results,
      });

      if (!refreshed) {
        // `load` has already said why it could not re-read. Say what that
        // means for what is on screen: the write happened and the lines below
        // are the systems' own answers, but the grid above them predates it.
        problem = `${problem} The results below are what the systems said; the grid above them is from before the change.`;
      }
    } catch (cause) {
      problem = `The sync could not be sent: ${describe(cause)}`;
    } finally {
      busy = false;
    }
  }

  /**
   * What the Sync button is about to do, said in full.
   *
   * Named rather than left as "Sync": the one thing someone has to get right
   * before clicking is which copy is about to be overwritten, and a verb that
   * hides it is the whole reason this ticket exists.
   */
  const action = $derived.by(() => {
    if (picks.length === 0 || direction === null) return null;

    const origins = new Set(pickedSourceIds);
    const only = picks.length === 1 ? picks[0] : undefined;

    // One field is named; several are counted. Listing four labels in a
    // sentence someone reads at a glance buries the verb, which is the one
    // word this line exists to put in front of them.
    const what = only ? only.label : `${picks.length} fields`;

    // "from" only when the whole set came from one system. With picks from two
    // it would have to name both, and a sentence saying a value came from the
    // system it is about to be sent to is worse than one that stays quiet.
    const sole = origins.size === 1 ? [...origins][0] : undefined;
    const from = sole === undefined ? "" : ` from ${labels[sole] ?? sole}`;
    const into = chosen.map((id) => labels[id] ?? id).join(" and ");

    // Both branches name a target only when there is one. Naming the host on a
    // pull regardless would describe a change that unchecking it had already
    // called off — the exact implication this ticket exists to remove.
    return direction === "push"
      ? `Push ${what}${from}${into ? ` to ${into}` : ""}`
      : `Pull ${what}${from}${into ? ` into ${into}` : ""}`;
  });

  /**
   * What a source allows, in the words the widget uses for it.
   *
   * "pull" and "push" rather than "read" and "write", so a chip names the two
   * buttons someone is about to be offered: a system that cannot be pushed to
   * is one the Push button will never list, and saying so in the same verb is
   * what makes the two screens agree.
   */
  function capabilityWords(capabilities: { read: boolean; write: boolean }): string {
    const allowed = [
      capabilities.read ? "pull" : undefined,
      capabilities.write ? "push" : undefined,
    ].filter((word): word is string => word !== undefined);

    return allowed.length === 0 ? "no access" : allowed.join(" and ");
  }
</script>

<main data-testid="widget" data-ready={ready} data-embedded={embedded}>
  {#if embedded}
    <div class="host-bar">
      <p class="host" data-testid="host-system">
        {data.host ? `Opened from ${data.host.label}` : "Opened from a host page"}
      </p>
      <button type="button" class="close" data-testid="close" aria-label="Close" onclick={close}
        >×</button
      >
    </div>
  {/if}

  <p class="role">Widget</p>
  <h1>CommonGrants Link</h1>
  <p class="tagline">
    Link the systems that hold your organization's profile, see where their copies disagree, and
    push the corrections back out.
  </p>

  <button type="button" class="link-system" data-testid="link-system" onclick={openPicker}>
    Link Grant Management System
  </button>

  {#if banner}
    <p class="banner" role="status" data-testid="linked-banner">
      {banner}
      <button
        type="button"
        class="dismiss-banner"
        data-testid="dismiss-banner"
        onclick={() => (banner = null)}>Dismiss</button
      >
    </p>
  {/if}

  {#if linkedOrg}
    <p class="linked-org" data-testid="linked-org">
      <span class="linked-org-name">{linkedOrg.name || "Linked organization"}</span>
      <span class="linked-org-ein">{linkedOrg.id ? `EIN ${linkedOrg.id}` : "No EIN on file"}</span>
    </p>
  {/if}

  {#if chips.length > 0}
    <ul class="chips" data-testid="linked-systems">
      {#each chips as source (source.id)}
        <li data-testid="system-{source.id}">
          <span class="chip-name">{source.label}</span>
          <span class="chip-caps">{capabilityWords(source.capabilities)}</span>

          {#if source.connection === "connected"}
            <span class="chip-ok" data-testid="connected-{source.id}">Linked</span>
          {:else if source.connection === "pending-org"}
            <button
              type="button"
              class="chip-button"
              data-testid="finish-{source.id}"
              onclick={() => finishLinking(source.id)}>Choose an organization</button
            >
            <span class="chip-note">Signed in, but no organization chosen yet.</span>
          {:else if source.connection === "expired"}
            <button
              type="button"
              class="chip-button"
              data-testid="reconnect-{source.id}"
              onclick={() => reconnect(source.id)}>Reconnect</button
            >
            <span class="chip-note">This connection expired.</span>
          {:else}
            <span class="chip-note" data-testid="chip-denied-{source.id}">
              No organization here for that account
            </span>
            <button
              type="button"
              class="chip-button"
              data-testid="retry-{source.id}"
              onclick={() => reconnect(source.id)}>Try another account</button
            >
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if linkedOrg !== null && id === ""}
    <p class="prompt" data-testid="no-ein">
      {linkedOrg.name || "That organization"} publishes no EIN, and the EIN is what matches one organization
      across systems. There is nothing to compare it against — link an organization that has one.
    </p>
  {:else if comparison === null}
    <p class="prompt" data-testid="nothing-linked">
      Nothing is linked yet. Link a grant management system to see how the copies of your profile
      compare.
    </p>
  {:else}
    <ComparisonGrid
      {comparison}
      {selections}
      canAdd={canAddSource}
      onpick={pick}
      onadd={openPicker}
      fill={embedded}
    />

    <section class="panel" data-testid="panel">
      {#if picks.length === 0}
        <p class="prompt" data-testid="prompt">
          Click the value a system holds to choose it as the correct one. Pick as many fields as you
          like — they travel together.
        </p>
      {:else}
        <ul class="picks" data-testid="selection">
          {#each picks as choice (choice.path)}
            <li class="chosen" data-testid="selected-{choice.path}">
              <span class="chosen-field">{choice.label}</span>
              <span class="chosen-value">{formatFieldValue(choice.value) || "(empty)"}</span>
              <span class="chosen-from">from {labels[choice.sourceId] ?? choice.sourceId}</span>
              <button
                type="button"
                class="unpick"
                data-testid="unpick-{choice.path}"
                onclick={() => unpick(choice.path)}
              >
                Remove
              </button>
            </li>
          {/each}
        </ul>

        <p class="direction" data-testid="direction" data-direction={direction}>{action}</p>

        {#if candidates.length === 0}
          <p class="prompt" data-testid="no-targets">
            {direction === "pull"
              ? `${data.host?.label ?? "This page"} cannot accept ${picks.length === 1 ? "this change" : "these changes"}, so there is nowhere to pull ${picks.length === 1 ? "it" : "them"} into.`
              : `No other system can accept ${picks.length === 1 ? "this change" : "these changes"}, so there is nowhere to send ${picks.length === 1 ? "it" : "them"}.`}
          </p>
        {:else}
          <fieldset>
            <legend>
              {direction === "pull" ? "Pull" : "Push"}
              {picks.length === 1 ? "it" : "them"}
              {direction === "pull" ? "into" : "to"}
            </legend>
            {#each candidates as source (source.id)}
              <label>
                <input
                  type="checkbox"
                  data-testid="target-{source.id}"
                  checked={targets.includes(source.id)}
                  onchange={() => toggleTarget(source.id)}
                />
                {source.label}
              </label>
            {/each}
          </fieldset>
        {/if}

        {#each blocked as target (target.id)}
          <p class="blocked" role="status" data-testid="blocked-{target.id}">
            {target.label} can't store {target.fields
              .map((field) => selections[field.path]?.label ?? field.path)
              .join(" or ")}. Unselect it or drop {target.label} as a target.
          </p>
        {/each}

        <button type="button" class="sync" data-testid="sync" disabled={!canSync} onclick={sync}>
          {busy ? "Sending…" : direction === "pull" ? "Pull" : "Push"}
        </button>
      {/if}

      {#if results && syncedDirection}
        <SyncResults {results} {labels} direction={syncedDirection} />
      {/if}
    </section>
  {/if}

  {#if problem}
    <p class="problem" role="status" data-testid="problem">{problem}</p>
  {/if}
</main>

<LinkModal
  open={modalOpen}
  sources={data.sources}
  onstart={startConnect}
  {outcome}
  {loadOrgs}
  {lock}
  onlinked={onLinked}
  {resume}
  onclose={closePicker}
/>

<style>
  .host-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem 1rem;
    margin: -2rem 0 2rem;
    padding-bottom: 0.9rem;
    border-bottom: 1px solid #d9e0dd;
  }
  .host {
    margin: 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.72rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #6b7a77;
  }
  .close {
    font-size: 1.4rem;
    line-height: 1;
    padding: 0 0.25rem;
    color: #6b7a77;
    background: transparent;
    border: 0;
  }
  .link-system {
    font: inherit;
    font-size: 0.95rem;
    padding: 0.6rem 1.25rem;
    color: #ffffff;
    background: #0d6e63;
    border: 1px solid #0d6e63;
    border-radius: 0.35rem;
    cursor: pointer;
  }
  .chips {
    margin: 1.75rem 0 2rem;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .chips li {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.3rem 0.75rem;
  }
  .chip-name {
    font-weight: 600;
  }
  .chip-caps {
    font-size: 0.8rem;
    color: #6b7a77;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .chip-ok {
    font-size: 0.8rem;
    color: #0d6e63;
  }
  .chip-note {
    font-size: 0.8rem;
    color: #8a5a1e;
  }
  .chip-button {
    font: inherit;
    font-size: 0.85rem;
    padding: 0.15rem 0.7rem;
    border: 1px solid #0d6e63;
    border-radius: 0.25rem;
    background: #0d6e63;
    color: #ffffff;
    cursor: pointer;
  }
  :global(body) {
    margin: 0;
    background: #f5f7f6;
    color: #14201f;
    font-family:
      ui-sans-serif,
      system-ui,
      -apple-system,
      "Segoe UI",
      sans-serif;
    line-height: 1.6;
  }
  main {
    max-width: 56rem;
    margin: 0 auto;
    padding: 4rem 1.5rem;
  }

  /*
     Embedded, the widget is a column in a fixed box rather than a page that
     runs as long as it likes. `embed.js` sizes the overlay at
     `min(46rem, 92vh)` and cannot grow, so a document taller than that used to
     scroll the iframe — and once the grid gained a scroller of its own, that
     became scrolling the frame and *then* scrolling the grid to reach a row.

     So: the chrome keeps its natural height, the grid takes what is left, and
     the panel stays on screen. The Sync button is the last thing anyone does
     here, and having to scroll to find it is the thing this layout removes.
  */
  main[data-embedded="true"] {
    display: flex;
    flex-direction: column;

    /* `border-box`, or the padding is added to `100dvh` and the column ends up
       taller than the frame it is meant to fit — which puts the panel, and the
       Sync button in it, just below the fold. */
    box-sizing: border-box;
    height: 100dvh;
    max-width: none;
    padding: 2.5rem 1.5rem 1.5rem;

    /* `auto`, not `hidden`. This layout is built so everything fits, but a
       person with a long list of picks and a set of results under them can
       still outgrow the frame — and scrolling the widget is what this used to
       do anyway, where clipping would lose the controls outright. */
    overflow: auto;
  }
  main[data-embedded="true"] > :not(.panel) {
    flex: none;
  }

  /*
     The panel keeps its natural height and the grid takes what is left, rather
     than the other way round: a grid one row shorter costs a scroll in a thing
     that already scrolls, where a panel that shrinks hides controls.
  */
  main[data-embedded="true"] > .panel {
    flex: 0 0 auto;
    margin-top: 1.25rem;
  }

  /*
     Condensed chrome, so there is something left for the grid to absorb.
     Making the column flex is only half the fix: the title block, the tagline
     and the spacing between the chips came to roughly 650px of a 736px frame,
     which left the grid a row and a half however the height was divided.

     What goes is what the overlay already says another way. The host bar names
     the system whose page this is, and someone who clicked **Open Link** on
     their own profile does not need the standalone page's onboarding copy.
     Nothing here is hidden that cannot be read on the widget's own page.
  */
  main[data-embedded="true"] .role,
  main[data-embedded="true"] .tagline {
    display: none;
  }
  main[data-embedded="true"] h1 {
    margin: 0 0 0.9rem;
    font-size: 1.3rem;
  }
  /* A flex column stretches its children across the cross axis, which turned
     this button into a full-width bar. The grid and the panel do want the whole
     width; a button wants to be the size of its label. */
  main[data-embedded="true"] .link-system {
    align-self: flex-start;
  }
  main[data-embedded="true"] .banner {
    margin-top: 0.9rem;
  }
  main[data-embedded="true"] .linked-org {
    margin-top: 1rem;
  }
  main[data-embedded="true"] .chips {
    margin: 1rem 0 1.25rem;
    gap: 0.3rem;
  }
  .role {
    margin: 0 0 0.5rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.72rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #0d6e63;
  }
  h1 {
    margin: 0 0 0.75rem;
    font-size: 2.25rem;
    letter-spacing: -0.02em;
  }
  .tagline {
    margin: 0 0 2rem;
    font-size: 1.1rem;
    color: #3b4a48;
    max-width: 34rem;
  }
  .banner {
    margin: 1.5rem 0 0;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.75rem;
    padding: 0.6rem 0.9rem;
    font-size: 0.9rem;
    color: #0b5c53;
    background: #e6f3f1;
    border: 1px solid #b9dcd7;
    border-radius: 0.4rem;
  }
  .dismiss-banner {
    font: inherit;
    font-size: 0.8rem;
    margin-left: auto;
    padding: 0;
    color: inherit;
    background: transparent;
    border: 0;
    text-decoration: underline;
    cursor: pointer;
  }
  .linked-org {
    margin: 1.75rem 0 0;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.3rem 0.75rem;
  }
  .linked-org-name {
    font-size: 1.15rem;
    font-weight: 600;
  }
  .linked-org-ein {
    font-size: 0.8rem;
    color: #6b7a77;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .panel {
    margin-top: 2rem;
    padding-top: 1.25rem;
    border-top: 1px solid #d9e0dd;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1rem;
  }
  .prompt {
    margin: 1.75rem 0 0;
    font-size: 0.85rem;
    color: #6b7a77;
  }
  .panel .prompt {
    margin: 0;
  }
  .picks {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .chosen {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.3rem 0.75rem;
    font-size: 0.9rem;
  }
  .direction {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
  }
  .chosen-field {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.72rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #6b7a77;
  }
  .chosen-value {
    font-weight: 600;
  }
  .chosen-from {
    color: #6b7a77;
  }
  .blocked {
    margin: 0;
    font-size: 0.85rem;
    color: #97590d;
  }
  .unpick {
    font: inherit;
    font-size: 0.75rem;
    padding: 0.1rem 0.45rem;
    color: #6b7a77;
    background: none;
    border: 1px solid #d9e0dd;
    border-radius: 0.3rem;
    cursor: pointer;
  }
  .unpick:hover {
    color: #14201f;
    border-color: #b7c4c1;
  }
  fieldset {
    margin: 0;
    padding: 0;
    border: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem 1.25rem;
  }
  legend {
    padding: 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.72rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #6b7a77;
  }
  fieldset label {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.9rem;
  }
  .sync {
    font: inherit;
    font-size: 0.85rem;
    padding: 0.35rem 0.9rem;
    color: #f5f7f6;
    background: #0d6e63;
    border: 1px solid #0d6e63;
    border-radius: 0.3rem;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .problem {
    margin: 1.5rem 0 0;
    font-size: 0.85rem;
    color: #a1291f;
  }

  @media (prefers-color-scheme: dark) {
    .chip-caps,
    .host {
      color: #8a9895;
    }
    .host-bar {
      border-color: #2a3736;
    }
    .close {
      color: #8a9895;
    }
    .chip-ok {
      color: #56b7a9;
    }
    .chip-note {
      color: #d7a55c;
    }
    :global(body) {
      background: #0f1615;
      color: #e7edeb;
    }
    .role {
      color: #56b7a9;
    }
    .tagline {
      color: #bac6c3;
    }
    legend,
    .prompt,
    .chosen-field,
    .chosen-from,
    .unpick,
    .linked-org-ein {
      color: #8a9895;
    }
    .blocked {
      color: #e0ab5f;
    }
    .unpick {
      border-color: #2a3736;
    }
    .unpick:hover {
      color: #e7edeb;
      border-color: #3f5250;
    }
    .banner {
      color: #a8ddd5;
      background: #12302c;
      border-color: #2a4a45;
    }
    .panel {
      border-color: #2a3736;
    }
    .link-system,
    .chip-button,
    .sync {
      color: #0f1615;
      background: #56b7a9;
      border-color: #56b7a9;
    }
    .problem {
      color: #e88b7d;
    }
  }
</style>
