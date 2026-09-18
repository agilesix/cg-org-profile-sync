<!--
  What each target said about the change it was just sent.

  The verdict follows whether the values are actually there now, not whether
  the request succeeded. Those come apart in the ordinary case this demo is
  about: a system that cannot store a field applies what it can, drops the
  rest, and answers 200. Reporting that as "accepted" in green would be the
  exact silent success the widget exists to expose — so a change that went
  nowhere reads as NOT STORED, in red, whatever the status code was, and one
  that landed in part reads as PARTLY STORED in amber.

  The target's own sentence is shown verbatim underneath, because it is the
  only place the reason lives.
-->

<script lang="ts">
  import type { SyncTargetResult } from "$lib/api-types.js";
  import type { SyncDirection } from "$lib/demo.js";

  interface Props {
    /** One result per requested target, in the order the request listed them. */
    results: SyncTargetResult[];

    /** Source id to display name, so a line names the system, not its key. */
    labels: Record<string, string>;

    /** Field path to the heading the grid shows for it, e.g. `socials.website` to Website. */
    fieldLabels: Record<string, string>;

    /** Which way the change travelled, so a line can say so in past tense. */
    direction: SyncDirection;
  }

  let { results, labels, fieldLabels, direction }: Props = $props();

  /** The fields a target dropped, named as the grid names them. */
  function droppedFields(result: SyncTargetResult): string {
    return result.notStored.map((path) => fieldLabels[path] ?? path).join(" or ");
  }

  /**
   * What happened to one target, in the direction's own words.
   *
   * "Pushed to" and "Pulled into" rather than one neutral verb: read back
   * afterwards, a line has to still say which copy changed.
   *
   * Decided by whether the value actually landed, never by the status code. A
   * system that cannot store the field answers 200 and stores nothing, and
   * calling that "pushed to" would be the silent success this widget exists to
   * expose — so it reads NOT STORED however the request went.
   */
  function verdict(result: SyncTargetResult): string {
    if (result.applied) return direction === "pull" ? "pulled into" : "pushed to";

    // "Not stored" on a target that kept two fields out of three is as wrong
    // as a tick would be, just in the other direction — and it is reachable
    // now that a field a system cannot keep no longer stops the rest of the
    // patch. Silent about which way it erred is the one thing this component
    // must not be.
    return partial(result) ? "partly stored" : "not stored";
  }

  /** Whether this target kept some of what it was sent, but not all of it. */
  function partial(result: SyncTargetResult): boolean {
    const sent = Object.keys(fieldLabels).length;

    return result.notStored.length > 0 && result.notStored.length < sent;
  }
</script>

<ul data-testid="sync-results" aria-live="polite">
  {#each results as result (result.id)}
    <li
      data-testid="sync-result-{result.id}"
      data-ok={result.ok}
      data-applied={result.applied}
      data-partial={partial(result)}
    >
      <span class="verdict">{verdict(result)}</span>
      <span class="who">{labels[result.id] ?? result.id}</span>
      <span class="message">
        <!--
          Our own sentence first, in the row's words rather than the system's.
          A target says it does not store `socials`; the person picked
          "Website", and being told about a key they never saw is a worse
          answer than being told about the row they clicked. The target's own
          message stays underneath, because it is the only account of anything
          this side did not predict.
        -->
        {#if result.notStored.length > 0}
          <span class="dropped" data-testid="not-stored-{result.id}">
            {labels[result.id] ?? result.id} does not store {droppedFields(result)}.
          </span>
        {/if}
        <span class="said">{result.message}</span>
      </span>
    </li>
  {/each}
</ul>

<style>
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  li {
    display: grid;
    grid-template-columns: 8rem 7rem 1fr;
    gap: 0.3rem 0.75rem;
    align-items: baseline;
    font-size: 0.85rem;
  }
  .who {
    font-weight: 600;
  }
  .verdict {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.72rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #0d6e63;
  }
  li[data-applied="false"] .verdict {
    color: #a1291f;
  }

  /* Amber rather than red: something did land, and a person scanning the
     colour alone should not read a partial success as a failure. */
  li[data-partial="true"] .verdict {
    color: #97590d;
  }
  .dropped {
    display: block;
    font-weight: 600;
  }
  .said {
    display: block;
  }
  .message {
    color: #3b4a48;
  }

  @media (max-width: 34rem) {
    li {
      grid-template-columns: 1fr;
    }
  }

  @media (prefers-color-scheme: dark) {
    .verdict {
      color: #56b7a9;
    }
    li[data-applied="false"] .verdict {
      color: #e88b7d;
    }
    .message {
      color: #bac6c3;
    }
  }
</style>
