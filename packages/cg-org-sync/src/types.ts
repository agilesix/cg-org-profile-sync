/**
 * Shared types for the org sync demo.
 *
 * Kept free of Zod imports so app config files and UI code can depend on them
 * without pulling in the schema layer.
 */

/** Any value that survives a JSON round trip. */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** A JSON object, the shape both org profiles and merge patches take on the wire. */
export type JsonObject = { [key: string]: JsonValue };

/**
 * A system the widget can read from and write to.
 *
 * Every source speaks the same CommonGrants org routes, so adding one is a new
 * entry in the source registry rather than new code.
 */
export interface SourceConfig {
  /** Stable key used to address this source in comparisons and results. */
  id: string;

  /** Name shown to the person using the widget. */
  label: string;

  /** Origin serving `/common-grants/orgs`, with no trailing slash. */
  baseUrl: string;

  /**
   * Endpoint that mints this system's own access token.
   *
   * Ignored for now — the demo holds a static bearer token per source and
   * `POST /token` is a later ticket. Recorded here so the registry already
   * names it when token minting lands.
   */
  tokenUrl?: string;

  /**
   * Field paths this source can store. Fields outside the list are dropped from
   * an outgoing patch and reported as skipped, rather than sent and silently lost.
   * Omit to allow every field.
   */
  writableFields?: readonly string[];

  /** Set false to keep a source in the registry but out of the current demo. */
  enabled?: boolean;
}

/** Whether the sources that hold a field agree on its value. */
export type ComparisonStatus = "agree" | "differs";

/** One row of the comparison grid: a single field seen across every source. */
export interface FieldComparison {
  /** Dot path into the org profile, such as `addresses.primary`. */
  path: string;

  /** Column heading shown for this row. */
  label: string;

  /** The value each source holds, keyed by source id. Missing sources are absent. */
  values: Record<string, JsonValue | undefined>;

  /** How many distinct non-empty values the sources hold between them. */
  distinctCount: number;

  status: ComparisonStatus;
}

/**
 * Supplies the access token for a given source.
 *
 * Each system issues its own token with its own `aud`, so the widget holds one
 * per source rather than a single token that works everywhere.
 */
export interface TokenProvider {
  tokenFor(sourceId: string): Promise<string>;
}

/**
 * One source's standing in a comparison.
 *
 * Every configured source gets a row whether or not it contributed, because a
 * widget that silently dropped an unreachable system would read as that system
 * agreeing with the others.
 */
export interface SourceResolution {
  /** The `SourceConfig.id` this row is about. */
  id: string;

  /** The `SourceConfig.label` to show for it. */
  label: string;

  /** The id this source assigned the org, or `null` if it holds no match. */
  orgId: string | null;

  /** Why this source contributed nothing. Absent when it did. */
  error?: string;
}

/** What a fan-out read across every source produces. */
export interface CompareResult {
  /** Every enabled source, in registry order, whether or not it answered. */
  sources: SourceResolution[];

  /** One row per compared field, holding the value each source has. */
  fields: FieldComparison[];
}

/** What happened when one target was asked to store a change. */
export interface SyncTargetResult {
  /** The `SourceConfig.id` this result is about. */
  id: string;

  /** Whether the target accepted the change. */
  ok: boolean;

  /** The status the target responded with; `null` if it never responded. */
  status: number | null;

  /**
   * The target's own sentence about the change.
   *
   * Passed through verbatim on success, because a system that declines to store
   * a field says so here rather than failing — that sentence is the only place
   * the sender learns the value went no further.
   */
  message: string;
}

/** What a fan-out write across the chosen targets produces. */
export interface SyncResult {
  /** One result per requested target, in the order the request listed them. */
  results: SyncTargetResult[];
}
