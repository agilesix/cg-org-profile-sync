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
  import { onMount, untrack } from "svelte";
  import type {
    ApiError,
    CompareResult,
    JsonValue,
    SyncResult,
    SyncTargetResult,
  } from "$lib/api-types.js";
  import ComparisonGrid from "$lib/components/ComparisonGrid.svelte";
  import LinkModal from "$lib/components/LinkModal.svelte";
  import SyncResults from "$lib/components/SyncResults.svelte";
  import {
    formatFieldValue,
    type ConnectOutcome,
    type Selection,
    type SystemView,
  } from "$lib/demo.js";
  import {
    forget,
    listenForConnect,
    readDenied,
    readTokens,
    rememberDenied,
    rememberToken,
  } from "$lib/tokens.js";
  import type { PageData } from "./$types.js";

  let { data }: { data: PageData } = $props();

  /**
   * Everything below seeds from the server load and is then owned by the page.
   *
   * `untrack` says that out loud: the load runs once per navigation, and every
   * update after it comes from `/api/compare`, so re-reading `data` would only
   * ever put the first paint back. Without it Svelte warns, rightly, that a
   * prop read here is not reactive.
   */
  let registry = $state(untrack(() => data.registry));
  let id = $state(untrack(() => data.id));

  /** What the lookup field holds, which is not the same as what is loaded. */
  let einInput = $state(untrack(() => data.id));

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

  /** Null until at least one system is connected — there is nothing to read before that. */
  let comparison = $state.raw<CompareResult | null>(null);
  let selection = $state<Selection | null>(null);
  let targets = $state<string[]>([]);
  let results = $state.raw<SyncTargetResult[] | null>(null);

  /** One flag for both requests: neither should overlap itself or the other. */
  let busy = $state(false);

  /** Something Link itself refused or could not do. Per-target failures are not this. */
  let problem = $state<string | null>(null);

  /** Whether the picker is up, and how the attempt it is watching ended. */
  let modalOpen = $state(false);
  let outcome = $state<ConnectOutcome | null>(null);

  /** Set from `?resume=` so a same-tab round trip reopens where it left off. */
  let resume = $state<{ sourceId: string } | null>(null);

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
   * The popup being waited on, so closing it by hand is not silence.
   *
   * A window someone shut is not a refusal and not an error; without this the
   * modal would spin on a window that is gone.
   */
  let watching: { sourceId: string; timer: ReturnType<typeof setInterval> } | null = null;

  onMount(() => {
    tokens = readTokens();
    denied = readDenied();
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

    void reload();

    return () => {
      stopWatching();
      stop();
    };
  });

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
              ? "connected"
              : "not-connected";

        return { ...source, connection };
      }),
  );

  /** Only the systems worth a chip: one nothing has happened with says nothing. */
  const chips = $derived(sourceStates.filter((source) => source.connection !== "not-connected"));

  const connectedCount = $derived(Object.keys(tokens).length);

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

  /** The systems a change could actually reach, given what is picked. */
  const candidates = $derived(
    (comparison?.sources ?? []).filter(
      (source) => source.id !== selection?.sourceId && source.orgId !== null && !source.error,
    ),
  );

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

  const canSync = $derived(selection !== null && chosen.length > 0 && !busy);

  /** Every request to Link's own API carries the whole set of tokens, or none. */
  function authHeaders(): Record<string, string> {
    return { [SOURCE_TOKENS_HEADER]: sourceTokensHeader(tokens) };
  }

  /**
   * Where the sign-in round trip should come back to.
   *
   * Carries `resume` as well as the org, so a browser that blocked the popup
   * and navigated this tab instead comes back to the step it was on rather
   * than to an empty widget.
   */
  function returnPath(sourceId: string): string {
    return `/?${new URLSearchParams({ registry, id, resume: sourceId })}`;
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
      resume = { sourceId: requested };
      outcome = { sourceId: requested, result: "denied" };
      modalOpen = true;
    } else if (!tokens[requested]) {
      // Honoured only if it names a system we could actually connect; the
      // modal ignores anything else rather than opening an empty step.
      resume = { sourceId: requested };
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

  /** Drop what we knew about a system and start its sign-in again. */
  function reconnect(sourceId: string): void {
    forget(sourceId);
    tokens = Object.fromEntries(
      Object.entries(tokens).filter(([candidate]) => candidate !== sourceId),
    );
    denied = denied.filter((candidate) => candidate !== sourceId);
    resume = { sourceId };
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
    selection = { path, label, sourceId, value };

    // `candidates` is derived from `selection`, and deriveds in Svelte 5 are
    // recomputed on read, so this already reflects the line above.
    targets = candidates.map((source) => source.id);
    results = null;
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
   * `registry`/`id` name the org the grid is showing, so they move together
   * with `comparison` and only on success. Setting them first would leave a
   * failed lookup claiming to be showing an org it is not — and a value picked
   * off that stale grid would then be pushed under the new id, writing one
   * organization's address onto another.
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
      registry = nextRegistry;
      id = nextId;

      return true;
    } catch (cause) {
      problem = `The systems could not be read: ${describe(cause)}`;
      return false;
    }
  }

  /**
   * Read the org on screen, if there is anyone to read it as.
   *
   * With nothing connected there is no request worth making: every column
   * would come back "not connected", and the empty state above already says
   * more plainly that nothing has been linked yet.
   */
  async function reload(): Promise<boolean> {
    if (connectedCount === 0) {
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
   * Look the org up by whatever EIN is in the field.
   *
   * The selection is dropped rather than carried across: it names a value held
   * by a source for *this* org, and after the lookup the same cell may hold
   * something else entirely. Syncing a stale pick would write one org's
   * address onto another.
   */
  async function lookUp(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;

    selection = null;
    targets = [];
    results = null;
    problem = null;
    busy = true;

    try {
      await load(registry, einInput.trim());
    } finally {
      busy = false;
    }
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
    if (selection === null || chosen.length === 0 || busy) return;

    busy = true;
    results = null;
    problem = null;

    try {
      const response = await fetch("/api/sync", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          registry,
          id,
          path: selection.path,
          value: selection.value,
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

  /** What a source allows, in the words the widget uses for it. */
  function capabilityWords(capabilities: { read: boolean; write: boolean }): string {
    const allowed = [
      capabilities.read ? "pull" : undefined,
      capabilities.write ? "push" : undefined,
    ].filter((word): word is string => word !== undefined);

    return allowed.length === 0 ? "no access" : allowed.join(" and ");
  }
</script>

<main data-testid="widget" data-ready={ready}>
  <p class="role">Widget</p>
  <h1>CommonGrants Link</h1>
  <p class="tagline">
    Link the systems that hold your organization's profile, see where their copies disagree, and
    push the corrections back out.
  </p>

  <button type="button" class="link-system" data-testid="link-system" onclick={openPicker}>
    Link Grant Management System
  </button>

  {#if chips.length > 0}
    <ul class="chips" data-testid="linked-systems">
      {#each chips as source (source.id)}
        <li data-testid="system-{source.id}">
          <span class="chip-name">{source.label}</span>
          <span class="chip-caps">{capabilityWords(source.capabilities)}</span>

          {#if source.connection === "connected"}
            <span class="chip-ok" data-testid="connected-{source.id}">Linked</span>
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

  {#if comparison === null}
    <p class="prompt" data-testid="nothing-linked">
      Nothing is linked yet. Link a grant management system to see how the copies of your profile
      compare.
    </p>
  {:else}
    <form onsubmit={lookUp}>
      <label for="ein">EIN</label>
      <input id="ein" data-testid="ein" name="ein" bind:value={einInput} spellcheck="false" />
      <button type="submit" data-testid="look-up" disabled={busy}>Look up</button>
    </form>

    <ComparisonGrid {comparison} {selection} onpick={pick} />

    <section class="panel" data-testid="panel">
      {#if selection === null}
        <p class="prompt" data-testid="prompt">
          Click the value a system holds to choose it as the correct one.
        </p>
      {:else}
        <p class="chosen" data-testid="selection">
          <span class="chosen-field">{selection.label}</span>
          <span class="chosen-value">{formatFieldValue(selection.value) || "(empty)"}</span>
          <span class="chosen-from">from {labels[selection.sourceId] ?? selection.sourceId}</span>
        </p>

        {#if candidates.length === 0}
          <p class="prompt" data-testid="no-targets">
            No other system holds a record of this organization, so there is nowhere to send this.
          </p>
        {:else}
          <fieldset>
            <legend>Send it to</legend>
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

        <button type="button" class="sync" data-testid="sync" disabled={!canSync} onclick={sync}>
          {busy ? "Syncing…" : "Sync"}
        </button>
      {/if}

      {#if results}
        <SyncResults {results} {labels} />
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
  {resume}
  onclose={closePicker}
/>

<style>
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
    margin: 1.75rem 0 0;
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
  form {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    margin: 2rem 0 1.5rem;
  }
  form label {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.72rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #6b7a77;
  }
  #ein {
    font: inherit;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.85rem;
    padding: 0.3rem 0.5rem;
    width: 9rem;
    color: inherit;
    background: transparent;
    border: 1px solid #b7c4c1;
    border-radius: 0.3rem;
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
  .chosen {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.3rem 0.75rem;
    font-size: 0.9rem;
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
  button[type="submit"],
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
    .chip-caps {
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
    form label,
    legend,
    .prompt,
    .chosen-field,
    .chosen-from {
      color: #8a9895;
    }
    #ein {
      border-color: #3f5250;
    }
    .panel {
      border-color: #2a3736;
    }
    .link-system,
    .chip-button,
    button[type="submit"],
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
