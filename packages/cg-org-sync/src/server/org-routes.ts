import { OrgPatchDataSchema, OrganizationBaseSchema, type Organization } from "../schemas/index.js";
import type { JsonObject, JsonValue } from "../types.js";
import { MERGE_PATCH_CONTENT_TYPE, applyMergePatch } from "../utils/merge-patch.js";
import { badRequest, failure, notFound, ok, paginated, unsupportedMediaType } from "./responses.js";
import { StoreError, type OrgStore } from "./store.js";

export { MERGE_PATCH_CONTENT_TYPE };

const DEFAULT_PAGE_SIZE = 100;

/** What a system needs to tell the shared handlers about itself. */
export interface OrgRoutesConfig {
  store: OrgStore;

  /** Name recorded as the source of any change this system applies. */
  source: string;

  /**
   * Fields this system declines to store.
   *
   * A patch that sets one is not an error. The field is dropped and named in
   * the response message, so the sender learns the value went no further rather
   * than assuming it landed.
   *
   * Top-level keys only — `socials`, not `socials.website`. A dotted path here
   * matches nothing and drops nothing, silently. Declining a whole field is all
   * the demo needs; declining one leaf of it wants a path walk that does not
   * exist yet.
   */
  unwritableFields?: readonly string[];
}

/**
 * `GET /common-grants/orgs`
 *
 * Filterable by an external identifier through the `registry` and `id` pair,
 * which is how a client that only knows an EIN finds the system's own UUID.
 */
export async function listOrgs(url: URL, config: OrgRoutesConfig): Promise<Response> {
  return reportingStoreFailure(() => listOrgsFrom(url, config));
}

async function listOrgsFrom(url: URL, config: OrgRoutesConfig): Promise<Response> {
  const page = positiveInt(url.searchParams.get("page"), 1);
  const pageSize = positiveInt(url.searchParams.get("pageSize"), DEFAULT_PAGE_SIZE);

  const registry = url.searchParams.get("registry");
  const id = url.searchParams.get("id");

  if ((registry === null) !== (id === null)) {
    return badRequest("Filtering by identifier needs both `registry` and `id`.");
  }

  let orgs = await config.store.list();

  if (registry !== null && id !== null) {
    orgs = orgs.filter((org) => hasIdentifier(org, registry, id));
  }

  const start = (page - 1) * pageSize;

  return paginated(orgs.slice(start, start + pageSize), page, pageSize, orgs.length);
}

/** `GET /common-grants/orgs/{orgId}` */
export async function readOrg(orgId: string, config: OrgRoutesConfig): Promise<Response> {
  return reportingStoreFailure(async () => {
    const org = await config.store.read(orgId);

    return org ? ok(org) : notFound(`No organization with id ${orgId}.`);
  });
}

/**
 * The revision a system emits for a change it just applied.
 *
 * Spelled out rather than reusing `OrgRevision`, which is the *parsed* form:
 * `UTCDateTimeSchema` is a transform to `Date`, so a revision that has been
 * through the schema no longer matches the one that went over the wire. This
 * is the wire form, timestamps and all.
 */
export interface AppliedRevision {
  id: string;
  status: { value: "accepted"; description: string };
  source: string;

  /** The patch this system actually applied — unwritable fields already gone. */
  patch: JsonObject;

  snapshot: Organization;
  createdAt: string;
  lastModifiedAt: string;
}

/** What `applyOrgPatch` did, or why it declined. */
export type OrgPatchOutcome =
  | {
      ok: true;
      revision: AppliedRevision;

      /** Fields this system declined to store, named for the sender. */
      skipped: readonly string[];

      /** This system's own sentence about the change, dropped fields included. */
      message: string;
    }
  | { ok: false; status: number; message: string; errors: unknown[] };

/**
 * Apply an already-parsed merge patch to one profile.
 *
 * Every rule a change has to pass lives here rather than in `updateOrg`: drop
 * what this system declines to store, apply, re-validate the result, write.
 * Exported because a system's own edit form has to go through exactly the same
 * rules as its `PATCH` route, and the alternative — building a `Request` to
 * call a handler in-process — would make an app's form action depend on the
 * transport to reach behaviour that has nothing to do with it.
 *
 * The patch is expected to have been validated against `OrgPatchDataSchema`
 * already; that parse is the caller's, because only the caller knows where the
 * body came from and what a rejection should look like to whoever sent it.
 */
export async function applyOrgPatch(
  orgId: string,
  patch: JsonObject,
  config: OrgRoutesConfig,
): Promise<OrgPatchOutcome> {
  const existing = await config.store.read(orgId);

  if (!existing) {
    return missing(orgId);
  }

  const { patch: writable, skipped } = dropUnwritable(patch, config.unwritableFields);

  // `id` is assigned by this system, so a patch can never move a record.
  const updated = {
    ...(applyMergePatch(existing as unknown as JsonValue, writable) as object),
    id: existing.id,
  };

  const validated = OrganizationBaseSchema.safeParse(updated);

  if (!validated.success) {
    return {
      ok: false,
      status: 400,
      message: "Applying the patch would leave the profile invalid.",
      errors: [...validated.error.issues],
    };
  }

  // Store `updated`, not `validated.data`. The schemas strip unknown keys, so
  // storing the parse output would let any patch quietly delete whatever an
  // older sender left on the record — the opposite of the tolerance the read
  // path shows it. The parse is a gate here, not a filter; nothing in the org
  // schemas coerces or defaults, so the two differ only by what was stripped.
  const stored = await config.store.write(updated as Organization);

  // A store that declines the write stored nothing, so the record is not one
  // this caller can reach — the same answer the read above already gave for it.
  // Unreachable through `scopedStore`, whose `read` and `write` share a grant;
  // here so a store that scopes them differently cannot report a change it
  // never made.
  if (!stored) {
    return missing(orgId);
  }

  const now = new Date().toISOString();

  return {
    ok: true,
    skipped,
    message: changeMessage(writable, skipped),
    revision: {
      id: crypto.randomUUID(),
      status: { value: "accepted", description: "The change was applied." },
      source: config.source,
      patch: writable,
      snapshot: stored,
      createdAt: now,
      lastModifiedAt: now,
    },
  };
}

