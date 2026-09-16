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

  interface Props {
    /** One result per requested target, in the order the request listed them. */
    results: SyncTargetResult[];

    /** Source id to display name, so a line names the system, not its key. */
    labels: Record<string, string>;
  }

  let { results, labels }: Props = $props();
</script>

<ul data-testid="sync-results" aria-live="polite">
  {#each results as result (result.id)}
    <li data-testid="sync-result-{result.id}" data-ok={result.ok} data-applied={result.applied}>
      <span class="who">{labels[result.id] ?? result.id}</span>
      <span class="verdict">{result.applied ? "accepted" : "not accepted"}</span>
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
    grid-template-columns: 7rem 8rem 1fr;
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
