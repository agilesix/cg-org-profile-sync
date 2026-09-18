<script lang="ts">
  import { resolve } from "$app/paths";
  import type { PageData } from "./$types.js";

  let { data }: { data: PageData } = $props();

  const routes = [
    {
      verb: "GET",
      path: "/common-grants/orgs",
      note: "list, filtered by ?registry= &id=",
      live: true,
    },
    { verb: "GET", path: "/common-grants/orgs/{orgId}", note: "read one profile", live: true },
    {
      verb: "PATCH",
      path: "/common-grants/orgs/{orgId}",
      note: "apply a JSON Merge Patch",
      live: true,
    },
    { verb: "POST", path: "/token", note: "mint this system's own access token", live: true },
    { verb: "GET", path: "/.well-known/jwks.json", note: "this system's public keys", live: true },
  ];
</script>

<main>
  <p class="role">CommonGrants server</p>
  <h1>FunderHub</h1>
  <p class="tagline">
    A second system speaking the same routes, so the comparison has more than two columns to work
    with.
  </p>

  {#if data.profile}
    <h2>Profile</h2>
    <p class="profile">
      <a href={resolve("/orgs/[orgId]", { orgId: data.profile.id })} data-testid="profile-link"
        >{data.profile.name}</a
      >
      <span class="note">this system's copy, editable</span>
    </p>
  {/if}

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
        {#if !route.live}<span class="pending">not yet</span>{/if}
      </li>
    {/each}
  </ul>
  <p class="status">
    The three org routes are live, behind an access token that names the organizations its bearer
    may touch, over an in-memory store that re-seeds whenever the dev server restarts. This system
    declines <code>socials</code>, <code>yearFounded</code> and <code>orgType</code>: a patch
    setting one is accepted, dropped, and named back to the sender. It publishes the public half of
    its signing key, and signs in a person through its own OAuth flow to mint them a token scoped to
    the organizations they may touch here.
  </p>
</main>

<style>
  main {
    max-width: 46rem;
    margin: 0 auto;
    padding: 2.5rem 1.5rem 4rem;
  }
  .role {
    margin: 0 0 0.5rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.72rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--brand);
  }
  h1 {
    margin: 0 0 0.75rem;
    font-size: 2.25rem;
    letter-spacing: -0.02em;
  }
  .tagline {
    margin: 0 0 2.5rem;
    font-size: 1.1rem;
    color: var(--ink-soft);
    max-width: 34rem;
  }
  h2 {
    margin: 0 0 0.75rem;
    font-size: 0.72rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--muted);
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    border-top: 1px solid var(--border);
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
    color: var(--brand);
    font-weight: 600;
  }
  .profile {
    margin: 0 0 1.5rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem 0.9rem;
    align-items: baseline;
    border-top: 1px solid var(--border);
    padding-top: 0.9rem;
  }
  .profile a {
    color: var(--brand);
  }
  .note {
    font-size: 0.85rem;
    color: var(--muted);
  }
  .pending {
    font-size: 0.7rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
    border: 1px solid var(--border);
    border-radius: 0.2rem;
    padding: 0 0.35rem;
  }
  .status {
    margin-top: 2.5rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border);
    font-size: 0.85rem;
    color: var(--muted);
  }
</style>
