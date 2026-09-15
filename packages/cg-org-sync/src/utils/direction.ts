/**
 * Which way a change travels, and where it is allowed to go.
 *
 * Embedded in a portal's own page, the widget knows which system it is hosted
 * in. Sending that system's value outward is a *push*; bringing another
 * system's value into it is a *pull*. The distinction is the one thing someone
 * reading the screen has to get right — "sync" is a word that hides which copy
 * is about to be overwritten — so the direction is named, and a pull is
 * confined to the page it is a pull into.
 *
 * Over the protocol both are the same request: a `PATCH` to one system. So
 * this is labelling plus target filtering, not transport. It lives in the
 * library rather than in the widget because it decides *where a change is
 * sent*, and `apps/*` has no test harness — the same reason `compare.ts` and
 * `format.ts` are here.
 */

import type { SourceResolution } from "../types.js";

/** Which way a change travels, relative to the page the widget is embedded in. */
export type SyncDirection = "push" | "pull";

/**
 * Whether a picked value is being pushed out of the host or pulled into it.
 *
 * No host means standalone, which is always a push: there is no page for a
 * value to be pulled into, and every reachable system is a candidate.
 */
export function directionOf(pickedSourceId: string, hostId: string | null): SyncDirection {
  return hostId === null || pickedSourceId === hostId ? "push" : "pull";
}

/**
 * The sources a picked value could actually be sent to.
 *
 * Four rules, in the order they matter: never the source the value came from,
 * since it already holds it; never a source with nothing to patch or an error
 * of its own; never a source that says it cannot be written to; and on a pull,
 * only the host.
 *
 * That last rule is deliberately unforgiving. A pull is "bring this into the
 * page I am on", so if the host is not a usable target the answer is nowhere —
 * not some other system that happened to pass the first three rules. Sending a
 * value somewhere nobody asked for is the one outcome worth ruling out in code
 * rather than in wording.
 *
 * An `hostId` matching no source is treated as no host at all, for the same
 * reason: an unrecognised `?host=` must not be able to redirect or narrow
 * where a change goes.
 */
export function syncTargets(
  sources: readonly SourceResolution[],
  pickedSourceId: string,
  hostId: string | null,
): SourceResolution[] {
  const host = hostId === null ? undefined : sources.find((source) => source.id === hostId);
  const reachable = sources.filter(
    (source) =>
      source.id !== pickedSourceId &&
      source.orgId !== null &&
      source.error === undefined &&
      source.capabilities.write,
  );

  // Resolved against the host we actually found, so an unknown id reads as
  // standalone here and in `directionOf` alike rather than in only one of them.
  if (directionOf(pickedSourceId, host?.id ?? null) === "push") {
    return reachable;
  }

  return reachable.filter((source) => source.id === host?.id);
}
