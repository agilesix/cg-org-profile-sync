<!--
  The Plaid-shaped flow: pick a system, sign in to it, come back linked.

  This component owns the step someone is on and nothing else. Every decision
  with a consequence — opening the popup, keeping a token, reading a system —
  belongs to the page or to `@cg-link/org-sync`, because `apps/*` has no test
  harness and a state machine that also held the credentials would put the
  interesting half of this ticket somewhere no Vitest can reach.

  A native `<dialog>` rather than a hand-built overlay: Escape, the focus trap
  and the backdrop all come free and correct, and they are exactly the parts a
  hand-built one gets subtly wrong.
-->

<script lang="ts">
  import { selectableOrgs } from "@cg-link/org-sync/utils";
  import type { OrgListResult, OrgLock, OrgSummary, SelectableOrg } from "$lib/api-types.js";
  import type { ConnectOutcome, SystemView } from "$lib/demo.js";
  import SystemList from "./SystemList.svelte";

  interface Props {
    open: boolean;
    sources: SystemView[];

    /**
     * Start one system's sign-in. Answers false when the browser blocked the
     * popup, which is the page's cue to navigate the tab instead.
     */
    onstart: (source: SystemView) => boolean;

    /** How the attempt ended. The page sets this; the modal reacts to it. */
    outcome: ConnectOutcome | null;

    /**
     * Ask one system which organizations this person may touch there.
     *
     * A callback rather than a `fetch` in here, because the request has to
     * carry the tokens and the modal deliberately never holds them.
     */
    loadOrgs: (sourceId: string) => Promise<OrgListResult>;

    /** The organization already linked, if any, which locks what may be picked. */
    lock: OrgLock | null;

    /** Called with the organization chosen, once Continue is pressed. */
    onlinked: (source: SystemView, org: OrgSummary) => void;

    onclose: () => void;

    /** Which system and step to resume on after a same-tab round trip, if any. */
    resume?: { sourceId: string; step: "sign-in" | "orgs" } | null;
  }

  let {
    open,
    sources,
    onstart,
    outcome,
    loadOrgs,
    lock,
    onlinked,
    onclose,
    resume = null,
  }: Props = $props();

  type Step = "pick" | "sign-in" | "waiting" | "orgs" | "no-match" | "denied";

  let dialog = $state<HTMLDialogElement | null>(null);
  let step = $state<Step>("pick");
  let chosen = $state<SystemView | null>(null);

  /** Set when a popup was closed without finishing, so the step can say so. */
  let note = $state<string | null>(null);

  /** The chosen system's organizations, once it has told us. */
  let orgs = $state.raw<SelectableOrg[]>([]);

  /** Which row is picked. One at a time — that is the whole rule. */
  let pickedOrgId = $state<string | null>(null);

  /** True while `/api/orgs` is in flight, so Continue cannot be pressed early. */
  let loadingOrgs = $state(false);

  const canContinue = $derived(pickedOrgId !== null && !loadingOrgs);

  /**
   * Whether the lock is the weaker, name-based kind.
   *
   * Worth saying on screen: matching organizations by name across two systems
   * is a guess, and someone should know that is what they are looking at.
   */
  const lockedByName = $derived(lock !== null && lock.ein === null);

  /**
   * Drive the real dialog from the `open` prop.
   *
   * `showModal()` rather than the `open` attribute, because only the method
   * gives the top layer, the backdrop, the focus trap and Escape.
   */
  $effect(() => {
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  });

  /**
   * Come back to the step a same-tab round trip left off on.
   *
   * Only when the modal opens on a source it can actually connect; a `resume`
   * naming something unknown is ignored rather than opening an empty step.
   *
   * The step is decided here, from what came back with it, rather than set to
   * `sign-in` and corrected a moment later by the outcome effect below. Two
   * effects that have to settle in a particular order to show the right thing
   * keep working until someone reorders them, and a resumed refusal silently
   * reading as "sign in again" is exactly the bug that would follow.
   */
  $effect(() => {
    if (!open || resume === null || chosen !== null) return;

    const source = sources.find((candidate) => candidate.id === resume.sourceId);

    if (!source?.connectable) return;

    chosen = source;

    if (outcome?.sourceId === source.id && outcome.result === "denied") {
      step = "denied";
    } else if (resume.step === "orgs") {
      // A round trip that came back with a token. The sign-in is behind them;
      // what is outstanding is which organization.
      void askForOrgs(source);
    } else {
      step = "sign-in";
    }
  });

  /**
   * React to how the attempt ended.
   *
   * Guarded on the source we are actually waiting on: a token can arrive for a
   * system connected in another tab, and that should update the page's chips
   * without yanking this modal off the step someone is reading.
   */
  $effect(() => {
    if (outcome === null || chosen === null || outcome.sourceId !== chosen.id) return;

    if (outcome.result === "denied") {
      step = "denied";
    } else if (outcome.result === "abandoned") {
      // Not a refusal and not an error: they closed the window. Offer the
      // button again rather than explaining something that did not happen.
      step = "sign-in";
      note = "That window closed before sign-in finished.";
    } else {
      // A token. Which organization it is for is the system's to answer, so
      // the flow is not finished — it moves to the step that asks.
      void askForOrgs(chosen);
    }
  });

  /**
   * Ask the system which organizations this person may touch, and show them.
   *
   * A 401 here means the token we were just handed is already no good, which
   * is a sign-in problem rather than an organization problem — so it goes back
   * to the button rather than showing an empty list.
   */
  async function askForOrgs(source: SystemView): Promise<void> {
    step = "orgs";
    loadingOrgs = true;
    orgs = [];
    pickedOrgId = null;
    note = null;

    try {
      const result = await loadOrgs(source.id);

      if (result.connection === "expired" || result.connection === "not-connected") {
        step = "sign-in";
        note = "That connection expired before we could read your organizations.";
        return;
      }

      orgs = selectableOrgs(result.orgs, lock);

      if (orgs.length === 0) {
        step = "no-match";
        return;
      }

      const selectable = orgs.filter((org) => org.selectable);

      if (selectable.length === 0) {
        // Every organization this system holds belongs to someone else, as far
        // as the lock is concerned. That is its own answer, not an empty list.
        step = "no-match";
        return;
      }

      // Pre-selected when the lock leaves exactly one choice, which is the
      // whole of the second connect: there is nothing to decide, so deciding
      // it for them is not presumptuous.
      if (lock !== null && selectable.length === 1) {
        pickedOrgId = selectable[0]?.id ?? null;
      }
    } catch (cause) {
      step = "sign-in";
      note = `Your organizations could not be read: ${cause instanceof Error ? cause.message : String(cause)}`;
    } finally {
      loadingOrgs = false;
    }
  }

  /** Pick a row, or unpick the one already picked. */
  function pickOrg(org: SelectableOrg): void {
    if (!org.selectable) return;

    pickedOrgId = pickedOrgId === org.id ? null : org.id;
  }

  function confirmOrg(): void {
    const org = orgs.find((candidate) => candidate.id === pickedOrgId);

    if (chosen === null || org === undefined || !org.selectable) return;

    onlinked(chosen, org);
    close();
  }

  function close(): void {
    step = "pick";
    chosen = null;
    note = null;
    orgs = [];
    pickedOrgId = null;
    loadingOrgs = false;
    onclose();
  }

  function pick(source: SystemView): void {
    chosen = source;
    note = null;
    step = "sign-in";
  }

  function start(): void {
    if (chosen === null) return;

    note = null;

    // False means the browser blocked the popup and the page is navigating
    // this tab instead. Leaving the step alone keeps the modal honest: there
    // is no window to wait for.
    if (onstart(chosen)) {
      step = "waiting";
    }
  }
