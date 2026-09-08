import { OrgPatchDataSchema, OrganizationBaseSchema, type Organization } from "../schemas/index.js";
import type { JsonObject, JsonValue } from "../types.js";
import { applyMergePatch } from "../utils/merge-patch.js";
import { badRequest, notFound, ok, paginated, unsupportedMediaType } from "./responses.js";
import type { OrgStore } from "./store.js";

/** RFC 7396 requires this content type on a merge patch body. */
export const MERGE_PATCH_CONTENT_TYPE = "application/merge-patch+json";

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
  const org = await config.store.read(orgId);

  return org ? ok(org) : notFound(`No organization with id ${orgId}.`);
}

/**
 * `PATCH /common-grants/orgs/{orgId}`
 *
 * Applies a JSON Merge Patch and returns the change as an accepted revision,
 * carrying both the patch that was sent and a snapshot of the result.
 */
export async function updateOrg(
  orgId: string,
  request: Request,
  config: OrgRoutesConfig,
): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";

  if (!contentType.startsWith(MERGE_PATCH_CONTENT_TYPE)) {
    return unsupportedMediaType(`A patch body must be sent as ${MERGE_PATCH_CONTENT_TYPE}.`);
  }

  const existing = await config.store.read(orgId);

  if (!existing) {
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

  const { patch, skipped } = dropUnwritable(parsed.data as JsonObject, config.unwritableFields);

  // `id` is assigned by this system, so a patch can never move a record.
  const updated = {
    ...(applyMergePatch(existing as unknown as JsonValue, patch) as object),
    id: existing.id,
  };

  const validated = OrganizationBaseSchema.safeParse(updated);

  if (!validated.success) {
    return badRequest("Applying the patch would leave the profile invalid.", [
      ...validated.error.issues,
    ]);
  }

  const stored = await config.store.write(validated.data as Organization);
  const now = new Date().toISOString();

  return ok(
    {
      id: crypto.randomUUID(),
      status: { value: "accepted", description: "The change was applied." },
      source: config.source,
      patch,
      snapshot: stored,
      createdAt: now,
      lastModifiedAt: now,
    },
    skipped.length === 0
      ? "Change applied"
      : `Change applied. This system does not store ${skipped.join(", ")}.`,
  );
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