/**
 * `PATCH /common-grants/orgs/{orgId}`
 *
 * Parses the body, hands it to `applyOrgPatch`, and wraps the outcome in the
 * response envelope. Every rule about what a change may do lives there.
 *
 * The revision echoes the patch this system actually applied, not the one that
 * arrived: anything named in `unwritableFields` has already been removed. That
 * is deliberate — diffing the echo against what it sent is how a client detects
 * a dropped field programmatically, rather than parsing it out of `message`.
 */
export async function updateOrg(
  orgId: string,
  request: Request,
  config: OrgRoutesConfig,
): Promise<Response> {
  return reportingStoreFailure(() => applyPatch(orgId, request, config));
}

async function applyPatch(
  orgId: string,
  request: Request,
  config: OrgRoutesConfig,
): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";

  if (!contentType.startsWith(MERGE_PATCH_CONTENT_TYPE)) {
    return unsupportedMediaType(`A patch body must be sent as ${MERGE_PATCH_CONTENT_TYPE}.`);
  }

  // Checked before the body is looked at, so an unknown org gets the answer
  // that says the least about itself whatever was sent to it. `applyOrgPatch`
  // reads again and answers 404 too — this is about which refusal a bad body
  // to a record that does not exist earns, not about whether one is needed.
  if (!(await config.store.read(orgId))) {
    return notFound(`No organization with id ${orgId}.`);
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return badRequest("The request body is not valid JSON.");
  }

  const parsed = OrgPatchDataSchema.safeParse(body);

  if (!parsed.success) {
    return badRequest("The patch body does not match the organization schema.", [
      ...parsed.error.issues,
    ]);
  }

  const outcome = await applyOrgPatch(orgId, parsed.data as JsonObject, config);

  return outcome.ok
    ? ok(outcome.revision, outcome.message)
    : failure(outcome.status, outcome.message, outcome.errors);
}

/** The one answer for an org this caller cannot reach, whether or not it exists. */
function missing(orgId: string): OrgPatchOutcome {
  return { ok: false, status: 404, message: `No organization with id ${orgId}.`, errors: [] };
}

/**
 * Turn a store that could not answer into a 502, and nothing else into
 * anything.
 *
 * Only `StoreError` is caught. A blanket catch here would be worse than no
 * catch at all: a genuine bug in this library would come back to the caller
 * dressed as an upstream vendor failure, which is a sentence that sends
 * somebody to check a system that was working fine.
 */
async function reportingStoreFailure(work: () => Promise<Response>): Promise<Response> {
  try {
    return await work();
  } catch (cause) {
    if (cause instanceof StoreError) {
      return failure(502, cause.message, [...cause.errors]);
    }

    throw cause;
  }
}

/** True when the org carries `id` in the named registry, active values only. */
function hasIdentifier(org: Organization, registry: string, id: string): boolean {
  const identifiers = org.identifiers as Record<string, unknown> | undefined;
  const entry = identifiers?.[registry] as
    { id?: string; allIds?: Array<{ id: string; status: string }> } | undefined;

  if (!entry) return false;
  if (entry.id === id) return true;

  return (entry.allIds ?? []).some((value) => value.id === id && value.status === "active");
}

/**
 * What to tell the sender about a change that was partly or wholly declined.
 *
 * "Change applied" is a lie when every field in the patch was dropped: nothing
 * was applied, and a sender reading that sentence believes their value is
 * stored here when this system holds none of it. A client that shows the
 * message next to a green tick — which is the obvious thing to build — then
 * reports success for a change that never happened.
 *
 * So the lead sentence follows what actually happened, and the explanation
 * stays the same either way, because the reason is the same either way.
 */
function changeMessage(applied: JsonObject, skipped: readonly string[]): string {
  if (skipped.length === 0) {
    return "Change applied";
  }

  const fields = skipped.join(", ");

  return Object.keys(applied).length === 0
    ? `Change not applied because this system does not store ${fields}.`
    : `Change applied. This system does not store ${fields}.`;
}

/** Remove fields this system declines to store, and report which were dropped. */
function dropUnwritable(
  patch: JsonObject,
  unwritableFields: readonly string[] = [],
): { patch: JsonObject; skipped: string[] } {
  const skipped = unwritableFields.filter((field) => field in patch);

  if (skipped.length === 0) {
    return { patch, skipped };
  }

  const kept: JsonObject = { ...patch };

  for (const field of skipped) {
    delete kept[field];
  }

  return { patch: kept, skipped };
}

function positiveInt(raw: string | null, fallback: number): number {
  const value = Number(raw);

  return Number.isInteger(value) && value > 0 ? value : fallback;
}
