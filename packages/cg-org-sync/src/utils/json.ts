import type { JsonObject } from "../types.js";

/**
 * True for plain JSON objects.
 *
 * The same narrowing three call sites need: the values a merge patch recurses
 * into, the ones a dot-path walk can descend through, and the shape a response
 * envelope has to be before anything is read off it. Arrays and `null` are
 * objects to `typeof` and neither is indexable by key, so both are excluded.
 */
export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
