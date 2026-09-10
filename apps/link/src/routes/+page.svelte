<!--
  The widget: read every connected system's copy of one org, show where they
  disagree, and push a chosen value back to the systems the person picks.

  Server-rendered from `+page.server.ts` so the grid paints filled in, then
  driven from the browser through Link's own `/api/compare` and `/api/sync`.
  Both fan-outs live in `@cg-link/org-sync/client`; nothing here knows how many
  systems there are, which is the point — a third source is an entry in
  `$lib/server/sources.ts` and this file does not change.
-->

<script lang="ts">
  import { onMount, untrack } from "svelte";
  import type {
    ApiError,
    CompareResult,
    JsonValue,
    SyncResult,
    SyncTargetResult,
  } from "$lib/api-types.js";
  import ComparisonGrid from "$lib/components/ComparisonGrid.svelte";
  import SyncResults from "$lib/components/SyncResults.svelte";
  import { formatFieldValue, type Selection } from "$lib/demo.js";
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

  let comparison = $state.raw<CompareResult>(untrack(() => data.comparison));
  let selection = $state<Selection | null>(null);
  let targets = $state<string[]>([]);
  let results = $state.raw<SyncTargetResult[] | null>(null);

  /** One flag for both requests: neither should overlap itself or the other. */
  let busy = $state(false);

  /** Something Link itself refused or could not do. Per-target failures are not this. */
  let problem = $state<string | null>(null);

  /**
   * Whether the browser has taken the page over.
   *
   * Every control here is server-rendered, so it is clickable a moment before
   * it does anything. Publishing hydration as `data-ready` gives the Playwright
   * specs something to wait for that is true rather than a sleep — without it
   * a fast click lands on inert markup and is silently lost.
   */
  let ready = $state(false);

  onMount(() => {
    ready = true;
  });

  const labels = $derived(
    Object.fromEntries(comparison.sources.map((source) => [source.id, source.label])),
  );

  /** The systems a change could actually reach, given what is picked. */
  const candidates = $derived(
    comparison.sources.filter(
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
      const response = await fetch(`/api/compare?${query}`);

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
        headers: { "content-type": "application/json" },
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
</script>

<main data-testid="widget" data-ready={ready}>
  <p class="role">Widget</p>
  <h1>CommonGrants Link</h1>
  <p class="tagline">
    Reads the org profile from every connected system, shows where they disagree, and pushes the
    corrections back out.
  </p>

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

    {#if problem}
      <p class="problem" role="status" data-testid="problem">{problem}</p>
    {/if}

    {#if results}
      <SyncResults {results} {labels} />
    {/if}
  </section>
</main>

<style>
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
    margin: 0 0 1.5rem;
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
    margin: 0;
    font-size: 0.85rem;
    color: #6b7a77;
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
  button {
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
    margin: 0;
    font-size: 0.85rem;
    color: #a1291f;
  }

  @media (prefers-color-scheme: dark) {
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
    button {
      color: #0f1615;
      background: #56b7a9;
      border-color: #56b7a9;
    }
    .problem {
      color: #e88b7d;
    }
  }
</style>
