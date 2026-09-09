import { PORTAL_ORG_ID, PORTAL_SEED } from "@cg-link/seed";
import { describe, expect, it } from "vitest";
import { MemoryOrgStore } from "./store.js";
import { resetStore } from "./test-routes.js";

describe("resetStore", () => {
  it("puts the store back to its seed and answers 204", async () => {
    const store = new MemoryOrgStore([PORTAL_SEED]);
    await store.write({ ...PORTAL_SEED, mission: "Changed by a spec" });

    const response = await resetStore(store);

    expect(response.status).toBe(204);
    expect((await store.read(PORTAL_ORG_ID))?.mission).toBe(PORTAL_SEED.mission);
  });
});
