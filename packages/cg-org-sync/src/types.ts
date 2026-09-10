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
