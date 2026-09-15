<script lang="ts">
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
    { label: "Mission", path: "mission" },
    { label: "Email", path: "emails.primary" },
    { label: "Phone", path: "phones.primary.number" },
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
</script>

<main data-testid="profile">
  <p class="role">GrantPortal · organization profile</p>
  <h1>{org.name}</h1>
  <p class="tagline">
    This system's own copy. The four fields the demo compares are editable here; everything else is
    shown as it is stored.
  </p>

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
    <label for="input-name">Legal name</label>
    <input id="input-name" data-testid="input-name" name="name" value={org.name} />

    <label for="input-ein">EIN</label>
    <input
      id="input-ein"
      data-testid="input-ein"
      name="ein"
      value={org.identifiers?.["org:us:ein"]?.id ?? ""}
    />

    {#if data.editsWebsite}
      <label for="input-website">Website</label>
      <input
        id="input-website"
        data-testid="input-website"
        name="website"
        value={org.socials?.website ?? ""}
      />
    {/if}

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
  <p class="status"><a href={resolve("/")}>Back to GrantPortal</a></p>
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
    margin: 2.5rem 0 0.75rem;
    font-size: 0.72rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #6b7a77;
  }
  dl {
    margin: 0;
    border-top: 1px solid #d9e0dd;
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
    color: #6b7a77;
  }
  dd {
    margin: 0;
    font-size: 0.9rem;
  }
  form {
    border-top: 1px solid #d9e0dd;
    padding-top: 0.9rem;
  }
  label {
    display: block;
    font-size: 0.85rem;
    color: #6b7a77;
    margin-bottom: 0.2rem;
  }
  input {
    display: block;
    width: 100%;
    box-sizing: border-box;
    margin-bottom: 0.9rem;
    padding: 0.45rem 0.6rem;
    font: inherit;
    font-size: 0.9rem;
    color: inherit;
    background: #ffffff;
    border: 1px solid #d9e0dd;
    border-radius: 0.25rem;
  }
  input:focus-visible {
    outline: 2px solid #0d6e63;
    outline-offset: 1px;
  }
  fieldset {
    margin: 0 0 1rem;
    padding: 0.9rem 1rem 0;
    border: 1px solid #d9e0dd;
    border-radius: 0.25rem;
  }
  legend {
    padding: 0 0.4rem;
    font-size: 0.72rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #6b7a77;
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
    color: #ffffff;
    background: #0d6e63;
    border: 1px solid #0d6e63;
    border-radius: 0.25rem;
    cursor: pointer;
  }
  .message {
    margin: 0;
    font-size: 0.85rem;
    color: #0d6e63;
  }
  .message.failed {
    color: #9c2f2f;
  }
  .status {
    margin-top: 2.5rem;
    padding-top: 1rem;
    border-top: 1px solid #d9e0dd;
    font-size: 0.85rem;
    color: #6b7a77;
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
    color: #0d6e63;
  }

  @media (prefers-color-scheme: dark) {
    :global(body) {
      background: #0f1615;
      color: #e7edeb;
    }
    .role,
    a {
      color: #56b7a9;
    }
    .tagline {
      color: #bac6c3;
    }
    h2,
    dt,
    label,
    legend,
    .status {
      color: #8a9895;
    }
    dl,
    form,
    fieldset,
    input,
    .status {
      border-color: #2a3736;
    }
    input {
      background: #16211f;
    }
    .message {
      color: #56b7a9;
    }
    .message.failed {
      color: #e08b8b;
    }
  }
</style>
