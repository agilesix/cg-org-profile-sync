import { describe, expect, it } from "vitest";
import { MemoryOrgStore, listOrgs, scopedStore } from "@cg-link/org-sync/server";
import type { Principal } from "@cg-link/org-sync/server";
import { PORTAL_ORG_ID } from "./agile-six.js";
import { DEMO_USERS, grantsFor } from "./demo-users.js";
import { FUNDERHUB_SEEDS, PORTAL_SEEDS } from "./other-orgs.js";

/**
 * What each demo person actually sees when a system lists its organizations.
 *
 * The pieces are all tested separately — `scopedStore` filters, `listOrgs`
 * paginates, `grantsFor` looks a person up — but the demo's claim is about the
 * three of them together: the admin is offered a choice of organizations on
 * both systems, and the portal-only person is offered exactly one on
 * GrantPortal and is a stranger to FunderHub.
 *
 * Lives here rather than in `@cg-link/org-sync` because it needs the seeds,
 * and that package cannot import them without the dependency becoming
 * circular. Same reason `compare.test.ts` sits here.
 */

const systems = [
  ["portal", PORTAL_SEEDS],
  ["funderhub", FUNDERHUB_SEEDS],
] as const;

/** The org ids `GET /common-grants/orgs` would return to this person, in order. */
async function listedIdsFor(
  systemId: string,
  email: string,
  seeds: readonly (typeof PORTAL_SEEDS)[number][],
): Promise<string[]> {
  const principal: Principal = { sub: email, orgs: grantsFor(systemId, email, DEMO_USERS) };
  const store = scopedStore(new MemoryOrgStore(seeds), principal);

  const response = await listOrgs(new URL("https://system.example/common-grants/orgs"), {
    store,
    source: systemId,
  });

  const body = (await response.json()) as { items: { id: string }[] };

  return body.items.map((item) => item.id);
}

describe("listing organizations as each demo person", () => {
  it.each(systems)("offers the admin every organization %s holds", async (systemId, seeds) => {
    const listed = await listedIdsFor(systemId, "admin@example.org", seeds);

    expect(listed).toEqual(seeds.map((seed) => seed.id));
  });

  it.each(systems)(
    "lists the admin's organizations with Agile Six first on %s",
    async (systemId, seeds) => {
      const listed = await listedIdsFor(systemId, "admin@example.org", seeds);

      expect(listed[0]).toBe(seeds[0]?.id);
    },
  );

  it("offers the portal-only person just their one organization on GrantPortal", async () => {
    const listed = await listedIdsFor("portal", "portal-only@example.org", PORTAL_SEEDS);

    expect(listed).toEqual([PORTAL_ORG_ID]);
  });

  it("offers the portal-only person nothing at all on FunderHub", async () => {
    const listed = await listedIdsFor("funderhub", "portal-only@example.org", FUNDERHUB_SEEDS);

    // Not an error and not a refusal: FunderHub simply has no organization of
    // theirs on file, which is the beat the whole of #1188 turns on.
    expect(listed).toEqual([]);
  });

  it.each(systems)("offers someone nobody has heard of nothing on %s", async (systemId, seeds) => {
    const listed = await listedIdsFor(systemId, "nobody@example.org", seeds);

    expect(listed).toEqual([]);
  });
});
