<script lang="ts">
  import { onMount } from "svelte";
  import { invalidateAll } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { formatFieldValue, getAtPath } from "@cg-link/org-sync/utils";
  import type { ActionData, PageData } from "./$types.js";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  /**
   * The rest of the profile, shown as this system stores it.
   *
   * A flat list of paths read through `getAtPath`, so a field the system does
   * not hold renders as a dash rather than as a hole in the layout.
   */
  const readOnly = [
    { label: "Record id", path: "id" },
    { label: "UEI", path: "identifiers.org:us:uei.id" },
    { label: "Year founded", path: "yearFounded" },
    { label: "LinkedIn", path: "socials.linkedin" },
  ];

  /** The address parts the form edits, in the order someone writes them. */
  const addressFields = [
    { name: "street1", label: "Street" },
    { name: "street2", label: "Suite or unit" },
    { name: "city", label: "City" },
    { name: "stateOrProvince", label: "State or province" },
    { name: "country", label: "Country" },
    { name: "postalCode", label: "Postal code" },
  ] as const;

  const org = $derived(data.org);
  const address = $derived(org.addresses?.primary);

  /** One read-only field as a line, or a dash when nothing is held. */
  function shown(path: string): string {
    return formatFieldValue(getAtPath(org, path)) || "—";
  }

  /**
   * Whether this page can open the widget at all.
   *
   * Needs both a Link to open and an EIN to open it on: the widget matches one
   * organization across systems by identifier, since no two of them agree on
   * ids, so a record without one is a record it cannot look up anywhere.
   */
  const canOpenLink = $derived(data.linkOrigin !== null && data.ein !== null);

  /**
   * Whether the browser has taken this page over.
   *
   * The form works without JavaScript — it is a plain `POST` — but Open Link
   * does not, and the whole page is server-rendered, so that button is
   * clickable a moment before it does anything. Publishing hydration is what
   * lets a spec wait for something true instead of sleeping, the same way the
   * widget does.
   */
  let ready = $state(false);

  onMount(() => {
    ready = true;
  });

  /** One in-flight fetch of the loader, so two clicks load one script. */
  let loader: Promise<NonNullable<Window["CgLink"]>> | null = null;

  /** Anything that stopped the widget opening, said on the page. */
  let linkProblem = $state<string | null>(null);

  /**
   * Fetch Link's loader from Link's own origin, once.
   *
   * Injected on demand rather than included in `<svelte:head>`: a script added
   * to the head during a client-side navigation is not executed, and this page
   * is reached by a link from the landing page. On demand also means a page
   * nobody embeds from fetches nothing.
   */
  function loadLoader(origin: string): Promise<NonNullable<Window["CgLink"]>> {
    if (window.CgLink) {
      return Promise.resolve(window.CgLink);
    }

    loader ??= new Promise((accept, refuse) => {
      const script = document.createElement("script");

      script.src = `${origin}/embed.js`;
      script.onload = () =>
        window.CgLink
          ? accept(window.CgLink)
          : refuse(new Error(`${origin}/embed.js loaded but defined no widget.`));
      script.onerror = () => {
        // Cleared so a later click retries rather than re-rejecting forever —
        // the usual cause is Link not being up yet.
        loader = null;
        refuse(new Error(`Link could not be reached at ${origin}.`));
      };

      document.head.appendChild(script);
    });

    return loader;
  }

  /**
   * Open the widget over this page, pointed at this organization.
   *
   * `onSynced` and `onClose` both re-run the server load, which is what makes
   * a change made inside the frame appear here without a reload. Refreshing on
   * close as well as on sync is deliberate belt-and-braces: a message missed
   * for any reason would otherwise leave this page showing stale values with
   * no way back but F5.
   */
  async function openLink(): Promise<void> {
    if (data.linkOrigin === null || data.ein === null) return;

    linkProblem = null;

    try {
      const cgLink = await loadLoader(data.linkOrigin);

      cgLink.open({
        linkOrigin: data.linkOrigin,
        registry: data.registry,
        id: data.ein,
        host: data.system,
        token: data.hostToken,
        onSynced: () => void invalidateAll(),
        onClose: () => void invalidateAll(),
      });
    } catch (cause) {
      linkProblem = cause instanceof Error ? cause.message : String(cause);
    }
  }
</script>

