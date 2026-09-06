<script lang="ts">
  const routes = [
    { verb: "GET", path: "/common-grants/orgs", note: "list, filtered by ?registry= &id=" },
    { verb: "GET", path: "/common-grants/orgs/{orgId}", note: "read one profile" },
    { verb: "PATCH", path: "/common-grants/orgs/{orgId}", note: "apply a JSON Merge Patch" },
    { verb: "POST", path: "/token", note: "mint this system's own access token" },
    { verb: "GET", path: "/.well-known/jwks.json", note: "this system's public keys" },
  ];
</script>

<main>
  <p class="role">CommonGrants server</p>
  <h1>FunderHub</h1>
  <p class="tagline">
    A second system speaking the same routes, so the comparison has more than two columns to work
    with.
  </p>

  <h2>Routes</h2>
  <ul>
    {#each routes as route (route.path)}
      <li>
        <code><span class="verb">{route.verb}</span> {route.path}</code>
        <span class="note">{route.note}</span>
      </li>
    {/each}
  </ul>
  <p class="status">Not implemented yet — this app is a scaffold.</p>
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
    max-width: 46rem;
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
    margin: 0 0 2.5rem;
    font-size: 1.1rem;
    color: #3b4a48;
    max-width: 34rem;
  }
  h2 {
    margin: 0 0 0.75rem;
    font-size: 0.72rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #6b7a77;
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    border-top: 1px solid #d9e0dd;
    padding-top: 0.9rem;
  }
  li {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem 0.9rem;
    align-items: baseline;
  }
  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.85rem;
  }
  .verb {
    color: #0d6e63;
    font-weight: 600;
  }
  .note {
    font-size: 0.85rem;
    color: #6b7a77;
  }
  .status {
    margin-top: 2.5rem;
    padding-top: 1rem;
    border-top: 1px solid #d9e0dd;
    font-size: 0.85rem;
    color: #6b7a77;
  }

  @media (prefers-color-scheme: dark) {
    :global(body) {
      background: #0f1615;
      color: #e7edeb;
    }
    .role,
    .verb {
      color: #56b7a9;
    }
    .tagline {
      color: #bac6c3;
    }
    h2,
    .note,
    .status {
      color: #8a9895;
    }
    ul,
    .status {
      border-color: #2a3736;
    }
  }
</style>
