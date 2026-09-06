import type { JsonObject, JsonValue } from "../types.js";

/**
 * Apply a JSON Merge Patch (RFC 7396) to a value.
 *
 * Include a field to set it, leave it out to keep it unchanged, or send `null`
 * to remove it. Objects merge recursively; arrays and scalars replace whole,
 * which is why the protocol can't target a single array element.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc7396
 */
export function applyMergePatch(target: JsonValue | undefined, patch: JsonValue): JsonValue {
  if (!isMergeable(patch)) {
    return patch;
  }

  const result: JsonObject = isMergeable(target) ? { ...target } : {};

  for (const key of Object.keys(patch)) {
    const value = patch[key];

    // A key present but undefined can't come from JSON. Treat it the way an
    // absent key is treated: leave whatever the target holds alone.
    if (value === undefined) continue;

    if (value === null) {
      delete result[key];
    } else {
      result[key] = applyMergePatch(result[key], value);
    }
  }

  return result;
}

/** True for plain objects, the only values a merge patch recurses into. */
function isMergeable(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
