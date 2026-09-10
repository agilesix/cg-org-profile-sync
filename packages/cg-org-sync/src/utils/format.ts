import type { JsonValue } from "../types.js";
import { isJsonObject } from "./json.js";

/**
 * Render one source's value for a field as a line someone can read.
 *
 * Lives here rather than in the widget because it is branchy pure logic and
 * `apps/*` has no test harness — the same reason the fan-out is in this
 * package. The UI decides how a cell looks; this decides what it says.
 *
 * Addresses are the only structured field the demo compares, and a raw JSON
 * blob in a table cell is unreadable, so they collapse to the one line someone
 * would write on an envelope. Detected by shape rather than by field path: a
 * second address field added to `DEMO_FIELDS` renders the same way without
 * this function learning its name.
 *
 * Returns `""` for a value there is nothing to say about — `undefined`, `null`,
 * or an object whose printable parts are all empty. A caller putting the result
 * somewhere that needs a label should say so itself rather than print a blank.
 */
export function formatFieldValue(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  if (isAddress(value)) {
    const region = [value.city, value.stateOrProvince].filter(isFilled).join(", ");

    return [value.street1, value.street2, region, value.postalCode].filter(isFilled).join(", ");
  }

  // Anything else the protocol grows into a compared field: still legible,
  // just not pretty. Better than an empty cell, which reads as "not held".
  return JSON.stringify(value);
}

/** The parts of an address worth printing, as they arrive over the wire. */
interface AddressLike {
  street1?: unknown;
  street2?: unknown;
  city?: unknown;
  stateOrProvince?: unknown;
  postalCode?: unknown;
}

/**
 * Whether a value is shaped like a CommonGrants address.
 *
 * `street1` is the marker because it is the one part `AddressSchema` requires
 * and no other compared field carries. A value that only looks partly like an
 * address still formats sensibly — the parts it lacks drop out.
 */
function isAddress(value: JsonValue): value is JsonValue & AddressLike {
  return isJsonObject(value) && typeof value.street1 === "string";
}

/** Keep only the address parts that are actually there. */
function isFilled(part: unknown): part is string {
  return typeof part === "string" && part !== "";
}
