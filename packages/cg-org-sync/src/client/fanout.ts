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
  SourceConnection,
  FieldChange,
  JsonObject,
  OrgListResult,
  SourceConfig,
  SourceResolution,
  SyncResult,
  SyncTargetResult,
  TokenProvider,
} from "../types.js";
import {
  DEMO_FIELDS,
  buildMergePatch,
  capabilitiesOf,
  compareProfiles,
  getAtPath,
  isConnectable,
  sameJsonValue,
  summarizeOrg,
} from "../utils/index.js";
import { NotConnectedError, OrgClient, OrgClientError } from "./org-client.js";

/** What both fan-outs need: who to talk to, and how to authenticate to each. */
export interface FanoutOptions {
  /** The registry of systems. Sources with `enabled: false` are skipped. */
  sources: readonly SourceConfig[];

  /** Supplies each source's own token. */
  tokens: TokenProvider;

  /** Injectable so tests can stub the transport. Defaults to global `fetch`. */
  fetch?: typeof globalThis.fetch;
}

/** The chosen values, pushed to the systems the person chose. */
export interface SyncChange {
  /** Identifier registry the org is matched by across systems, e.g. `org:us:ein`. */
  registry: string;

  /** The org's id within that registry. */
  id: string;

  /**
   * The fields to set, folded into one merge patch.
   *
   * A list rather than a single path because a person picks values row by row
   * and then sends them once: one PATCH per target is one revision for what
   * they did once, where a request per field would record several and could
   * leave a target half-updated if one of them failed.
   */
  changes: readonly FieldChange[];

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
          connection: "connected" as SourceConnection,
        };
      } catch (cause) {
        return {
          source,
          org: undefined,
          error: reasonFor(cause, source),
          connection: connectionFrom(cause),
        };
      }
    }),
  );

  const profiles: Record<string, Organization | undefined> = {};

  const sources = resolved.map(({ source, org, error, connection }): SourceResolution => {
    if (org !== undefined) {
      profiles[source.id] = org;
    }

    return {
      id: source.id,
      label: source.label,
      orgId: org?.id ?? null,
      error,
      connection,
      capabilities: capabilitiesOf(source),
      unwritableFields: source.unwritableFields ?? [],
    };
  });

  return { sources, fields: compareProfiles(profiles, DEMO_FIELDS) };
}

/**
 * Ask one source which organizations this person may touch there.
 *
 * Not a fan-out, despite living here: the organization picker asks one system
 * at a time, because the person has just signed into that one and may never
 * connect another. Two systems' lists are two separate questions asked at two
 * separate moments, not rows of one table — and merging them would invent a
 * shared notion of "their organizations" that no system actually holds.
 *
 * Shares this module's failure vocabulary on purpose. `connection` says which
 * control the widget should offer, and the three answers here are the same
 * three `compareAcrossSources` produces, decided by the same `connectionFrom`.
 *
 * Note the two refusals below report `connected`. Neither contacted the
 * source, but `connection` is a question about which control to offer, and for
 * a source that is misconfigured or declares itself unreadable the answer is
 * "none, read the error" — the same as for a source that answered 500.
 * Reporting `not-connected` would offer a Connect button that could only ever
 * lead back here.
 */
export async function listOrgsAt(sourceId: string, options: FanoutOptions): Promise<OrgListResult> {
  const source = enabledSources(options.sources).find((candidate) => candidate.id === sourceId);

  if (source === undefined) {
    return {
      id: sourceId,
      connection: "connected",
      orgs: [],
      error: `No enabled source is configured with the id ${sourceId}.`,
    };
  }

  // Refused before asking, the way `syncToTargets` refuses a `write: false`
  // target. `capabilities` is the source's own statement about itself, so
  // honouring it is this side's job; asking anyway would make it decorative.
  if (!capabilitiesOf(source).read) {
    return {
      id: source.id,
      connection: "connected",
      orgs: [],
      error: `${source.label} cannot be read.`,
    };
  }

  try {
    const orgs = await clientFor(source, options).list();

    // Summarized here rather than at the route, so what crosses the wire to a
    // picker is a name and an EIN rather than everyone's full profile.
    return { id: source.id, connection: "connected", orgs: orgs.map(summarizeOrg) };
  } catch (cause) {
    return {
      id: source.id,
      connection: connectionFrom(cause),
      orgs: [],
      error: reasonFor(cause, source),
    };
  }
}

