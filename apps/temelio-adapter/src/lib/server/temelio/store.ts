/**
 * Temelio behind the `OrgStore` interface the shared route handlers expect.
 *
 * With this in place the adapter serves the same `GET`/`PATCH` org routes as
 * the two CommonGrants-native systems, from handlers that never learn Temelio
 * exists — which is the claim this whole app is here to test.
 *
 * **This is a projection, not a round trip.** `OrgStore.write`'s contract says
 * a stored record must survive a patch with its unknown keys intact, and a
 * store over somebody else's columns cannot honour it: a field CommonGrants
 * models and Temelio does not has nowhere to go, and is simply not written.
 * That is the honest shape of a vendor adapter rather than a bug to fix here,
 * and it is the finding the memo reports — a real system covers a fraction of
 * `OrganizationBase`. What *does* survive is the other direction: a write
 * sends only the keys that changed, so Temelio's own fields, including ones
 * this adapter has never heard of, are never overwritten.
 */

import type { Organization } from "@cg-link/org-sync/schemas";
import { StoreError, type OrgStore } from "@cg-link/org-sync/server";
import { TemelioApiError, type TemelioApi } from "./api.js";
import type { TemelioRecord } from "./records.js";
import { toMetadataPatch, toOrganization } from "./mapping.js";

export interface TemelioOrgStoreOptions {
  api: TemelioApi;

  /**
   * The grantees this store may see, and the only ones it may change.
   *
   * Temelio's API reaches a live system holding other people's data, so the
   * store's universe is named explicitly rather than discovered. It is also
   * why `list` is a read per id and not a search: the answer to "which orgs
   * are there" is configuration, not a query.
   */
  allowlist: readonly string[];

  /** Where to report a grantee that is configured but not there. */
  onProblem?: (problem: string) => void;
}

export class TemelioOrgStore implements OrgStore {
  readonly #api: TemelioApi;
  readonly #allowlist: readonly string[];
  readonly #allowed: ReadonlySet<string>;
  readonly #onProblem: (problem: string) => void;

  constructor(options: TemelioOrgStoreOptions) {
    this.#api = options.api;
    this.#allowlist = [...options.allowlist];
    this.#allowed = new Set(options.allowlist);
    this.#onProblem = options.onProblem ?? ((problem) => console.warn(problem));
  }

  /**
   * Every allowlisted grantee, in the order they were configured.
   *
   * One read each. A grantee the foundation has no relationship with is
   * skipped and named, because that is a misconfiguration somebody can fix —
   * but a Temelio that refuses us or falls over throws, so the route answers
   * an error. An outage must never reach the widget as an empty list: "we
   * hold no record of you" is a claim about the person's data, and making it
   * on Temelio's behalf when Temelio never answered would be a lie the person
   * might act on.
   */
  async list(): Promise<Organization[]> {
    const orgs: Organization[] = [];

    for (const nonprofitId of this.#allowlist) {
      const record = await this.#read(nonprofitId);

      if (!record) {
        this.#onProblem(
          `Temelio has no grantee ${nonprofitId} for this foundation, so it is not being served.`,
        );
        continue;
      }

      orgs.push(toOrganization(record));
    }

    return orgs;
  }

  /**
   * One grantee, or nothing.
   *
   * An id outside the allowlist answers `undefined` without a request, which
   * is the same answer `scopedStore` gives for an org outside a caller's
   * grant — and it means the shared handlers turn both into the same 404,
   * with no way to tell from outside which kind of "no" it was.
   */
  async read(orgId: string): Promise<Organization | undefined> {
    if (!this.#allowed.has(orgId)) {
      return undefined;
    }

    const record = await this.#read(orgId);

    return record ? toOrganization(record) : undefined;
  }

  /**
   * Store what changed, and answer with what Temelio then holds.
   *
   * Read, diff, merge-write, read again. The second read is not caution: a
   * successful write answers 200 with an empty body, so the only way to know
   * what was stored is to ask. Returning the re-read rather than the patched
   * copy also means a field Temelio silently declined shows up as declined.
   *
   * `undefined` is how a store spells "I did not write this", which is what
   * the shared handler turns into a 404.
   */
  async write(org: Organization): Promise<Organization | undefined> {
    if (!this.#allowed.has(org.id)) {
      return undefined;
    }

    const current = await this.#read(org.id);

    if (!current) {
      return undefined;
    }

    const patch = toMetadataPatch(toOrganization(current), org);

    // Nothing changed: a no-op write would still be a write to a live system,
    // and Temelio records a modification for it.
    if (Object.keys(patch).length === 0) {
      return toOrganization(current);
    }

    try {
      await this.#api.write(org.id, patch);
    } catch (cause) {
      rethrowAsStoreError(cause);
    }

    const stored = await this.#read(org.id);

    return stored ? toOrganization(stored) : undefined;
  }

  /**
   * Read one record, reporting a vendor failure in the shared vocabulary.
   *
   * Every read goes through here so no path can let a `TemelioApiError` escape
   * as itself: outside this directory nothing knows what Temelio is, and a
   * route that met one would answer a bare 500 with no envelope at all.
   */
  async #read(nonprofitId: string): Promise<TemelioRecord | undefined> {
    try {
      return await this.#api.read(nonprofitId);
    } catch (cause) {
      rethrowAsStoreError(cause);
    }
  }
}

/**
 * Rethrow a vendor failure in the vocabulary the shared handlers understand.
 *
 * The status and the sentence survive, because both end up in front of
 * somebody: the widget shows the message in Temelio's column, and the status
 * is how a reader tells an expired credential from a vendor that is down.
 * Anything that is not a `TemelioApiError` is rethrown untouched — a bug in
 * this adapter should surface as a bug, not as a report that the vendor
 * misbehaved.
 *
 * Returns `never`, so a caller writes `rethrowAsStoreError(cause)` and the
 * compiler knows the path ends there.
 */
function rethrowAsStoreError(cause: unknown): never {
  if (cause instanceof TemelioApiError) {
    throw new StoreError(cause.message, { status: cause.status, cause });
  }

  throw cause;
}
