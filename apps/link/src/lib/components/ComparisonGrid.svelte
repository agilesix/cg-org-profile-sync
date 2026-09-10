<!--
  One row per compared field, one column per system.

  The grid is the whole demo in one screen: where the systems agree, where they
  drift, and who has never heard of a field. Every value a source actually
  holds is a button, because picking one is how a correction starts — including
  on a row that already agrees, which is how the "FunderHub does not store
  socials" case gets demonstrated.

  `data-testid` hooks are deliberate. The Playwright specs select by them rather
  than by copy or column position, so restyling this file cannot break them.
-->

<script lang="ts">
  import type { CompareResult, JsonValue, SourceResolution } from "$lib/api-types.js";
  import { formatValue, type Selection } from "$lib/demo.js";

  interface Props {
    /** The latest fan-out read, in registry order. */
    comparison: CompareResult;

    /** The value currently chosen, so its cell can be marked. */
    selection: Selection | null;

    /** Called when a cell's value is picked as the correct one. */
    onpick: (path: string, label: string, sourceId: string, value: JsonValue) => void;
  }

  let { comparison, selection, onpick }: Props = $props();

  /** Whether this cell holds the value the person has chosen to push. */
  function isPicked(path: string, sourceId: string): boolean {
    return selection?.path === path && selection.sourceId === sourceId;
  }

  /**
   * What to say under a column heading when the source contributed nothing.
   *
   * A system that could not be reached and a system that simply holds no
   * record read very differently — one is broken, the other is the normal
   * state of an org that has never applied there — so they get separate notes
   * rather than one shared "unavailable".
   */
  function note(source: SourceResolution): string | null {
    if (source.error !== undefined) return source.error;
    if (source.orgId === null) return "No record of this organization.";
    return null;
  }
</script>

<table data-testid="grid">
  <thead>
    <tr>
      <th class="field-heading" scope="col">Field</th>
      {#each comparison.sources as source (source.id)}
        <th
          scope="col"
          data-testid="source-{source.id}"
          data-state={source.error !== undefined ? "error" : source.orgId === null ? "empty" : "ok"}
        >
          <span class="source-label">{source.label}</span>
          {#if note(source)}
            <span class="source-note" data-testid="source-note-{source.id}">{note(source)}</span>
          {/if}
        </th>
      {/each}
      <th class="status-heading" scope="col">Status</th>
    </tr>
  </thead>
  <tbody>
    {#each comparison.fields as field (field.path)}
      <tr data-testid="row-{field.path}" data-status={field.status} class={field.status}>
        <th class="field-heading" scope="row">{field.label}</th>
        {#each comparison.sources as source (source.id)}
          {@const value = field.values[source.id]}
          <td
            data-testid="cell-{field.path}-{source.id}"
            data-held={value !== undefined}
            data-selected={isPicked(field.path, source.id)}
          >
            {#if value === undefined}
              <span class="absent" aria-label="not held">—</span>
            {:else}
              <button
                type="button"
                data-testid="pick-{field.path}-{source.id}"
                aria-pressed={isPicked(field.path, source.id)}
                onclick={() => onpick(field.path, field.label, source.id, value)}
              >
                {formatValue(value)}
              </button>
            {/if}
          </td>
        {/each}
        <td class="status" data-testid="status-{field.path}">{field.status}</td>
      </tr>
    {/each}
  </tbody>
</table>

<style>
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
  }
  th,
  td {
    text-align: left;
    vertical-align: top;
    padding: 0.55rem 0.75rem;
    border-bottom: 1px solid #d9e0dd;
  }
  thead th {
    font-size: 0.72rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #6b7a77;
    white-space: normal;
  }
  thead th[data-state="error"] .source-label {
    color: #a1291f;
  }
  .source-note {
    display: block;
    margin-top: 0.25rem;
    font-family: inherit;
    font-size: 0.7rem;
    letter-spacing: 0;
    text-transform: none;
    color: #a1291f;
    max-width: 14rem;
  }
  thead th[data-state="empty"] .source-note {
    color: #6b7a77;
  }
  .field-heading {
    width: 9rem;
    font-weight: 600;
    color: #14201f;
  }
  .status-heading,
  .status {
    width: 5.5rem;
  }
  .status {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.75rem;
    color: #6b7a77;
  }
  tr[data-status="differs"] {
    background: #fdf4e8;
  }
  tr[data-status="differs"] .status {
    color: #97590d;
    font-weight: 600;
  }
  .absent {
    color: #9aa8a5;
  }
  button {
    font: inherit;
    text-align: left;
    color: inherit;
    background: none;
    border: 1px solid transparent;
    border-radius: 0.3rem;
    padding: 0.2rem 0.4rem;
    margin: -0.2rem -0.4rem;
    cursor: pointer;
  }
  button:hover {
    border-color: #b7c4c1;
  }
  td[data-selected="true"] button {
    border-color: #0d6e63;
    background: #e2f1ee;
    font-weight: 600;
  }

  @media (prefers-color-scheme: dark) {
    th,
    td {
      border-color: #2a3736;
    }
    thead th,
    .status {
      color: #8a9895;
    }
    .field-heading {
      color: #e7edeb;
    }
    .source-note,
    thead th[data-state="error"] .source-label {
      color: #e88b7d;
    }
    thead th[data-state="empty"] .source-note {
      color: #8a9895;
    }
    tr[data-status="differs"] {
      background: #251f14;
    }
    tr[data-status="differs"] .status {
      color: #e0ab5f;
    }
    .absent {
      color: #5b6b68;
    }
    button:hover {
      border-color: #3f5250;
    }
    td[data-selected="true"] button {
      border-color: #56b7a9;
      background: #16302c;
    }
  }
</style>
