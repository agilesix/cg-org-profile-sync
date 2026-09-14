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
