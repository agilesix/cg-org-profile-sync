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
 * Whether the picked values are being pushed out of the host or pulled into it.
 *
 * Takes every pick's source, because a person can choose several fields at
 * once and they need not come from one system. A pull is "bring this system's
 * value into the page I am on", which only means something when every pick
 * came from the same system and that system is not the host. Picks from two
 * systems describe changes travelling in different directions, and the honest
 * single answer for that is a push: the set is going outward to whatever the
 * person selects, with no pull's narrowing applied to it.
 *
 * No host means standalone, which is always a push: there is no page for a
 * value to be pulled into, and every reachable system is a candidate. Nothing
 * picked is a push for the same reason — there is nothing to pull.
 */
export function directionOf(
  pickedSourceIds: readonly string[],
  hostId: string | null,
): SyncDirection {
  if (hostId === null) return "push";

  const origins = new Set(pickedSourceIds);

  if (origins.size !== 1) return "push";

  return origins.has(hostId) ? "push" : "pull";
}

/**
 * The sources the picked values could actually be sent to.
 *
 * Four rules, in the order they matter: never a source every pick came from,
 * since it already holds all of them; never a source with nothing to patch or
 * an error of its own; never a source that says it cannot be written to; and
 * on a pull, only the host.
 *
 * The first rule is about the set rather than one value. With picks from two
 * systems each is still a target for the other's value, and both changes
 * travel in the one patch — so a source drops out only when there is nothing
 * left to tell it.
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
  pickedSourceIds: readonly string[],
  hostId: string | null,
): SourceResolution[] {
  const host = hostId === null ? undefined : sources.find((source) => source.id === hostId);
  const picked = pickedSourceIds.length > 0;
  const reachable = sources.filter(
    (source) =>
      // `every` on an empty list is true, which would rule out every source
      // before anyone has picked anything. Nothing picked means nothing is
      // ruled out yet.
      !(picked && pickedSourceIds.every((sourceId) => sourceId === source.id)) &&
      source.orgId !== null &&
      source.error === undefined &&
      source.capabilities.write,
  );

  // Resolved against the host we actually found, so an unknown id reads as
  // standalone here and in `directionOf` alike rather than in only one of them.
  if (directionOf(pickedSourceIds, host?.id ?? null) === "push") {
    return reachable;
  }

  return reachable.filter((source) => source.id === host?.id);
}
