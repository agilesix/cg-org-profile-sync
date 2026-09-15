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

    onclose: () => void;

    /** Which step to resume on after a same-tab round trip, if any. */
    resume?: { sourceId: string } | null;
  }

  let { open, sources, onstart, outcome, onclose, resume = null }: Props = $props();

  type Step = "pick" | "sign-in" | "waiting" | "denied";

  let dialog = $state<HTMLDialogElement | null>(null);
  let step = $state<Step>("pick");
  let chosen = $state<SystemView | null>(null);

  /** Set when a popup was closed without finishing, so the step can say so. */
  let note = $state<string | null>(null);

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
    step = outcome?.sourceId === source.id && outcome.result === "denied" ? "denied" : "sign-in";
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
      // A token. #1188-T7 turns this into the organization step; until then
      // the system is simply linked and there is nothing more to ask.
      close();
    }
  });

  function close(): void {
    step = "pick";
    chosen = null;
    note = null;
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
  }
</style>