<main data-testid="profile" data-ready={ready}>
  <p class="role">Organization profile</p>
  <h1>{org.name}</h1>
  <p class="tagline">
    This system's own copy. The fields the demo compares are editable here; everything else is shown
    as it is stored.
  </p>

  {#if canOpenLink}
    <p class="open-link">
      <button type="button" data-testid="open-link" onclick={openLink} disabled={!ready}
        >Open Link</button
      >
      <span class="note">compare this profile with the other systems, and fix what disagrees</span>
    </p>
  {/if}

  {#if linkProblem}
    <p class="problem" role="status" data-testid="link-problem">{linkProblem}</p>
  {/if}

  <h2>As this system holds it</h2>
  <dl>
    {#each readOnly as field (field.path)}
      <div class="row">
        <dt>{field.label}</dt>
        <dd data-testid="field-{field.path}">{shown(field.path)}</dd>
      </div>
    {/each}
  </dl>

  <h2>Edit</h2>
  <form method="POST">
    {#if data.edits.name}
      <label for="input-name">Legal name</label>
      <input id="input-name" data-testid="input-name" name="name" value={org.name} />
    {/if}

    {#if data.edits.ein}
      <label for="input-ein">EIN</label>
      <input
        id="input-ein"
        data-testid="input-ein"
        name="ein"
        value={org.identifiers?.["org:us:ein"]?.id ?? ""}
      />
    {/if}

    {#if data.edits.website}
      <label for="input-website">Website</label>
      <input
        id="input-website"
        data-testid="input-website"
        name="website"
        value={org.socials?.website ?? ""}
      />
    {/if}

    {#if data.edits.mission}
      <label for="input-mission">Mission</label>
      <textarea
        id="input-mission"
        data-testid="input-mission"
        name="mission"
        rows="3"
        value={org.mission ?? ""}></textarea>
    {/if}

    {#if data.edits.email}
      <label for="input-email">Email</label>
      <input
        id="input-email"
        data-testid="input-email"
        name="email"
        value={org.emails?.primary ?? ""}
      />
    {/if}

    {#if data.edits.phone}
      <!--
        The number only. The country code is this system's to keep: a merge
        patch leaves the siblings it does not name alone, so editing the number
        here cannot strip the `+1` off a record.
      -->
      <label for="input-phone">Phone</label>
      <input
        id="input-phone"
        data-testid="input-phone"
        name="phone"
        value={org.phones?.primary.number ?? ""}
      />
    {/if}

    {#if data.edits.address}
      <fieldset>
        <legend>Primary address</legend>
        {#each addressFields as field (field.name)}
          <label for="input-{field.name}">{field.label}</label>
          <input
            id="input-{field.name}"
            data-testid="input-{field.name}"
            name={field.name}
            value={address?.[field.name] ?? ""}
          />
        {/each}
      </fieldset>
    {/if}

    <div class="save">
      <button type="submit" data-testid="save">Save</button>
      {#if form}
        <p class="message" class:failed={!form.ok} data-testid="save-message">{form.message}</p>
      {/if}
    </div>
  </form>

  <p class="status">
    A save goes through the same validation and unwritable-field rules as
    <code>PATCH /common-grants/orgs/{"{orgId}"}</code>, so an edit made here and one pushed by the
    Link widget are the same edit. The store is in memory:
    <code>POST /__test/reset</code>, or a dev server restart, puts it back to the seed.
  </p>
  <p class="status"><a href={resolve("/")}>Back to FunderHub</a></p>
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
    margin: 2.5rem 0 0.75rem;
    font-size: 0.72rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--muted);
  }
  dl {
    margin: 0;
    border-top: 1px solid var(--border);
    padding-top: 0.9rem;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.2rem 0.9rem;
    align-items: baseline;
    margin-bottom: 0.5rem;
  }
  dt {
    flex: 0 0 9rem;
    font-size: 0.85rem;
    color: var(--muted);
  }
  dd {
    margin: 0;
    font-size: 0.9rem;
  }
  form {
    border-top: 1px solid var(--border);
    padding-top: 0.9rem;
  }
  label {
    display: block;
    font-size: 0.85rem;
    color: var(--muted);
    margin-bottom: 0.2rem;
  }
  input,
  textarea {
    display: block;
    width: 100%;
    box-sizing: border-box;
    margin-bottom: 0.9rem;
    padding: 0.45rem 0.6rem;
    font: inherit;
    font-size: 0.9rem;
    color: inherit;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 0.25rem;
  }
  input:focus-visible,
  textarea:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 1px;
  }
  fieldset {
    margin: 0 0 1rem;
    padding: 0.9rem 1rem 0;
    border: 1px solid var(--border);
    border-radius: 0.25rem;
  }
  legend {
    padding: 0 0.4rem;
    font-size: 0.72rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .open-link {
    margin: 0 0 2rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem 0.9rem;
    align-items: baseline;
  }
  .note {
    font-size: 0.85rem;
    color: var(--muted);
  }
  .problem {
    margin: 0 0 2rem;
    font-size: 0.85rem;
    color: var(--danger);
  }
  .save {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem 1rem;
    align-items: center;
  }
  button {
    font: inherit;
    font-size: 0.9rem;
    padding: 0.45rem 1.1rem;
    color: var(--surface);
    background: var(--brand);
    border: 1px solid var(--brand);
    border-radius: 0.25rem;
    cursor: pointer;
  }
  .message {
    margin: 0;
    font-size: 0.85rem;
    color: var(--ok);
  }
  .message.failed {
    color: var(--danger);
  }
  .status {
    margin-top: 2.5rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border);
    font-size: 0.85rem;
    color: var(--muted);
  }
  .status + .status {
    margin-top: 0;
    padding-top: 0;
    border-top: none;
  }
  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.85rem;
  }
  a {
    color: var(--brand);
  }
</style>
