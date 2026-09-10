import type { Organization } from "../schemas/index.js";
import type { FieldComparison, JsonObject, JsonValue } from "../types.js";
import { isJsonObject } from "./json.js";

/** One field the widget compares across sources. */
export interface FieldSpec {
  /** Dot path into an org profile. Segments split on `.` only. */
  readonly path: string;

  /** Row heading shown in the comparison grid. */
  readonly label: string;
}

/**
 * The identifier registry the demo matches one org across systems by.
 *
 * Every system assigns its own `id`, so the EIN is the only handle that means
 * the same thing at all of them. Named once here because the widget, its
 * server load, and the Playwright suite all have to agree on it — three copies
 * of the string is three chances to drift.
 */
export const EIN_REGISTRY = "org:us:ein";

/**
 * The fields the demo compares, in display order.
 *
 * A flat list rather than a walk of the whole schema: adding a field to the
 * demo is one entry here, and nothing else changes.
 */
export const DEMO_FIELDS: readonly FieldSpec[] = [
  { path: "name", label: "Legal name" },
  { path: "identifiers.org:us:ein.id", label: "EIN" },
  { path: "socials.website", label: "Website" },
  { path: "addresses.primary", label: "Primary address" },
];

/**
 * Read a dot path out of a value.
 *
 * Splits on `.` only, so a registry code like `org:us:ein` stays a single
 * segment. A path that runs off the end of an object, or through a scalar or an
 * array, reads as `undefined` rather than throwing.
 */
export function getAtPath(value: unknown, path: string): JsonValue | undefined {
  let current: unknown = value;

  for (const segment of path.split(".")) {
    if (!isJsonObject(current)) return undefined;
    current = current[segment];
  }

  // Everything reachable in an org profile came from JSON, so anything this
  // walk lands on is a JSON value.
  return current as JsonValue | undefined;
}

/**
 * Compare a set of profiles field by field.
 *
 * Returns one row per field in the order given. Only the sources that actually
 * hold a field appear in that row's `values`: a source whose profile failed to
 * load, or that leaves the field empty, is absent rather than counted as a
 * disagreement. A field two sources agree on is `agree`, as is a field a single
 * source holds or that nobody holds.
 */
export function compareProfiles(
  profiles: Readonly<Record<string, Organization | undefined>>,
  fields: readonly FieldSpec[] = DEMO_FIELDS,
): FieldComparison[] {
  return fields.map(({ path, label }) => {
    const values: Record<string, JsonValue | undefined> = {};
    const distinct = new Set<string>();

    for (const [sourceId, profile] of Object.entries(profiles)) {
      if (profile === undefined) continue;

      const value = getAtPath(profile, path);
      if (!isHeld(value)) continue;

      values[sourceId] = value;
      distinct.add(identityOf(value));
    }

    return {
      path,
      label,
      values,
      distinctCount: distinct.size,
      status: distinct.size > 1 ? "differs" : "agree",
    };
  });
}

/**
 * Whether a source actually holds a value for a field.
 *
 * An explicit `null` and an empty string count as not held, the same as an
 * absent key: a system that stores a blank isn't disagreeing with one that
 * stores nothing.
 */
function isHeld(value: JsonValue | undefined): value is JsonValue {
  return value !== undefined && value !== null && value !== "";
}

/**
 * A string two equal values share and two different values do not.
 *
 * Canonical JSON with object keys sorted, so two systems that serialize the
 * same address in a different key order still compare as one value. Deep
 * enough for the fields the demo compares, and small enough to read.
 */
function identityOf(value: JsonValue): string {
  return JSON.stringify(withSortedKeys(value));
}

/** Rewrite a JSON value with every object's keys in sorted order. */
function withSortedKeys(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(withSortedKeys);
  if (!isJsonObject(value)) return value;

  const sorted: JsonObject = {};
  for (const key of Object.keys(value).sort()) {
    const inner = value[key];
    if (inner === undefined) continue;
    sorted[key] = withSortedKeys(inner);
  }
  return sorted;
}

/**
 * Wrap a value into the RFC 7396 body that sets that one field.
 *
 * `buildMergePatch("addresses.primary", value)` gives
 * `{ addresses: { primary: value } }`, so the wrapper objects merge and the
 * sibling fields a system already holds are left alone. Splits on `.` only, so
 * a registry code keeps its colons. `null` stays `null` at the leaf, which is
 * how the protocol spells a deletion.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc7396
 */
export function buildMergePatch(path: string, value: JsonValue): JsonObject {
  // `split` always yields at least one segment, so the fold always ends on an object.
  return path
    .split(".")
    .reduceRight<JsonValue>((inner, segment) => ({ [segment]: inner }), value) as JsonObject;
}
