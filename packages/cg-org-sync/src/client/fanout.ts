/**
 * Reading and writing the same org across every configured source at once.
 *
 * The widget's two operations, kept here rather than in Link's route handlers
 * so they are testable: the apps have no test harness, and "one source is down
 * but the rest still answer" is exactly the behaviour worth pinning. The routes
 * stay thin wrappers over these two functions.
 *
 * A source that fails never fails the whole fan-out. Every source gets a row
 * either way, because a system quietly missing from a comparison reads as a
 * system that agrees.
 */

import type { Organization } from "../schemas/index.js";
import type {
  CompareResult,
  JsonObject,
  JsonValue,
  SourceConfig,
  SourceResolution,
  SyncResult,
  SyncTargetResult,
  TokenProvider,
} from "../types.js";
import { DEMO_FIELDS, buildMergePatch, compareProfiles } from "../utils/index.js";
import { OrgClient, OrgClientError } from "./org-client.js";

/** What both fan-outs need: who to talk to, and how to authenticate to each. */
export interface FanoutOptions {
  /** The registry of systems. Sources with `enabled: false` are skipped. */
  sources: readonly SourceConfig[];

  /** Supplies each source's own token. */
  tokens: TokenProvider;

  /** Injectable so tests can stub the transport. Defaults to global `fetch`. */
  fetch?: typeof globalThis.fetch;
}

/** One field's value, pushed to the systems the person chose. */
export interface SyncChange {
  /** Identifier registry the org is matched by across systems, e.g. `org:us:ein`. */
  registry: string;

  /** The org's id within that registry. */
  id: string;

  /** Dot path of the single field being set. */
  path: string;

  /** The value to store. `null` clears the field, which RFC 7396 allows. */
  value: JsonValue;

  /** `SourceConfig.id`s to write to. */
  targets: readonly string[];
}

/** The paths `syncToTargets` will accept, as a plain list for a route's validator. */
export const DEMO_FIELD_PATHS: readonly string[] = DEMO_FIELDS.map((field) => field.path);

/** Whether a path is one of the fields the demo compares, and so one it can sync. */
export function isDemoFieldPath(path: string): boolean {
  return DEMO_FIELD_PATHS.includes(path);
}

/**
 * Read every enabled source's copy of one org and compare them field by field.
 *
 * Each source is resolved from the registry identifier rather than an id,
 * because every system assigns its own. One source failing costs only that
 * source: it comes back with `orgId: null` and the reason, and the comparison
 * is built from whoever did answer.
 */
export async function compareAcrossSources(
  registry: string,
  id: string,
  options: FanoutOptions,
): Promise<CompareResult> {
  const resolved = await Promise.all(
    enabledSources(options.sources).map(async (source) => {
      try {
        return {
          source,
          org: await clientFor(source, options).findByIdentifier(registry, id),
          error: undefined,
        };
      } catch (cause) {
        return { source, org: undefined, error: reasonFor(cause, source) };
      }
    }),
  );

  const profiles: Record<string, Organization | undefined> = {};

  const sources = resolved.map(({ source, org, error }): SourceResolution => {
    if (org !== undefined) {
      profiles[source.id] = org;
    }

    return { id: source.id, label: source.label, orgId: org?.id ?? null, error };
  });

  return { sources, fields: compareProfiles(profiles, DEMO_FIELDS) };
}

/**
 * The sources a fan-out talks to.
 *
 * `enabled: false` keeps a source in the registry but out of the demo, so a
 * third system can be committed as configuration before it is ready to answer.
 */
function enabledSources(sources: readonly SourceConfig[]): readonly SourceConfig[] {
  return sources.filter((source) => source.enabled !== false);
}

/** One client per source, all sharing the injected transport and token provider. */
function clientFor(source: SourceConfig, options: FanoutOptions): OrgClient {
  return new OrgClient({ source, tokens: options.tokens, fetch: options.fetch });
}

/**
 * A short sentence about why a source contributed nothing.
 *
 * `OrgClientError` already words its own message per source and names the
 * system, so it is used as-is. Anything else escaping the client is unexpected,
 * and is reported rather than flattened into a bare "failed" that would hide
 * what actually went wrong.
 */
function reasonFor(cause: unknown, source: SourceConfig): string {
  if (cause instanceof OrgClientError) {
    return cause.message;
  }

  // Anything that is not an `OrgClientError` got out before the client could
  // attach a source to it — a registry entry with a malformed `baseUrl`, say,
  // which throws from `new URL()`. Name the system here so every row in a
  // fan-out says which source it is about, which is the one thing an error in
  // a fan-out has to do.
  const detail = cause instanceof Error ? cause.message : String(cause);

  return `${source.label} could not be reached: ${detail}`;
}

/**
 * Push one field's value to each chosen target, reporting each one separately.
 *
 * The patch is built once and sent unchanged to every target — the demo's whole
 * claim is that a single protocol-shaped change reaches several systems. Each
 * target is reported on its own: one system declining or falling over says
 * nothing about whether the others stored the value.
 */
export async function syncToTargets(
  change: SyncChange,
  options: FanoutOptions,
): Promise<SyncResult> {
  const mergePatch = buildMergePatch(change.path, change.value);
  const byId = new Map(enabledSources(options.sources).map((source) => [source.id, source]));

  const results = await Promise.all(
    uniqueTargets(change.targets).map(async (id): Promise<SyncTargetResult> => {
      const source = byId.get(id);

      // A target naming a source that is not in the registry, or is disabled in
      // it, is a bad request rather than a server fault — reported in its own
      // row so the rest of the fan-out still happens.
      if (source === undefined) {
        return {
          id,
          ok: false,
          status: null,
          message: `No enabled source is configured with the id ${id}.`,
        };
      }

      return patchOne(source, change, mergePatch, options);
    }),
  );

  return { results };
}

/**
 * Resolve one target's own id for the org, then patch it.
 *
 * The lookup is per target because every system assigns its own id, so there is
 * no single id the caller could have sent instead.
 */
async function patchOne(
  source: SourceConfig,
  change: SyncChange,
  mergePatch: JsonObject,
  options: FanoutOptions,
): Promise<SyncTargetResult> {
  const client = clientFor(source, options);

  try {
    const org = await client.findByIdentifier(change.registry, change.id);

    // Nothing to patch is not a failure of this request, but it is also not a
    // stored change — `ok: false` with `status: null`, since nothing was sent.
    if (org === undefined) {
      return {
        id: source.id,
        ok: false,
        status: null,
        message: `${source.label} holds no organization matching ${change.registry} ${change.id}, so there was nothing to change.`,
      };
    }

    const { message, status } = await client.patch(org.id, mergePatch);

    return { id: source.id, ok: true, status, message };
  } catch (cause) {
    return {
      id: source.id,
      ok: false,
      status: cause instanceof OrgClientError ? (cause.status ?? null) : null,
      message: reasonFor(cause, source),
    };
  }
}

/**
 * The targets to write to, each one once.
 *
 * A person can reach the same system twice through two routes in the UI, and
 * patching it twice would record two revisions for one change. `Set` keeps
 * first-seen order, so the results still line up with the request.
 */
function uniqueTargets(targets: readonly string[]): string[] {
  return [...new Set(targets)];
}