</script>

<dialog
  bind:this={dialog}
  data-testid="link-modal"
  data-step={step}
  aria-labelledby="link-modal-title"
  onclose={close}
>
  <header>
    <h2 id="link-modal-title">
      {#if step === "pick"}
        Select your grant management system
      {:else if step === "orgs"}
        Select your organization
      {:else if chosen}
        {chosen.label}
      {:else}
        Connect a system
      {/if}
    </h2>
    <button
      type="button"
      class="dismiss"
      data-testid="close-modal"
      aria-label="Close"
      onclick={close}>×</button
    >
  </header>

  {#if step === "pick"}
    <SystemList {sources} onpick={pick} />
  {:else if chosen}
    <div class="step">
      {#if step === "sign-in"}
        <p class="lede">
          {chosen.label} signs you in itself, then tells this widget which organizations you may touch
          there.
        </p>

        {#if !chosen.capabilities.read}
          <p class="caution" data-testid="cannot-read">
            This system does not allow its profiles to be read, so it will not appear in the
            comparison.
          </p>
        {/if}

        {#if note}
          <p class="caution" data-testid="sign-in-note">{note}</p>
        {/if}

        <!-- svelte-ignore a11y_autofocus -->
        <button
          type="button"
          class="google"
          data-testid="continue-with-google"
          autofocus
          onclick={start}
        >
          Continue with Google
        </button>
      {:else if step === "waiting"}
        <p class="waiting" data-testid="signing-in">
          <span class="spinner" aria-hidden="true"></span>
          Waiting for sign-in…
        </p>
        <p class="lede">Finish signing in to {chosen.label} in the window that opened.</p>
      {:else if step === "orgs"}
        {#if loadingOrgs}
          <p class="waiting" data-testid="loading-orgs">
            <span class="spinner" aria-hidden="true"></span>
            Reading your organizations…
          </p>
        {:else}
          <p class="lede">
            {#if lock === null}
              {chosen.label} says you may act for these. Pick the one this widget should work on.
            {:else}
              You have already linked {lock.name}, so that is the only organization {chosen.label}
              can be linked to here.
            {/if}
          </p>

          {#if lockedByName}
            <p class="caution" data-testid="locked-by-name">
              Matched by name, because the organization you linked publishes no EIN.
            </p>
          {/if}

          <ul class="orgs">
            {#each orgs as org (org.id)}
              <li>
                <button
                  type="button"
                  class="org"
                  class:picked={pickedOrgId === org.id}
                  data-testid="org-{org.id}"
                  data-selectable={org.selectable}
                  disabled={!org.selectable}
                  aria-pressed={pickedOrgId === org.id}
                  onclick={() => pickOrg(org)}
                >
                  <span class="org-text">
                    <span class="org-name">{org.name}</span>
                    <span class="org-ein">{org.ein ? `EIN ${org.ein}` : "No EIN on file"}</span>
                  </span>
                  {#if org.reason}
                    <span class="org-reason">{org.reason}</span>
                  {/if}
                </button>
              </li>
            {/each}
          </ul>

          <button
            type="button"
            class="google"
            data-testid="confirm-org"
            disabled={!canContinue}
            onclick={confirmOrg}
          >
            Continue
          </button>
        {/if}
      {:else if step === "no-match"}
        <p class="denied" data-testid="no-matching-org">
          {#if lock}
            {chosen.label} holds no organization with EIN {lock.ein ?? "—"}.
          {:else}
            {chosen.label} holds no organization you may act for.
          {/if}
        </p>
        <p class="lede">
          You signed in, but nothing {chosen.label} will let that account touch is the organization you
          linked. Its column will say it has no record of this organization.
        </p>
        <button type="button" class="quiet" data-testid="close-no-match" onclick={close}>
          Close
        </button>
      {:else if step === "denied"}
        <p class="denied" data-testid="denied-{chosen.id}">
          No organization on {chosen.label} for that account.
        </p>
        <p class="lede">
          You signed in, but {chosen.label} has no organization it will let that account touch.
        </p>
        <div class="actions">
          <button type="button" class="google" data-testid="try-another-account" onclick={start}>
            Try another account
          </button>
          <button type="button" class="quiet" data-testid="close-denied" onclick={close}>
            Close
          </button>
        </div>
      {/if}
    </div>
  {/if}
</dialog>

<style>
  dialog {
    width: min(26rem, calc(100vw - 2rem));
    padding: 0;
    color: #14201f;
    background: #ffffff;
    border: 1px solid #d9e0dd;
    border-radius: 0.75rem;
  }
  dialog::backdrop {
    background: rgb(15 22 21 / 0.45);
  }
  header {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
    padding: 1.25rem 1.5rem 0.9rem;
  }
  h2 {
    margin: 0;
    font-size: 1.15rem;
    letter-spacing: -0.01em;
  }
  .dismiss {
    font: inherit;
    font-size: 1.4rem;
    line-height: 1;
    margin-left: auto;
    padding: 0 0.25rem;
    color: #6b7a77;
    background: transparent;
    border: 0;
    cursor: pointer;
  }
  .step {
    padding: 0 1.5rem 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    align-items: flex-start;
  }
  .lede {
    margin: 0;
    font-size: 0.9rem;
    color: #3b4a48;
  }
  .caution {
    margin: 0;
    font-size: 0.85rem;
    color: #8a5a1e;
  }
  .denied {
    margin: 0;
    font-weight: 600;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
  }
  .google,
  .quiet {
    font: inherit;
    font-size: 0.9rem;
    padding: 0.5rem 1.1rem;
    border-radius: 0.35rem;
    cursor: pointer;
  }
  .google {
    color: #ffffff;
    background: #14201f;
    border: 1px solid #14201f;
  }
  .quiet {
    color: inherit;
    background: transparent;
    border: 1px solid #b7c4c1;
  }
  .orgs {
    margin: 0;
    padding: 0;
    list-style: none;
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .org {
    font: inherit;
    text-align: left;
    color: inherit;
    width: 100%;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.6rem 0.8rem;
    background: transparent;
    border: 1px solid #d9e0dd;
    border-radius: 0.4rem;
    cursor: pointer;
  }
  .org:disabled {
    /* Legible, not hidden: someone has to see the organization they cannot pick. */
    opacity: 0.5;
    cursor: not-allowed;
  }
  .org.picked {
    border-color: #0d6e63;
    box-shadow: inset 0 0 0 1px #0d6e63;
  }
  .org-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .org-name {
    font-weight: 600;
  }
  .org-ein {
    font-size: 0.78rem;
    color: #6b7a77;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .org-reason {
    margin-left: auto;
    flex: none;
    font-size: 0.68rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #6b7a77;
  }
  .waiting {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    font-weight: 600;
  }
  .spinner {
    width: 1rem;
    height: 1rem;
    border: 2px solid #b7c4c1;
    border-top-color: #0d6e63;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation-duration: 3s;
    }
  }

  @media (prefers-color-scheme: dark) {
    dialog {
      color: #e7edeb;
      background: #131d1c;
      border-color: #2a3736;
    }
    .dismiss {
      color: #8a9895;
    }
    .lede {
      color: #bac6c3;
    }
    .caution {
      color: #d7a55c;
    }
    .google {
      color: #0f1615;
      background: #e7edeb;
      border-color: #e7edeb;
    }
    .quiet {
      border-color: #3f5250;
    }
    .spinner {
      border-color: #3f5250;
      border-top-color: #56b7a9;
    }
    .org {
      border-color: #2a3736;
    }
    .org.picked {
      border-color: #56b7a9;
      box-shadow: inset 0 0 0 1px #56b7a9;
    }
    .org-ein,
    .org-reason {
      color: #8a9895;
    }
  }
</style>
