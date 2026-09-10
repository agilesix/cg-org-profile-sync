/**
 * The handful of constants and formatters the widget page needs in the browser.
 *
 * Separate from `$lib/server/sources.ts` because that module reads
 * `$env/dynamic/private` and can never be imported into a component. Nothing
 * here touches the schema layer either — the page only ever sees JSON that
 * came back from Link's own routes.
 */

import type { JsonValue } from "@cg-link/org-sync/types";

/** The registry the widget matches one org across systems by. */
export const EIN_REGISTRY = "org:us:ein";

/**
 * The EIN the page opens on.
 *
 * Agile Six's, as seeded into both systems. Hardcoded rather than read from
 * `@cg-link/seed`: the widget is meant to work against systems whose contents
 * it knows nothing about, so a dependency on their fixtures would be a lie
 * about how it finds an org. It is a demo default, and the field is editable.
 */
export const DEFAULT_EIN = "123456789";

/**
 * Render one source's value for a cell.
 *
 * Addresses are the only structured field the demo compares, and a raw JSON
 * blob in a table cell is unreadable, so they collapse to the one line someone
 * would write on an envelope. Detected by shape rather than by field path: a
 * second address field added to `DEMO_FIELDS` should render the same way
 * without this function learning its name.
 */
export function formatValue(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  if (isAddress(value)) {
    const region = [value.city, value.stateOrProvince].filter(isFilled).join(", ");

    return [value.street1, value.street2, region, value.postalCode].filter(isFilled).join(", ");
  }

  // Anything else the protocol grows into a compared field: still legible,
  // just not pretty. Better than an empty cell that reads as "not held".
  return JSON.stringify(value);
}

/** A JSON value carrying the parts of an address worth printing. */
interface AddressLike {
  street1?: unknown;
  street2?: unknown;
  city?: unknown;
  stateOrProvince?: unknown;
  postalCode?: unknown;
}

/** Whether a value is shaped like a `CommonGrants` address. */
function isAddress(value: JsonValue): value is JsonValue & AddressLike {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof value.street1 === "string"
  );
}

/** Keep only the address parts that are actually present. */
function isFilled(part: unknown): part is string {
  return typeof part === "string" && part !== "";
}

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
