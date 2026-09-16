<script lang="ts">
  import type { PageData } from "./$types.js";

  const { data }: { data: PageData } = $props();

  const routes = [
    { verb: "GET", path: "/common-grants/orgs", note: "list, filtered by ?registry= &id=" },
    { verb: "GET", path: "/common-grants/orgs/{orgId}", note: "read one profile" },
    { verb: "PATCH", path: "/common-grants/orgs/{orgId}", note: "apply a JSON Merge Patch" },
    { verb: "POST", path: "/token", note: "mint this system's own access token" },
    { verb: "GET", path: "/.well-known/jwks.json", note: "this system's public keys" },
  ];

  const modes = {
    fixture: "Serving an in-memory stand-in for Temelio's API. Nothing leaves this process.",
    sandbox: "Serving Temelio's real API, as a foundation, over the grantees it is allowed.",
  };
</script>

<main>
  <p class="role">CommonGrants proxy</p>
  <h1>Temelio adapter</h1>
  <p class="tagline">
    Speaks CommonGrants on the front and Temelio's own API on the back, to find out whether the
    contract retrofits onto a system nobody built for it.
  </p>

  <h2>Routes</h2>
  <ul>
    <!-- Keyed on verb and path together. The path alone is not unique — two
         entries share one and differ only by verb — and a duplicate key throws
         `each_key_duplicate`, which rendered no list at all. A constant list
         like this needs no key to reconcile correctly, but `require-each-key`
         is on for the repo, so the answer is a key that is actually unique. -->
    {#each routes as route (`${route.verb} ${route.path}`)}
      <li>
        <code><span class="verb">{route.verb}</span> {route.path}</code>
        <span class="note">{route.note}</span>
      </li>
    {/each}
  </ul>
  <p class="status" data-testid="mode">
    <strong>{data.mode} mode.</strong>
    {modes[data.mode]}
  </p>

  <h2>Serving</h2>
  {#if data.mode === "sandbox"}
    <p class="note" data-testid="sandbox-note">
      {data.count}
      {data.count === 1 ? "grantee" : "grantees"}, held by Temelio. This page does not print a real
      organization's record, or the ids that would say whose it is — it is served without a
      credential.
      {#if data.vendorAppUrl}
        <!-- `rel="external"` because this leaves the app entirely: it tells
             SvelteKit not to try client-side routing for it, which is also what
             satisfies the navigation lint rule for a URL it cannot prove is
             off-site. -->
        <a href={data.vendorAppUrl} rel="external noreferrer">Open Temelio</a> to see them.
      {/if}
    </p>
  {:else if data.orgs.length === 0}
    <p class="note" data-testid="no-orgs">
      No organizations. In sandbox mode that means <code>TEMELIO_ORG_ALLOWLIST</code> is empty.
    </p>
  {:else}
    {#each data.orgs as org (org.id)}
      <section class="profile" data-testid="profile-{org.id}">
        <h3>{org.name}</h3>
        <dl>
          {#each org.fields as field (field.label)}
            <dt>{field.label}</dt>
            <dd data-testid="field-{field.label}">{field.value || "—"}</dd>
          {/each}
        </dl>
      </section>
    {/each}
  {/if}
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
  .profile {
    margin: 0 0 1.25rem;
  }
  .profile h3 {
    margin: 0 0 0.35rem;
    font-size: 1rem;
  }
  dl {
    display: grid;
    grid-template-columns: 11rem 1fr;
    gap: 0.2rem 1rem;
    margin: 0;
  }
  dt {
    color: #4a5c5a;
  }
  dd {
    margin: 0;
  }
  .note {
    color: #4a5c5a;
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
