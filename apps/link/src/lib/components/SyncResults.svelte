<!--
  What each target said about the change it was just sent.

  The verdict follows whether the value is actually there now, not whether the
  request succeeded. Those come apart in the ordinary case this demo is about:
  a system that cannot store a field applies what it can, drops the rest, and
  answers 200. Reporting that as "accepted" in green would be the exact silent
  success the widget exists to expose — so a change that went nowhere reads as
  NOT ACCEPTED, in red, whatever the status code was.

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

    /** Which way the change travelled, so a line can say so in past tense. */
    direction: SyncDirection;
  }

  let { results, labels, direction }: Props = $props();

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
  function verdict(applied: boolean): string {
    if (!applied) return "not stored";

    return direction === "pull" ? "pulled into" : "pushed to";
  }
</script>

<ul data-testid="sync-results" aria-live="polite">
  {#each results as result (result.id)}
    <li data-testid="sync-result-{result.id}" data-ok={result.ok} data-applied={result.applied}>
      <span class="verdict">{verdict(result.applied)}</span>
      <span class="who">{labels[result.id] ?? result.id}</span>
      <span class="message">{result.message}</span>
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
