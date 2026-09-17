<script lang="ts">
  import { resolve } from "$app/paths";

  let { children } = $props();
</script>

<svelte:head>
  <title>FunderHub</title>
</svelte:head>

<!--
  The chrome every page of this system sits under.

  It exists so the two portals cannot be mistaken for each other mid-demo: the
  bar is this system's colour, the wordmark names it, and the palette below is
  the only place either of those is written down. The sibling file in
  `apps/portal` is this one with a different name and a different palette.
-->
<header class="chrome">
  <a class="wordmark" href={resolve("/")}>FunderHub</a>
</header>

{@render children()}

<style>
  /*
    The whole palette, as custom properties, so a page styles itself in terms
    of "this system's colour" rather than a hex it repeats. Declared on :root
    rather than on the header so every page under this layout reads them.
  */
  :global(:root) {
    --brand: #3949ab;
    --brand-bar: #2f3b91;
    --brand-bar-ink: #ffffff;
    --bg: #f7f8fd;
    --surface: #ffffff;
    --border: #d9dcef;
    --ink: #191b2c;
    --ink-soft: #414665;
    --muted: #666d92;
    --ok: #3949ab;
    --danger: #9c2f2f;
  }

  @media (prefers-color-scheme: dark) {
    :global(:root) {
      --brand: #9aa4ef;
      --brand-bar: #232750;
      --brand-bar-ink: #e8eaf6;
      --bg: #10111c;
      --surface: #1a1c2b;
      --border: #2f3350;
      --ink: #e8eaf6;
      --ink-soft: #c3c7e2;
      --muted: #949abb;
      --ok: #9aa4ef;
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
