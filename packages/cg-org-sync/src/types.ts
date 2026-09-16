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

  /** The system's own marketing site, shown under its name in the picker. */
  website?: string;

  /**
   * Whether this system can actually be connected. Omitted means available.
   *
   * `coming-soon` is a system the picker lists and refuses to start a flow
   * for. It exists because a picker showing two entries does not look like a
   * network a nonprofit would recognise, and the honest way to show the shape
   * of one is to name systems that are not wired up yet and say so on the row.
   *
   * Enforced rather than decorative: `isConnectable` is what the fan-out
   * filters on, so a `coming-soon` entry is never contacted even if some
   * caller passes the whole registry in.
   */
  status?: SourceStatus;

  /** Where this system's OAuth flow starts, for the widget's Connect control. */
  authorizeUrl?: string;

  /** Endpoint that trades an authorization code for this system's access token. */
  tokenUrl?: string;

  /**
   * What this source allows. Omitted means both.
   *
   * The permissive default is the compatible one: the demo's systems declare
   * nothing and have to keep working. Both are enforced rather than advisory:
   * `syncToTargets` refuses a `write: false` target without sending it
   * anything, `listOrgsAt` refuses to read a `read: false` one, and
   * `utils/direction.ts`'s `syncTargets` keeps an unwritable source out of the
   * targets the widget offers in the first place. Every `SourceResolution`
   * carries the resolved pair, so the browser knows it too.
   */
  capabilities?: SourceCapabilities;

  /**
   * Field paths this source can store. Fields outside the list are dropped from
   * an outgoing patch and reported as skipped, rather than sent and silently lost.
   * Omit to allow every field.
   */
  writableFields?: readonly string[];

  /** Set false to keep a source in the registry but out of the current demo. */
  enabled?: boolean;
}

/** Whether a system is wired up, or only named in the picker. */
export type SourceStatus = "available" | "coming-soon";

/** What a source allows a caller to do with it. */
export interface SourceCapabilities {
  /** Can be read from: it contributes a column to the comparison. */
  read: boolean;

  /** Can be written to: it can be a sync target. */
  write: boolean;
}

/**
 * Whether this source's token got us in.
 *
 * Three states rather than two because the widget offers a different control
 * for each: Connect for a source never connected, Reconnect for one whose
 * token the source no longer accepts, and nothing at all for one that
 * answered. A source that let us in and then failed some other way is still
 * `connected` — being reached and refused is not the same as not being let in.
 */
export type SourceConnection = "connected" | "not-connected" | "expired";

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

  /** Whether this source's token got us in, and so which control to offer. */
  connection: SourceConnection;

  /**
   * What this source allows, with the default already applied.
   *
   * Carried on the row rather than left in the registry because the registry
   * is server-side and the widget is where it matters: a read-only system must
   * never be offered as a sync target, and the direction a change travels —
   * pushed out of the page you are on, or pulled into it — is decided from
   * this. Present even on a row that contributed nothing, so a system that is
   * merely down does not read as one that refuses writes.
   */
  capabilities: SourceCapabilities;
}

/**
 * One organization as the picker lists it.
 *
 * Deliberately not an `Organization`: choosing which organization to link
 * needs a name and the identifier it will be matched by elsewhere, and putting
 * whole profiles on the wire for that would ship a person's full record to a
 * screen that shows two lines of it.
 */
export interface OrgSummary {
  /** The id this source assigned the organization. */
  id: string;

  /** The organization's legal name. */
  name: string;

  /** Its EIN, or `null` when this source publishes none for it. */
  ein: string | null;
}

/** One row of the organization picker, with whether it may be chosen. */
export interface SelectableOrg extends OrgSummary {
  selectable: boolean;

  /** Why not, when it cannot be chosen. Absent when it can. */
  reason?: string;
}

/** What one source answered when asked which organizations a person may touch. */
export interface OrgListResult {
  /** The `SourceConfig.id` this list is about. */
  id: string;

  /** Whether this source's token got us in, and so which control to offer. */
  connection: SourceConnection;

  /** The organizations this person may touch there, in the source's own order. */
  orgs: OrgSummary[];

  /**
   * Why the list is empty. Absent when the source answered.
   *
   * An empty list with no error is a person with no organizations at this
   * system, which is a real answer and not a failure — the two have to stay
   * tellable apart, since one offers Reconnect and the other does not.
   */
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

  /** Whether the target accepted the request. */
  ok: boolean;

  /**
   * Whether the chosen value is actually there now.
   *
   * Distinct from `ok`, and the distinction is the point. A system that cannot
   * store a field does not fail — it applies what it can, drops the rest, and
   * answers 200. So `ok: true, applied: false` is the ordinary way a change
   * goes nowhere, and a caller that showed a tick for `ok` alone would report
   * success for something that never happened.
   *
   * Established by reading the value back out of the post-change snapshot the
   * target returned, not by parsing its message — a receiver is free to word
   * that however it likes, and none of them should have to agree on a phrase
   * for this to work.
   */
  applied: boolean;

  /** The status the target responded with; `null` if it never responded. */
  status: number | null;

  /**
   * The target's own sentence about the change.
   *
   * Passed through verbatim, because a system that declines to store a field
   * says so here rather than failing — that sentence is the only place the
   * sender learns *why* the value went no further.
   */
  message: string;
}

/** What a fan-out write across the chosen targets produces. */
export interface SyncResult {
  /** One result per requested target, in the order the request listed them. */
  results: SyncTargetResult[];
}
