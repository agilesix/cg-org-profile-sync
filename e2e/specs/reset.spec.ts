/**
 * The isolation the rest of the suite is built on.
 *
 * Every other spec assumes `POST /__test/reset` really put the systems back,
 * but none of them prove it: the fixture only checks that the route answered
 * 200, and a reset that returned 200 while doing nothing would show up much
 * later as some unrelated assertion failing in whichever spec happened to run
 * after a mutation. Worse, the compare specs sort ahead of the sync specs, so
 * on a cold run nothing has written anything by the time they read — a dead
 * reset would sail through a whole first run untouched.
 *
 * These two tests are ordered on purpose: the first writes, the second reads.
 * Playwright runs tests within a file in declaration order, so the second only
 * sees the seed again if the fixture between them did its job.
 */

import { FUNDERHUB_SEED, PORTAL_SEED } from "@cg-link/seed";
import { expect, rowFor, test, valueHeldBy } from "../fixtures.js";

test("a spec can move funderhub off its seed", async ({ api }) => {
  const before = rowFor(await api.compare(), "addresses.primary");

  await api.sync({
    path: "addresses.primary",
    value: valueHeldBy(before, "portal"),
    targets: ["funderhub"],
  });

  const after = rowFor(await api.compare(), "addresses.primary");
  expect(after.status).toBe("agree");
  expect(valueHeldBy(after, "funderhub")).toEqual(PORTAL_SEED.addresses?.primary);
});

test("and the next spec still starts from the seed", async ({ api }) => {
  const row = rowFor(await api.compare(), "addresses.primary");

  // The write above is gone. If this reads Suite 300, the reset route answered
  // 200 without re-seeding, and every other spec in the suite is only passing
  // because of the order it happens to run in.
  expect(valueHeldBy(row, "funderhub")).toEqual(FUNDERHUB_SEED.addresses?.primary);
  expect(row.values.funderhub).toMatchObject({ street2: "Suite 210" });
  expect(row.status).toBe("differs");
});
