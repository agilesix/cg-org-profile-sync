<!--
  The searchable list of grant management systems, as the picker shows it.

  Two kinds of row, and the difference is the whole point of listing more than
  two systems: the ones this demo can actually sign in to, and the ones it only
  names. A named system is not hidden and not disabled-looking-like-a-bug — it
  says "Coming soon" on the row, because the list is meant to read as a network
  a nonprofit would recognise rather than a pair of test servers.
-->

<script lang="ts">
  import type { SystemView } from "$lib/demo.js";

  interface Props {
    /** Every system in the catalog, in registry order. */
    sources: SystemView[];

    /** Called when a connectable row is chosen. Named rows never call it. */
    onpick: (source: SystemView) => void;
  }

  let { sources, onpick }: Props = $props();

  let query = $state("");

  /**
   * Filtered by name only.
   *
   * Searching the website too would match `.com` against everything the moment
   * someone typed a dot, which is worse than not matching at all.
   */
  const matches = $derived(
    sources.filter((source) => source.label.toLowerCase().includes(query.trim().toLowerCase())),
  );

  /**
   * Two letters standing in for a logo.
   *
   * Capitals first, because these names are mostly compounds — GrantPortal,
   * FunderHub, SimplerGrants — and "GP" reads as a mark where "GR" reads as a
   * typo. A single-word name falls back to its first two letters.
   */
  function monogram(label: string): string {
    const capitals = label.replace(/[^A-Z]/g, "");

    return (capitals.length >= 2 ? capitals.slice(0, 2) : label.slice(0, 2)).toUpperCase();
  }
</script>

<div class="search">
  <label for="system-search">Search</label>
  <!--
    Focused on open. A `<dialog>` with nothing marked `autofocus` puts focus on
    the dialog element itself, so a keyboard user lands nowhere useful and has
    to Tab into the list before they can do anything.
  -->
  <!-- svelte-ignore a11y_autofocus -->
  <input
    id="system-search"
    data-testid="system-search"
    type="search"
    placeholder="Search grant management systems"
    autocomplete="off"
    autofocus
    bind:value={query}
  />
</div>

<ul class="systems">
  {#each matches as source (source.id)}
    <li>
      {#if source.connectable}
        <button
          type="button"
          class="row"
          data-testid="pick-system-{source.id}"
          onclick={() => onpick(source)}
        >
          <span class="monogram" aria-hidden="true">{monogram(source.label)}</span>
          <span class="text">
            <span class="name">{source.label}</span>
            {#if source.website}<span class="site">{source.website}</span>{/if}
          </span>
        </button>
      {:else}
        <div class="row soon" data-testid="system-soon-{source.id}" aria-disabled="true">
          <span class="monogram" aria-hidden="true">{monogram(source.label)}</span>
          <span class="text">
            <span class="name">{source.label}</span>
            {#if source.website}<span class="site">{source.website}</span>{/if}
          </span>
          <span class="soon-tag">Coming soon</span>
        </div>
      {/if}
    </li>
  {/each}

  {#if matches.length === 0}
    <li class="empty" data-testid="no-systems">No systems match “{query.trim()}”.</li>
  {/if}
</ul>

<style>
  .search {
    padding: 0 1.5rem 0.75rem;
  }
  .search label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  .search input {
    font: inherit;
    width: 100%;
    box-sizing: border-box;
    padding: 0.5rem 0.75rem;
    color: inherit;
    background: transparent;
    border: 1px solid #b7c4c1;
    border-radius: 0.4rem;
  }
  .systems {
    margin: 0;
    padding: 0 0 0.5rem;
    list-style: none;
    max-height: 22rem;
    overflow-y: auto;
  }
  .row {
    font: inherit;
    text-align: left;
    color: inherit;
    width: 100%;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 0.85rem;
    padding: 0.7rem 1.5rem;
    background: transparent;
    border: 0;
    border-top: 1px solid #edf1f0;
  }
  button.row {
    cursor: pointer;
  }
  button.row:hover,
  button.row:focus-visible {
    background: #f2f6f5;
  }
  .monogram {
    flex: none;
    width: 2.25rem;
    height: 2.25rem;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: #0d6e63;
    color: #ffffff;
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.02em;
  }
  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .name {
    font-weight: 600;
  }
  .site {
    font-size: 0.8rem;
    color: #6b7a77;
  }
  .soon {
    /* Legible, not invisible: the row is meant to be read, just not clicked. */
    opacity: 0.55;
  }
  .soon-tag {
    margin-left: auto;
    flex: none;
    font-size: 0.68rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #6b7a77;
  }
  .empty {
    padding: 1.25rem 1.5rem;
    font-size: 0.85rem;
    color: #6b7a77;
  }

  @media (prefers-color-scheme: dark) {
    .search input {
      border-color: #3f5250;
    }
    .row {
      border-top-color: #22302e;
    }
    button.row:hover,
    button.row:focus-visible {
      background: #1a2625;
    }
    .monogram {
      background: #56b7a9;
      color: #0f1615;
    }
    .site,
    .soon-tag,
    .empty {
      color: #8a9895;
    }
  }
</style>
