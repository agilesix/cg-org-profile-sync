<script lang="ts">
  import { resolve } from "$app/paths";

  let { children } = $props();
</script>

<svelte:head>
  <title>GrantPortal</title>
</svelte:head>

<!--
  The chrome every page of this system sits under.

  It exists so the two portals cannot be mistaken for each other mid-demo: the
  bar is this system's colour, the wordmark names it, and the palette below is
  the only place either of those is written down. The sibling file in
  `apps/funderhub` is this one with a different name and a different palette.
-->
<header class="chrome">
  <a class="wordmark" href={resolve("/")}>GrantPortal</a>
</header>

{@render children()}

<style>
  /*
    The whole palette, as custom properties, so a page styles itself in terms
    of "this system's colour" rather than a hex it repeats. Declared on :root
    rather than on the header so every page under this layout reads them.
  */
  :global(:root) {
    --brand: #8c1c1c;
    --brand-bar: #6d1414;
    --brand-bar-ink: #ffffff;
    --bg: #fdf7f6;
    --surface: #ffffff;
    --border: #e6d8d6;
    --ink: #1f1414;
    --ink-soft: #4a3635;
    --muted: #7b615f;
    --ok: #1f7a4d;
    --danger: #9c2f2f;
  }

  @media (prefers-color-scheme: dark) {
    :global(:root) {
      --brand: #ef9a9a;
      --brand-bar: #481212;
      --brand-bar-ink: #fbe6e5;
      --bg: #171010;
      --surface: #211716;
      --border: #3a2726;
      --ink: #f2e8e7;
      --ink-soft: #d6c3c1;
      --muted: #a48d8b;
      --ok: #6cc596;
      --danger: #e08b8b;
    }
  }

  :global(body) {
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font-family:
      ui-sans-serif,
      system-ui,
      -apple-system,
      "Segoe UI",
      sans-serif;
    line-height: 1.6;
  }

  .chrome {
    position: sticky;
    top: 0;
    /* Under the embedded Link overlay, which is fixed at the top of the
       stacking order, and above everything this system draws itself. */
    z-index: 10;
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem 1rem;
    align-items: baseline;
    justify-content: space-between;
    padding: 0.7rem 1.5rem;
    background: var(--brand-bar);
    color: var(--brand-bar-ink);
    box-shadow: 0 1px 0 rgb(0 0 0 / 12%);
  }
  .wordmark {
    font-size: 1.05rem;
    font-weight: 650;
    letter-spacing: -0.01em;
    color: inherit;
    text-decoration: none;
  }
  .wordmark:hover {
    text-decoration: underline;
  }
</style>
