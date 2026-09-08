import type { Organization } from "../schemas/index.js";

/**
 * Where a system keeps its organization profiles.
 *
 * The routes are written against this rather than a database so a system can
 * start in memory and move to D1 without the handlers changing.
 */
export interface OrgStore {
  /** Every organization the caller can see, in a stable order. */
  list(): Promise<Organization[]>;

  /** One organization by its id within this system, or undefined. */
  read(orgId: string): Promise<Organization | undefined>;

  /** Replace a stored profile with the result of applying a patch. */
  write(org: Organization): Promise<Organization>;
}

/**
 * An in-memory store, seeded once per Worker isolate.
 *
 * Fine for the demo and for tests. Writes live as long as the isolate does, so
 * a deployed system that needs them to outlive a request wants a D1-backed
 * store behind the same interface.
 */
export class MemoryOrgStore implements OrgStore {
  #orgs: Map<string, Organization>;

  constructor(seed: readonly Organization[]) {
    this.#orgs = new Map(seed.map((org) => [org.id, structuredClone(org)]));
  }

  async list(): Promise<Organization[]> {
    return [...this.#orgs.values()].map((org) => structuredClone(org));
  }

  async read(orgId: string): Promise<Organization | undefined> {
    const org = this.#orgs.get(orgId);
    return org ? structuredClone(org) : undefined;
  }

  async write(org: Organization): Promise<Organization> {
    this.#orgs.set(org.id, structuredClone(org));
    return structuredClone(org);
  }
}
