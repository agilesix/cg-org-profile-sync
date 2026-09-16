/**
 * `POST /api/sync` against the running systems.
 *
 * The two cases that matter are a change a system stores and a change it
 * declines: the demo's claim is that one protocol-shaped patch reaches several
 * systems, and that a system which keeps only part of it says so rather than
 * failing. Each spec re-compares afterwards, because a sync that reports `ok`
 * without the next read agreeing has proven nothing.
 */

import { AGILE_SIX_EIN, PORTAL_SEED, TEMELIO_SEED } from "@cg-link/seed";
import { EIN_REGISTRY } from "../env.js";
import { expect, resultFor, rowFor, test, valueHeldBy } from "../fixtures.js";

test("pushing portal's address to funderhub settles that disagreement", async ({ api }) => {
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
  expect(valueHeldBy(after, "funderhub")).toEqual(chosen);
  expect(after.values.funderhub).toMatchObject({ street2: "Suite 300" });

  // The row still differs, and that is the honest outcome rather than a
  // regression: Temelio holds the old suite too, and this sync was never sent
  // there — it is read-only until #1190-T4. What changed is which systems are
  // on which side, so the remaining disagreement is Temelio's alone.
  expect(after.values.temelio).toMatchObject({ street2: "Suite 210" });
  expect(after.status).toBe("differs");
  expect(after.distinctCount).toBe(2);
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

  // Temelio still holds its own website, untouched: it was not a target, and
  // could not have been while it is read-only. So the row still differs, for
  // the same reason as before the sync and between the same two systems — the
  // push changed nothing about it, which is exactly what "not stored" means.
  expect(after.values.temelio).toBe(TEMELIO_SEED.socials?.website);
  expect(after.status).toBe("differs");
  expect(after.distinctCount).toBe(2);
});

test("pushing portal's address to both other systems makes all three agree", async ({ api }) => {
  const before = rowFor(await api.compare(), "addresses.primary");
  expect(before.status).toBe("differs");

  const chosen = valueHeldBy(before, "portal");

  // One patch, two systems, and one of them is a vendor behind an adapter that
  // translates it into a call shaped nothing like a merge patch. Neither Link
  // nor this spec can tell which is which, which is the whole claim.
  const sync = await api.sync({
    path: "addresses.primary",
    value: chosen,
    targets: ["funderhub", "temelio"],
  });

  for (const id of ["funderhub", "temelio"]) {
    const result = resultFor(sync, id);
    expect(result.ok, `${id}: ${result.message}`).toBe(true);
  }

  const after = rowFor(await api.compare(), "addresses.primary");
  expect(after.status).toBe("agree");
  expect(after.distinctCount).toBe(1);
  expect(valueHeldBy(after, "temelio")).toEqual(chosen);
});

test("pushing a value a system already holds is accepted, so a demo can be run twice", async ({
  api,
}) => {
  const before = rowFor(await api.compare(), "addresses.primary");
  const chosen = valueHeldBy(before, "portal");

  await api.sync({ path: "addresses.primary", value: chosen, targets: ["temelio"] });

  // The same push again. Nothing has changed, so the adapter has nothing to
  // send — but it must still report success rather than failing or reporting a
  // change it did not make. A presenter re-running the demo, or clicking Sync
  // twice, should not have to care which of those they just did.
  const second = await api.sync({ path: "addresses.primary", value: chosen, targets: ["temelio"] });
  const result = resultFor(second, "temelio");

  expect(result.ok, result.message).toBe(true);

  const after = rowFor(await api.compare(), "addresses.primary");
  expect(valueHeldBy(after, "temelio")).toEqual(chosen);
});

test("pushing the legal name to temelio is accepted, and names what a funder cannot change", async ({
  api,
}) => {
  const name = rowFor(await api.compare(), "name");
  const chosen = valueHeldBy(name, "portal");

  const sync = await api.sync({ path: "name", value: chosen, targets: ["temelio"] });

  // Accepted, because the rest of a patch still applies — but the message has
  // to carry the bad news, or a sender would believe a rename landed. Temelio
  // lets a funder send a legal name, answers 200, and stores nothing; the
  // adapter turns that silence into a sentence.
  const result = resultFor(sync, "temelio");
  expect(result.ok).toBe(true);
  expect(result.message).toContain("name");
  expect(result.message).toContain("does not store");
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
