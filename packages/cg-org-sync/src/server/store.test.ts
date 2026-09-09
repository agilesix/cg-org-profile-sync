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

  it("restores the seed on a second reset, so a write cannot poison it", async () => {
    const store = new MemoryOrgStore([PORTAL_SEED]);

    await store.write({ ...PORTAL_SEED, mission: "First divergence" });
    await store.reset();
    await store.write({ ...PORTAL_SEED, mission: "Second divergence" });
    await store.reset();

    expect(await store.list()).toEqual([PORTAL_SEED]);
  });
});
