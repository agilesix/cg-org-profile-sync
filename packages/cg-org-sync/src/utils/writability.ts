/**
 * Which of a person's picks a given system would refuse to store.
 *
 * The receiving side already has this rule — `server/org-routes.ts` drops an
 * unwritable field and names it in the response — and that rule stays
 * authoritative. This is the *sending* side's copy, and it exists for one
 * reason: a widget that only learns a field went nowhere after the patch has
 * already told someone their change was sent. Knowing beforehand is what lets
 * it grey the button out and say which system and which field.
 *
 * The duplication is real and deliberate. The honest fix is each system
 * publishing what it can store, which the protocol does not define in v0.4.0;
 * until then a hand-kept list on this side can only ever *over*-block, because
 * a field it fails to list is still dropped and reported by the receiver.
 */

import type { FieldChange, SourceConfig } from "../types.js";

/**
 * The top-level key a dot path sets.
 *
 * Splits on `.` only, so a registry code keeps its colons:
 * `identifiers.org:us:ein.id` is `identifiers`, not `identifiers.org:us:ein`.
 * Top-level keys are all the comparison needs, because they are all the
 * protocol's own unwritable-field rule works in — a system declines `socials`,
 * never `socials.website`.
 */
export function topLevelKey(path: string): string {
  // `split` always yields at least one segment, so this is never undefined —
  // `noUncheckedIndexedAccess` cannot see that, hence the fallback.
  return path.split(".")[0] ?? path;
}

/**
 * The changes a source would decline, in the order they were given.
 *
 * Returns the `FieldChange`s themselves rather than their paths, so a caller
 * can name the field in a sentence without looking anything back up. A source
 * that declares no `unwritableFields` blocks nothing, which is the compatible
 * default: the demo's own systems say nothing about themselves and have to
 * keep working.
 */
export function blockedChanges(
  changes: readonly FieldChange[],
  source: Pick<SourceConfig, "unwritableFields">,
): FieldChange[] {
  const unwritable = source.unwritableFields ?? [];

  if (unwritable.length === 0) return [];

  return changes.filter((change) => unwritable.includes(topLevelKey(change.path)));
}