/**
 * The sources a fan-out talks to.
 *
 * `isConnectable` rather than a local check on `enabled`, so a source the
 * widget only *names* — a `coming-soon` entry in the picker — is never
 * contacted here either. That rule belongs on this side rather than in the
 * caller: a route that forgot to filter would otherwise send a real request to
 * a system nobody has integrated.
 */
function enabledSources(sources: readonly SourceConfig[]): readonly SourceConfig[] {
  return sources.filter(isConnectable);
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
  // Reworded with the source's own label, which the error cannot know: this is
  // the sentence under a Connect button, and "portal is not connected" reads as
  // an internal id leaking into the UI.
  if (cause instanceof NotConnectedError) {
    return `${source.label} is not connected.`;
  }

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
 * Which control the widget should offer for a source that did not answer.
 *
 * Only these two failures are about the connection itself. Everything else —
 * a 500, an unreachable host, a response that did not parse — happened after
 * the source let us in, and offering Reconnect for those would send someone
 * round a sign-in loop that was never the problem.
 */
function connectionFrom(cause: unknown): SourceConnection {
  if (cause instanceof NotConnectedError) {
    return "not-connected";
  }

  if (cause instanceof OrgClientError && cause.status === 401) {
    return "expired";
  }

  return "connected";
}

/**
 * Push the chosen values to each target, reporting each one separately.
 *
 * The patch is built once and sent unchanged to every target — the demo's whole
 * claim is that a single protocol-shaped change reaches several systems. Each
 * target is reported on its own: one system declining or falling over says
 * nothing about whether the others stored the values.
 *
 * Rejects before contacting anything if the changes overlap, since
 * `buildMergePatch` refuses to guess which of two collided paths wins. Link's
 * route turns that into a 400.
 */
export async function syncToTargets(
  change: SyncChange,
  options: FanoutOptions,
): Promise<SyncResult> {
  const mergePatch = buildMergePatch(change.changes);
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
          applied: false,
          status: null,
          notStored: [],
          message: `No enabled source is configured with the id ${id}.`,
        };
      }

      // A source that says it cannot be written to is refused here rather than
      // asked and allowed to say no. `capabilities` is a statement about the
      // system, so honouring it is this side's job — sending the patch anyway
      // would make the declaration decorative.
      if (!capabilitiesOf(source).write) {
        return {
          id,
          ok: false,
          applied: false,
          status: null,
          notStored: [],
          message: `${source.label} does not accept changes.`,
        };
      }

      // A field this target is known not to store no longer stops the patch.
      // The change is sent, the target keeps what it can, and the fields it
      // dropped come back in `notStored` for the caller to name.
      //
      // This used to refuse the whole target, on the reasoning that a partial
      // send is a surprise. The surprise is real but the cure was worse: it
      // made a person unpick a value, or drop a system, to send the rest —
      // work the widget was in a position to do for them. Sending and
      // reporting keeps the choice with the person and the verdict with the
      // receiver, which is also the only place it is actually known.
      //
      // `blockedChanges` stays for the sending side to *warn* with. It is a
      // hand-kept copy and can over-block, which is survivable as a warning
      // and was not as a refusal — a field wrongly named here used to be a
      // field nobody could send.
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
        applied: false,
        status: null,
        notStored: [],
        message: `${source.label} holds no organization matching ${change.registry} ${change.id}, so there was nothing to change.`,
      };
    }

    const { revision, message, status } = await client.patch(org.id, mergePatch);

    // Read the values back out of what the target says it now holds, rather
    // than trusting the 200. A system that cannot store a field answers 200
    // with the field dropped — that is the protocol working as designed, and
    // it is indistinguishable from a stored change until you look.
    //
    // Every change has to be there, not just one: the patch went as a unit, so
    // a target that kept the address and dropped the website has not applied
    // what it was sent, and a tick against the whole row would say it had.
    // Which ones went missing is worth keeping rather than recomputing: it is
    // what lets a caller say "Website was not stored" instead of leaving
    // someone to diff the grid themselves.
    const notStored = change.changes
      .filter((field) => !sameJsonValue(getAtPath(revision.snapshot, field.path), field.value))
      .map((field) => field.path);

    return {
      id: source.id,
      ok: true,
      applied: notStored.length === 0,
      notStored,
      status,
      message,
    };
  } catch (cause) {
    return {
      id: source.id,
      ok: false,
      applied: false,
      notStored: [],
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
