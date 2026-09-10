/**
 * The handful of constants and types the widget page needs in the browser.
 *
 * Separate from `$lib/server/sources.ts` because that module reads
 * `$env/dynamic/private` and can never be imported into a component. The value
 * formatter deliberately does *not* live here — it is branchy pure logic, so
 * it sits in `@cg-link/org-sync/utils` where a Vitest can reach it.
 */

import type { JsonValue } from "$lib/api-types.js";

export { EIN_REGISTRY, formatFieldValue } from "@cg-link/org-sync/utils";

/**
 * The EIN the page opens on.
 *
 * Agile Six's, as seeded into both systems. Hardcoded rather than read from
 * `@cg-link/seed`: the widget is meant to work against systems whose contents
 * it knows nothing about, so a dependency on their fixtures would be a lie
 * about how it finds an org. It is a demo default, and the field is editable.
 */
export const DEFAULT_EIN = "123456789";

/** One source's value for one field, chosen by the person as the correct one. */
export interface Selection {
  /** Dot path of the field, as sent to `POST /api/sync`. */
  path: string;

  /** The field's row heading, for echoing back in the sync panel. */
  label: string;

  /** The `SourceConfig.id` the value was taken from. Never a sync target. */
  sourceId: string;

  /** The value itself, passed through untouched — `null` included. */
  value: JsonValue;
}
