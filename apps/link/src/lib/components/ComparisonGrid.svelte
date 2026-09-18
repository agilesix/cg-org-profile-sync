<!--
  One row per compared field, one column per system this person has connected.

  The grid is the whole demo in one screen: where the systems agree, where they
  drift, and who has never heard of a field. Every value a source actually
  holds is a button, because picking one is how a correction starts — including
  on a row that already agrees, which is how the "FunderHub does not store
  socials" case gets demonstrated. One pick
  per row, several rows at a time: picking again in a row replaces that row's
  choice rather than adding to it.

  Columns grow with the connections rather than with the registry: a system
  nobody has linked has no column. Three systems linked is three columns, and a
  fourth is a fourth — nothing here is sized to the demo's current cast.

  A single column has nothing to compare against, so it gets one empty column
  inviting a second system. That invitation is for the empty case only: once
  two systems are up there is a comparison on screen, and the way to a third is
  the button above the grid rather than a column that never fills.

  `data-testid` hooks are deliberate. The Playwright specs select by them rather
  than by copy or column position, so restyling this file cannot break them.
-->

<script lang="ts">
  import type { CompareResult, JsonValue, SourceResolution } from "$lib/api-types.js";
  import { formatFieldValue, type Selection } from "$lib/demo.js";

  interface Props {
    /** The latest fan-out read, in registry order. */
    comparison: CompareResult;

    /** The value chosen in each row, keyed by field path, so its cell can be marked. */
    selections: Record<string, Selection>;

    /**
     * Whether any system is still unlinked, so the invitation has somewhere to
     * lead. Whether it is *shown* is decided below — this only says it could be.
     */
    canAdd: boolean;

    /** Called when a cell's value is picked as the correct one. */
    onpick: (path: string, label: string, sourceId: string, value: JsonValue) => void;

    /** Called when the invitation column is clicked, to open the picker. */
    onadd: () => void;

    /**
     * Take the height a flex parent gives us instead of capping our own.
     *
     * Embedded, the widget is a column inside an overlay iframe and the grid is
     * the part that should absorb whatever is left over — so the fixed
     * `max-height` that keeps a standalone grid from running off the page is
     * the wrong rule there, and would make the frame scroll *and then* the grid.
     * A prop rather than the page reaching in through `:global`, so the two
     * ways this grid can be sized are both stated here.
     */
    fill?: boolean;
  }

  let { comparison, selections, canAdd, onpick, onadd, fill = false }: Props = $props();

  /**
   * The systems that get a column: the ones this person actually connected.
   *
   * The fan-out returns a row for every registered system whether or not it
   * was asked, because a caller has to be able to tell "we never asked" from
   * "asked and got nothing". That is the wrong shape for this screen: a column
   * per registered system pre-announces systems nobody has linked and makes
   * the grid as wide as the registry happens to be. The invitation column
   * stands in for all of them instead.
   */
  const columns = $derived(
    comparison.sources.filter((source) => source.connection !== "not-connected"),
  );

  /**
   * Whether to offer the invitation column.
   *
   * Only while one system is connected: a lone column is a profile, not a
   * comparison, and the column is what says so. From two columns on it would
   * be a permanent empty gap between the values and the status.
   */
  const inviting = $derived(canAdd && columns.length < 2);

  /** Whether this cell holds the value the person has chosen to push for its row. */
  function isPicked(path: string, sourceId: string): boolean {
    return selections[path]?.sourceId === sourceId;
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

<div class="grid-frame" class:fill>
  <div class="scroller" data-testid="grid-scroller">
    <table data-testid="grid">
      <thead>
        <tr>
          <th class="field-heading" scope="col">Field</th>
          {#each columns as source (source.id)}
            <th
              scope="col"
              data-testid="source-{source.id}"
              data-state={source.error !== undefined
                ? "error"
                : source.orgId === null
                  ? "empty"
                  : "ok"}
            >
              <span class="source-label">{source.label}</span>
              {#if note(source)}
                <span class="source-note" data-testid="source-note-{source.id}">{note(source)}</span
                >
              {/if}
            </th>
          {/each}
          {#if inviting}
            <th class="invite" scope="col" data-testid="add-source">
              <button type="button" data-testid="add-source-button" onclick={onadd}>
                Connect another grant management system to compare
              </button>
            </th>
          {/if}
          <th class="status-heading" scope="col">Status</th>
        </tr>
      </thead>
      <tbody>
        {#each comparison.fields as field (field.path)}
          <tr data-testid="row-{field.path}" data-status={field.status} class={field.status}>
            <th class="field-heading" scope="row">{field.label}</th>
            {#each columns as source (source.id)}
              {@const value = field.values[source.id]}
              <td
                data-testid="cell-{field.path}-{source.id}"
                data-held={value !== undefined}
                data-selected={isPicked(field.path, source.id)}
              >
                {#if value === undefined}
                  <span class="absent" aria-hidden="true">—</span>
                  <span class="visually-hidden">Not held</span>
                {:else}
                  <button
                    type="button"
                    data-testid="pick-{field.path}-{source.id}"
                    aria-pressed={isPicked(field.path, source.id)}
                    onclick={() => onpick(field.path, field.label, source.id, value)}
                  >
                    <!-- A held value can still render as nothing: an address whose
                     every printable part is blank. Naming it keeps the button
                     from being an unlabelled target. -->
                    {formatFieldValue(value) || "(empty)"}
                  </button>
                {/if}
              </td>
            {/each}
            {#if inviting}
              <td class="invite"></td>
            {/if}
            <td class="status" data-testid="status-{field.path}">{field.status}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>

<style>
  /*
     The grid scrolls inside a fixed height rather than growing without limit.
     Seven compared fields already push the last rows past the fold on a laptop,
     and the widget is often in an overlay iframe shorter than the page behind
     it — so the alternative to scrolling here is scrolling the whole widget and
     losing the column headings on the way down.
  */
  .grid-frame {
    border-bottom: 1px solid #d9e0dd;
  }
  .scroller {
    max-height: 36rem;
    overflow-y: auto;
  }

  /* `min-height: 0` on both: a flex item's default floor is its content, which
     for a table is every row — without this the grid refuses to shrink and
     pushes the panel below it off the bottom of the frame. */
  .grid-frame.fill {
    flex: 1 1 auto;

    /* A floor rather than `0`: the grid should yield space to the panel, but a
       comparison squeezed to two rows is not one anybody can read.

       It is a minimum, not the height: with a short panel the grid already gets
       whatever the column has left over, which is more than this. What it
       governs is the case where the panel has grown — several picks and a set
       of results — and the grid is being squeezed to make room.

       Sized against the frame rather than picked: at three systems linked the
       column has a shade under 14rem to give, so a floor above this makes the
       widget scroll as well as the grid in the state the demo actually runs
       in. Measured, not guessed — `embedded.spec.ts` connects all three and
       fails if it stops being true. */
    min-height: 13rem;
    display: flex;
    flex-direction: column;
  }
  .grid-frame.fill .scroller {
    flex: 1 1 auto;
    min-height: 0;
    max-height: none;
  }

  table {
    width: 100%;

    /* `separate` rather than `collapse` because a collapsed table's borders
       belong to the table, not the cells, and scroll away from under a sticky
       header with them. Every border below is on a cell for that reason. */
    border-collapse: separate;
    border-spacing: 0;
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
    /* Stays put while the rows move, so a value halfway down the grid still
       has a column name above it. */
    position: sticky;
    top: 0;
    z-index: 1;
    background: #f4f7f6;
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
  .invite {
    border-left: 1px dashed #c6d2cf;
    width: 11rem;
    /* Inherits from the table rather than from `thead th`, which is where the
       uppercase monospace comes from. This one is a sentence, not a label. */
    font-family: inherit;
  }
  .invite button {
    margin: 0;
    padding: 0;
    font-size: 0.78rem;
    letter-spacing: 0;
    text-transform: none;
    color: #6b7a77;
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }
  .invite button:hover {
    border-color: transparent;
    color: #0d6e63;
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
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
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
    .grid-frame {
      border-bottom-color: #2a3736;
    }
    thead th {
      /* The sticky header needs an opaque background in both schemes, or the
         rows scroll through it. */
      background: #0f1615;
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
    .invite {
      border-left-color: #3f5250;
    }
    .invite button {
      color: #8a9895;
    }
    .invite button:hover {
      color: #56b7a9;
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
