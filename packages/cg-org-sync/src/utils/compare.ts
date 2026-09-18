import type { Organization } from "../schemas/index.js";
import type { FieldChange, FieldComparison, JsonObject, JsonValue } from "../types.js";
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

  // The three below were chosen because every system can store them, which is
  // what makes them evidence rather than decoration: the adapter's claim is
  // that a vendor nobody built for this contract still receives a correction
  // through it, and the address was the only row all three would take.
  //
  // They also read differently from each other on purpose — the email is a
  // disagreement, the phone an agreement, and the mission a gap — because the
  // distinction between those three is the thing the grid exists to teach.
  { path: "mission", label: "Mission" },
  { path: "emails.primary", label: "Email" },

  // The leaf, not `phones.primary`. `formatFieldValue` renders an address by
  // shape and anything else unrecognised as raw JSON, so the whole object
  // would land in a cell as `{"countryCode":"+1",...}`; and the two portals
  // seed `isMobile: false` while the adapter's mapping never produces it, so
  // comparing the object would report a disagreement about a key nobody typed.
  { path: "phones.primary.number", label: "Phone" },
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
 * Whether two held values are the same value.
 *
 * Exported because more than the comparison grid needs it: after a push, the
 * fan-out asks whether the value a target now holds is the one it was sent,
 * and an address that came back with its keys in another order must not read
 * as a different address.
 *
 * `null` and `undefined` are one value here, not two. `null` is how this
 * protocol spells "clear this field" in a merge patch, and `applyMergePatch`
 * honours that by deleting the key rather than storing `null` — so a target
 * that clears a field correctly comes back with the key simply absent. A
 * caller that asked "does the snapshot hold the `null` I sent?" would get
 * `undefined !== null` and report a successful clear as not applied, which is
 * the same false "not accepted" this function exists to prevent, just for the
 * other direction.
 */
export function sameJsonValue(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  const left = a ?? null;
  const right = b ?? null;

  if (left === null || right === null) {
    return left === right;
  }

  return identityOf(left) === identityOf(right);
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
 * Fold a set of chosen values into the one RFC 7396 body that sets them all.
 *
 * `buildMergePatch([{ path: "addresses.primary", value }])` gives
 * `{ addresses: { primary: value } }`, so the wrapper objects merge and the
 * sibling fields a system already holds are left alone. Several changes under
 * one parent share that parent — `socials.website` and `socials.linkedin`
 * produce a single `socials` object — because a target gets one PATCH, and two
 * bodies would be two revisions for what the person did once. Splits on `.`
 * only, so a registry code keeps its colons. `null` stays `null` at the leaf,
 * which is how the protocol spells a deletion.
 *
 * Overlapping paths throw rather than resolving to a last-one-wins order.
 * `socials` and `socials.website` in the same body describe two different
 * outcomes depending on which is applied second, and a request that means two
 * things is one a caller should be told about — `/api/sync` turns this into a
 * 400 rather than guessing.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc7396
 */
export function buildMergePatch(changes: readonly FieldChange[]): JsonObject {
  assertDisjointPaths(changes);

  return changes.reduce<JsonObject>((body, change) => mergeInto(body, shellFor(change)), {});
}

/**
 * One change as its own nested body, before it is merged with its siblings.
 *
 * `split` always yields at least one segment, so the fold always ends on an
 * object.
 */
function shellFor(change: FieldChange): JsonObject {
  return change.path
    .split(".")
    .reduceRight<JsonValue>((inner, segment) => ({ [segment]: inner }), change.value) as JsonObject;
}

/**
 * Merge one change's shell into the body being built.
 *
 * Only ever merges wrapper objects, never values: `assertDisjointPaths` has
 * already ruled out the case where two changes meet at a leaf, so a key
 * present on both sides is a parent both paths pass through. That is what lets
 * this stay a plain recursive merge rather than an implementation of RFC 7396
 * itself — `null` reaches a leaf whose key no other change touches.
 */
function mergeInto(body: JsonObject, shell: JsonObject): JsonObject {
  for (const [key, value] of Object.entries(shell)) {
    const existing = body[key];

    body[key] = isJsonObject(existing) && isJsonObject(value) ? mergeInto(existing, value) : value;
  }

  return body;
}

/**
 * Reject a set of changes that does not describe one unambiguous body.
 *
 * Two kinds of collision: the same path twice, and one path that is an
 * ancestor of another. Both are caught before anything is built, so a caller
 * that turns the throw into a 400 reports the whole request as bad rather than
 * a half-built patch.
 */
function assertDisjointPaths(changes: readonly FieldChange[]): void {
  const seen: string[] = [];

  for (const { path } of changes) {
    for (const earlier of seen) {
      if (earlier === path) {
        throw new Error(
          `A merge patch cannot carry a duplicate path: ${path} is set more than once.`,
        );
      }

      if (isAncestorPath(earlier, path)) throw new Error(overlapMessage(earlier, path));
      if (isAncestorPath(path, earlier)) throw new Error(overlapMessage(path, earlier));
    }

    seen.push(path);
  }
}

/** The sentence both overlap cases report, naming which path contains which. */
function overlapMessage(parent: string, child: string): string {
  return `A merge patch cannot set overlapping fields: ${parent} is a prefix of ${child}, so one change would overwrite the other.`;
}

/**
 * Whether one path contains another.
 *
 * The trailing `.` is what keeps the check on a segment boundary: `soc` and
 * `socials` are unrelated fields, and a bare `startsWith` would call them a
 * collision.
 */
function isAncestorPath(parent: string, child: string): boolean {
  return child.startsWith(`${parent}.`);
}
