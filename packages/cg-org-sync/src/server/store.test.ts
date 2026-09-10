import { FUNDERHUB_SEED, PORTAL_SEED } from "@cg-link/seed";
import { describe, expect, it } from "vitest";
import { MemoryOrgStore } from "./store.js";

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
