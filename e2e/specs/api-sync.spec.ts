/**
 * `POST /api/sync` against the two running systems.
 *
 * The two cases that matter are a change a system stores and a change it
 * declines: the demo's claim is that one protocol-shaped patch reaches several
 * systems, and that a system which keeps only part of it says so rather than
 * failing. Each spec re-compares afterwards, because a sync that reports `ok`
 * without the next read agreeing has proven nothing.
 */

import { AGILE_SIX_EIN, PORTAL_SEED } from "@cg-link/seed";
import { EIN_REGISTRY } from "../env.js";
import { expect, resultFor, rowFor, test, valueHeldBy } from "../fixtures.js";

test("pushing portal's address to funderhub makes the row agree", async ({ api }) => {
  const before = rowFor(await api.compare(), "addresses.primary");
  expect(before.status).toBe("differs");

  // Pinned against the seed, not just "whatever portal said". `valueHeldBy`
  // catches an absent value; this catches a wrong one, so the spec cannot
  // quietly end up proving that portal's mistake reached funderhub intact.
  const chosen = valueHeldBy(before, "portal");
  expect(chosen).toEqual(PORTAL_SEED.addresses?.primary);

  const sync = await api.sync({
    path: "addresses.primary",
    value: chosen,
    targets: ["funderhub"],
  });

  const funderhub = resultFor(sync, "funderhub");
  expect(funderhub.ok, funderhub.message).toBe(true);
  expect(funderhub.status).toBe(200);

  const after = rowFor(await api.compare(), "addresses.primary");
  expect(after.status).toBe("agree");
  expect(after.distinctCount).toBe(1);
  expect(valueHeldBy(after, "funderhub")).toEqual(chosen);
  expect(after.values.funderhub).toMatchObject({ street2: "Suite 300" });
});

test("pushing portal's website to funderhub is accepted, and names socials as not stored", async ({
  api,
}) => {
  const before = rowFor(await api.compare(), "socials.website");
  const chosen = valueHeldBy(before, "portal");
  expect(chosen).toBe(PORTAL_SEED.socials?.website);

  const sync = await api.sync({
    path: "socials.website",
    value: chosen,
    targets: ["funderhub"],
  });

  // Accepted, not rejected: a system that declines a field still applied the
  // rest of the patch, so this is a 200 whose message carries the bad news.
  const funderhub = resultFor(sync, "funderhub");
  expect(funderhub.ok).toBe(true);
  expect(funderhub.status).toBe(200);
  expect(funderhub.message).toContain("socials");
  expect(funderhub.message).toContain("does not store");

  // And the value really did go no further.
  const after = rowFor(await api.compare(), "socials.website");
  expect(valueHeldBy(after, "portal")).toBe(chosen);
  expect(after.values).not.toHaveProperty("funderhub");
  expect(after.status).toBe("agree");
});

test("a sync reaching every target reports each one separately", async ({ api }) => {
  const sync = await api.sync({
    path: "addresses.primary",
    value: valueHeldBy(rowFor(await api.compare(), "addresses.primary"), "portal"),
    targets: ["portal", "funderhub"],
  });

  expect(sync.results.map((result) => result.id)).toEqual(["portal", "funderhub"]);
  expect(sync.results.every((result) => result.ok)).toBe(true);
});

test("a target that is not in the registry fails on its own row", async ({ api }) => {
  const sync = await api.sync({
    path: "name",
    value: PORTAL_SEED.name,
    targets: ["portal", "nowhere"],
  });

  expect(resultFor(sync, "portal").ok).toBe(true);

  const missing = resultFor(sync, "nowhere");
  expect(missing.ok).toBe(false);
  expect(missing.status).toBeNull();
});

test("a path outside DEMO_FIELDS is a 400", async ({ api }) => {
  const response = await api.rawSync({
    registry: EIN_REGISTRY,
    id: AGILE_SIX_EIN,
    path: "mission",
    value: "Anything at all.",
    targets: ["funderhub"],
  });

  expect(response.status()).toBe(400);

  // And nothing moved.
  const mission = (await api.compare()).fields.find((field) => field.path === "mission");
  expect(mission).toBeUndefined();
});

test("a body missing its targets is a 400", async ({ api }) => {
  const response = await api.rawSync({
    registry: EIN_REGISTRY,
    id: AGILE_SIX_EIN,
    path: "name",
    value: PORTAL_SEED.name,
  });

  expect(response.status()).toBe(400);
});

test("a body that is not JSON at all is a 400", async ({ api }) => {
  const response = await api.rawSync("this is not JSON");

  expect(response.status()).toBe(400);
});
