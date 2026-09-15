import type { SourceCapabilities, SourceConfig } from "../types.js";

/**
 * What a source allows, with the default applied.
 *
 * One place for what an omitted `capabilities` means, rather than the default
 * living in a Svelte template where nothing can test it. The default is
 * permissive because the demo's own systems declare nothing — but an explicit
 * `false` is never merged over: a default that overrode a declared
 * `write: false` would offer a sync target that cannot accept one.
 *
 * Returns a fresh object, so a caller that mutates the answer cannot reach
 * back into the registry entry it came from.
 */
export function capabilitiesOf(source: SourceConfig): SourceCapabilities {
  const { read = true, write = true } = source.capabilities ?? {};

  return { read, write };
}

/**
 * Whether this source can actually be talked to.
 *
 * Two independent reasons to refuse, neither overriding the other. `enabled:
 * false` keeps an entry in the registry but out of this demo. `status:
 * "coming-soon"` is a system the picker names and cannot connect — it exists
 * so the list looks like a network rather than a pair of test servers, and
 * saying so on the row is more honest than leaving it out.
 *
 * Both default permissive: the demo's own systems declare neither field, and
 * a rule that refused by default would switch them off.
 *
 * This is what the fan-out filters on, so the refusal is enforced rather than
 * drawn. A caller that hands the whole registry to `compareAcrossSources`
 * still never contacts a system that is only named.
 */
export function isConnectable(source: SourceConfig): boolean {
  return source.status !== "coming-soon" && source.enabled !== false;
}
