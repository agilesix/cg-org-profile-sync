import { FUNDERHUB_ORG_ID, FUNDERHUB_SEED, PORTAL_ORG_ID, PORTAL_SEED } from "@cg-link/seed";
import { describe, expect, it } from "vitest";
import type { Principal } from "./tokens.js";
import { MemoryOrgStore, scopedStore } from "./store.js";

describe("MemoryOrgStore", () => {
  it("returns the original seed after reset() undoes a write", async () => {
    const store = new MemoryOrgStore([FUNDERHUB_SEED]);
    await store.write({ ...FUNDERHUB_SEED, mission: "A different mission" });

    await store.reset();

    expect(await store.list()).toEqual([FUNDERHUB_SEED]);
  });

  it("resets a store that was never written to, unchanged", async () => {
    const store = new MemoryOrgStore([PORTAL_SEED, FUNDERHUB_SEED]);

    await store.reset();

    expect(await store.list()).toEqual([PORTAL_SEED, FUNDERHUB_SEED]);
  });

  it("keeps its own copy of the seed, so mutating the caller's array cannot poison a reset", async () => {
    const seed = [structuredClone(PORTAL_SEED)];
    const store = new MemoryOrgStore(seed);

    // Reaching past the store's own boundaries, the way a caller holding the
    // module-level seed constant could. `reset()` has to restore what was
    // handed over, not whatever that object has since become.
    seed[0]!.mission = "Mutated behind the store's back";
    await store.reset();

    expect(await store.list()).toEqual([PORTAL_SEED]);
  });

  it("restores the seed on a second reset, so a write cannot poison it", async () => {
    const store = new MemoryOrgStore([PORTAL_SEED]);

    await store.write({ ...PORTAL_SEED, mission: "First divergence" });
    await store.reset();
    await store.write({ ...PORTAL_SEED, mission: "Second divergence" });
    await store.reset();

    expect(await store.list()).toEqual([PORTAL_SEED]);
  });
});

describe("scopedStore", () => {
  /** A principal granted `orgs`, or no principal at all when `orgs` is undefined. */
  const scopedTo = (orgs: Principal["orgs"] | undefined): Principal | undefined =>
    orgs === undefined ? undefined : { sub: "test-principal", orgs };

  it("returns only the orgs in the principal's grant", async () => {
    const store = new MemoryOrgStore([PORTAL_SEED, FUNDERHUB_SEED]);
    const scoped = scopedStore(store, scopedTo([PORTAL_ORG_ID]));

    expect(await scoped.list()).toEqual([PORTAL_SEED]);
  });

  it("returns an empty array for a principal granted none", async () => {
    const store = new MemoryOrgStore([PORTAL_SEED, FUNDERHUB_SEED]);
    const scoped = scopedStore(store, scopedTo([]));

    expect(await scoped.list()).toEqual([]);
  });

  it("returns the profile for an org inside the grant", async () => {
    const store = new MemoryOrgStore([PORTAL_SEED, FUNDERHUB_SEED]);
    const scoped = scopedStore(store, scopedTo([PORTAL_ORG_ID]));

    expect(await scoped.read(PORTAL_ORG_ID)).toEqual(PORTAL_SEED);
  });

  it("returns undefined for an org outside the grant, even though the wrapped store holds it", async () => {
    const store = new MemoryOrgStore([PORTAL_SEED, FUNDERHUB_SEED]);
    const scoped = scopedStore(store, scopedTo([PORTAL_ORG_ID]));

    expect(await scoped.read(FUNDERHUB_ORG_ID)).toBeUndefined();
  });

  it("writes through for an org inside the grant, so the underlying store shows the change", async () => {
    const store = new MemoryOrgStore([PORTAL_SEED]);
    const scoped = scopedStore(store, scopedTo([PORTAL_ORG_ID]));
    const updated = { ...PORTAL_SEED, mission: "Updated through the grant" };

    const result = await scoped.write(updated);

    expect(result).toEqual(updated);
    expect(await store.read(PORTAL_ORG_ID)).toEqual(updated);
  });

  it("resolves to undefined for an org outside the grant, leaving the underlying store untouched", async () => {
    const store = new MemoryOrgStore([FUNDERHUB_SEED]);
    const scoped = scopedStore(store, scopedTo([PORTAL_ORG_ID]));

    const result = await scoped.write({ ...FUNDERHUB_SEED, mission: "Should never land" });

    // Reading straight from the underlying store, past the wrapper, is what
    // proves the write never got there — a wrapper that stored the change and
    // merely hid it from its own caller would still pass a weaker assertion.
    expect(result).toBeUndefined();
    expect(await store.read(FUNDERHUB_ORG_ID)).toEqual(FUNDERHUB_SEED);
  });

  it('filters nothing for a principal granted "*": every org is listed, read, and written', async () => {
    const store = new MemoryOrgStore([PORTAL_SEED, FUNDERHUB_SEED]);
    const scoped = scopedStore(store, scopedTo("*"));
    const updated = { ...PORTAL_SEED, mission: "Changed by a wildcard principal" };

    expect(await scoped.list()).toEqual([PORTAL_SEED, FUNDERHUB_SEED]);
    expect(await scoped.read(PORTAL_ORG_ID)).toEqual(PORTAL_SEED);
    expect(await scoped.read(FUNDERHUB_ORG_ID)).toEqual(FUNDERHUB_SEED);
    expect(await scoped.write(updated)).toEqual(updated);
  });

  it("grants nothing to an undefined principal, so a route mounted outside the guard fails closed", async () => {
    const store = new MemoryOrgStore([PORTAL_SEED]);
    const scoped = scopedStore(store, scopedTo(undefined));

    expect(await scoped.list()).toEqual([]);
    expect(await scoped.read(PORTAL_ORG_ID)).toBeUndefined();
    expect(await scoped.write({ ...PORTAL_SEED, mission: "Should never land" })).toBeUndefined();
    expect(await store.read(PORTAL_ORG_ID)).toEqual(PORTAL_SEED);
  });

  it("does not reorder what the underlying store returns, beyond filtering", async () => {
    const store = new MemoryOrgStore([PORTAL_SEED, FUNDERHUB_SEED]);
    const scoped = scopedStore(store, scopedTo("*"));

    expect(await scoped.list()).toEqual(await store.list());
  });
});
