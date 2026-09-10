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

  /**
   * Replace a stored profile with the result of applying a patch.
   *
   * `org` may carry keys `Organization` does not model — `updateOrg` stores
   * what it applied rather than what Zod parsed, so an older sender's fields
   * survive a patch instead of being stripped by it. An implementation must
   * round-trip the whole object: a store that projects onto known columns
   * would quietly re-introduce the data loss that decision exists to prevent.
   */
  write(org: Organization): Promise<Organization>;
}

/**
 * A store that can be put back the way it started.
 *
 * The ticket offered an optional `reset?()` on `OrgStore` instead, which is the
 * smaller edit. This won because `resetStore` needs a store it can actually
 * reset: with an optional method the helper has to decide at request time what
 * to do when it is missing, and a store that cannot honour a reset should fail
 * to compile rather than answer 500 to a test fixture.
 */
export interface ResettableOrgStore extends OrgStore {
  /** Discard every write and return to the seed profiles. */
  reset(): Promise<void>;
}

/**
 * An in-memory store, seeded once per Worker isolate.
 *
 * Fine for the demo and for tests. Writes live as long as the isolate does, so
 * a deployed system that needs them to outlive a request wants a D1-backed
 * store behind the same interface.
 */
export class MemoryOrgStore implements ResettableOrgStore {
  #seed: readonly Organization[];
  #orgs: Map<string, Organization>;

  constructor(seed: readonly Organization[]) {
    this.#seed = seed;
    this.#orgs = loadSeed(seed);
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

  async reset(): Promise<void> {
    this.#orgs = loadSeed(this.#seed);
  }
}

/**
 * Clone the seed into a fresh map.
 *
 * Cloning on every load rather than once in the constructor is what lets a
 * store be reset repeatedly: the records it hands out never share a reference
 * with the seed, so a write cannot reach back and change what a later reset
 * restores.
 */
function loadSeed(seed: readonly Organization[]): Map<string, Organization> {
  return new Map(seed.map((org) => [org.id, structuredClone(org)]));
}
