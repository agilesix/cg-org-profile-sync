/**
 * `POST /api/sync` against the running systems.
 *
 * The two cases that matter are a change a system stores and a change it
 * declines: the demo's claim is that one protocol-shaped patch reaches several
 * systems, and that a system which keeps only part of it says so rather than
 * failing. Each spec re-compares afterwards, because a sync that reports `ok`
 * without the next read agreeing has proven nothing.
 */

import {
  AGILE_SIX_EIN,
  FUNDERHUB_ORG_ID,
  PORTAL_SEED,
  TEMELIO_ORG_ID,
  TEMELIO_SEED,
} from "@cg-link/seed";
import { ADMIN_EMAIL, EIN_REGISTRY, FUNDERHUB_ORIGIN, TEMELIO_ORIGIN } from "../env.js";
import { expect, resultFor, rowFor, test, tokenFor, valueHeldBy } from "../fixtures.js";

test("pushing portal's address to funderhub settles that disagreement", async ({ api }) => {
  const before = rowFor(await api.compare(), "addresses.primary");
  expect(before.status).toBe("differs");

  // Pinned against the seed, not just "whatever portal said". `valueHeldBy`
  // catches an absent value; this catches a wrong one, so the spec cannot
  // quietly end up proving that portal's mistake reached funderhub intact.
  const chosen = valueHeldBy(before, "portal");
  expect(chosen).toEqual(PORTAL_SEED.addresses?.primary);

  const sync = await api.sync({
    changes: [{ path: "addresses.primary", value: chosen }],
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

test("pushing portal's website to funderhub is refused before anything is sent", async ({
  api,
}) => {
  const before = rowFor(await api.compare(), "socials.website");
  const chosen = valueHeldBy(before, "portal");
  expect(chosen).toBe(PORTAL_SEED.socials?.website);

  const sync = await api.sync({
    changes: [{ path: "socials.website", value: chosen }],
    targets: ["funderhub"],
  });

  // `ok: false` with no status at all, because no request was made. Before
  // #1191-T2 this came back as a 200 whose message carried the bad news — an
  // improvement on silence, but still an answer that arrives after the sender
  // has been told their change was sent.
  const funderhub = resultFor(sync, "funderhub");
  expect(funderhub.ok).toBe(false);
  expect(funderhub.applied).toBe(false);
  expect(funderhub.status).toBeNull();
  expect(funderhub.message).toContain("socials");
  expect(funderhub.message).toContain("FunderHub");

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
    changes: [{ path: "addresses.primary", value: chosen }],
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

  await api.sync({ changes: [{ path: "addresses.primary", value: chosen }], targets: ["temelio"] });

  // The same push again. Nothing has changed, so the adapter has nothing to
  // send — but it must still report success rather than failing or reporting a
  // change it did not make. A presenter re-running the demo, or clicking Sync
  // twice, should not have to care which of those they just did.
  const second = await api.sync({
    changes: [{ path: "addresses.primary", value: chosen }],
    targets: ["temelio"],
  });
  const result = resultFor(second, "temelio");

  expect(result.ok, result.message).toBe(true);

  const after = rowFor(await api.compare(), "addresses.primary");
  expect(valueHeldBy(after, "temelio")).toEqual(chosen);
});

test("pushing the legal name to temelio is refused before anything is sent", async ({ api }) => {
  const name = rowFor(await api.compare(), "name");
  const chosen = valueHeldBy(name, "portal");

  const sync = await api.sync({ changes: [{ path: "name", value: chosen }], targets: ["temelio"] });

  // A funder cannot rename a grantee through the vendor's API, so this is the
  // same beat as FunderHub and `socials`: the widget knows before asking, and
  // the sender is told while they can still do something about it rather than
  // after a request that was never going to carry the change.
  const result = resultFor(sync, "temelio");
  expect(result.ok).toBe(false);
  expect(result.status).toBeNull();
  expect(result.message).toContain("name");
  expect(result.message).toContain("Temelio");
});

test("the adapter still declines a rename itself when patched directly", async ({
  api,
  request,
}) => {
  // The other half of the same claim as FunderHub's above. Link's denylist is
  // a copy; what makes copying safe is that the adapter enforces it too, and
  // turns the vendor's silence about a rename into a sentence of its own.
  const token = await tokenFor(request, "temelio", ADMIN_EMAIL);
  const before = rowFor(await api.compare(), "name");
  const chosen = valueHeldBy(before, "portal");

  const response = await request.patch(`${TEMELIO_ORIGIN}/common-grants/orgs/${TEMELIO_ORG_ID}`, {
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/merge-patch+json",
    },
    data: { name: `${chosen} (renamed)` },
  });

  expect(response.status()).toBe(200);

  const body = (await response.json()) as { message: string };
  expect(body.message).toContain("name");
  expect(body.message).toContain("does not store");

  // And the rename really went nowhere.
  expect(valueHeldBy(rowFor(await api.compare(), "name"), "temelio")).toBe(chosen);
});

test("a sync reaching every target reports each one separately", async ({ api }) => {
  const sync = await api.sync({
    changes: [
      {
        path: "addresses.primary",
        value: valueHeldBy(rowFor(await api.compare(), "addresses.primary"), "portal"),
      },
    ],
    targets: ["portal", "funderhub"],
  });

  expect(sync.results.map((result) => result.id)).toEqual(["portal", "funderhub"]);
  expect(sync.results.every((result) => result.ok)).toBe(true);
});

test("two fields travel to one target in a single patch, and both land", async ({ api }) => {
  const before = await api.compare();
  const address = valueHeldBy(rowFor(before, "addresses.primary"), "portal");
  const website = valueHeldBy(rowFor(before, "socials.website"), "portal");

  // Worth pinning: Temelio starts out disagreeing with portal about both, so
  // the assertions below are about values that actually moved.
  expect(valueHeldBy(rowFor(before, "addresses.primary"), "temelio")).not.toEqual(address);
  expect(valueHeldBy(rowFor(before, "socials.website"), "temelio")).not.toEqual(website);

  const sync = await api.sync({
    changes: [
      { path: "addresses.primary", value: address },
      { path: "socials.website", value: website },
    ],
    targets: ["temelio"],
  });

  // One row, not two. Temelio was asked once and answered once, and that one
  // answer covers both changes — and it is a vendor behind an adapter, so the
  // single patch became whatever call its own API takes.
  expect(sync.results).toHaveLength(1);

  const temelio = resultFor(sync, "temelio");
  expect(temelio.ok, temelio.message).toBe(true);
  expect(temelio.applied, temelio.message).toBe(true);

  const after = await api.compare();
  expect(valueHeldBy(rowFor(after, "addresses.primary"), "temelio")).toEqual(address);
  expect(valueHeldBy(rowFor(after, "socials.website"), "temelio")).toEqual(website);
});

test("the three fields #1190-T6 added travel to both systems in one patch each", async ({
  api,
}) => {
  const before = await api.compare();

  // The three rows read differently on purpose, which is why pushing them
  // together is worth a case: the email is a disagreement FunderHub is the
  // outlier on, the mission is a gap FunderHub never filled in, and the phone
  // is a field all three already agree about.
  expect(rowFor(before, "emails.primary").status).toBe("differs");
  expect(rowFor(before, "mission").values).not.toHaveProperty("funderhub");
  expect(rowFor(before, "phones.primary.number").status).toBe("agree");

  const changes = [
    { path: "mission", value: valueHeldBy(rowFor(before, "mission"), "portal") },
    { path: "emails.primary", value: valueHeldBy(rowFor(before, "emails.primary"), "portal") },
    {
      path: "phones.primary.number",
      value: valueHeldBy(rowFor(before, "phones.primary.number"), "portal"),
    },
  ];

  const sync = await api.sync({ changes, targets: ["funderhub", "temelio"] });

  // Two rows for three fields: one patch per target, not one per field. And
  // neither target is blocked — none of the three is in anybody's
  // `unwritableFields`, which is the property that made them the ones to add.
  expect(sync.results).toHaveLength(2);

  for (const id of ["funderhub", "temelio"]) {
    const result = resultFor(sync, id);
    expect(result.ok, `${id}: ${result.message}`).toBe(true);
    expect(result.status, `${id} was refused before a request was made`).toBe(200);
    expect(result.applied, `${id}: ${result.message}`).toBe(true);
  }

  const after = await api.compare();
  expect(valueHeldBy(rowFor(after, "emails.primary"), "funderhub")).toBe(
    PORTAL_SEED.emails?.primary,
  );
  expect(valueHeldBy(rowFor(after, "mission"), "funderhub")).toBe(PORTAL_SEED.mission);

  // The disagreement and the gap are both settled, and the phone is where it
  // always was — a push of a value everybody already held changes nothing and
  // must still be reported as accepted.
  expect(rowFor(after, "emails.primary").status).toBe("agree");
  expect(rowFor(after, "mission").status).toBe("agree");
  expect(rowFor(after, "phones.primary.number").status).toBe("agree");
});

test("a target blocked on one of two picks is refused for both, not sent half of them", async ({
  api,
}) => {
  const before = await api.compare();
  const address = valueHeldBy(rowFor(before, "addresses.primary"), "portal");
  const website = valueHeldBy(rowFor(before, "socials.website"), "portal");
  const funderhubAddress = valueHeldBy(rowFor(before, "addresses.primary"), "funderhub");

  const sync = await api.sync({
    changes: [
      { path: "addresses.primary", value: address },
      { path: "socials.website", value: website },
    ],
    targets: ["funderhub"],
  });

  // FunderHub would have kept the address. It gets neither, because a partial
  // send is the surprise this guard exists to remove — the sender picked two
  // things and would have been told the request was accepted.
  const funderhub = resultFor(sync, "funderhub");
  expect(funderhub.ok).toBe(false);
  expect(funderhub.status).toBeNull();

  const after = await api.compare();
  expect(valueHeldBy(rowFor(after, "addresses.primary"), "funderhub")).toEqual(funderhubAddress);
});

test("the server still drops socials itself when patched directly, which is the authoritative rule", async ({
  api,
  request,
}) => {
  // Link's denylist is a copy, and a copy can be wrong. What makes the copy
  // safe is that FunderHub enforces the rule itself — so that has to keep
  // being true, proven against the system rather than through the widget that
  // now refuses to ask it.
  const token = await tokenFor(request, "funderhub", ADMIN_EMAIL);
  const website = valueHeldBy(rowFor(await api.compare(), "socials.website"), "portal");

  const response = await request.patch(
    `${FUNDERHUB_ORIGIN}/common-grants/orgs/${FUNDERHUB_ORG_ID}`,
    {
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/merge-patch+json",
      },
      data: { socials: { website } },
    },
  );

  expect(response.status()).toBe(200);

  const body = (await response.json()) as { message: string };
  expect(body.message).toContain("socials");
  expect(body.message).toContain("does not store");

  // And it really went nowhere.
  expect(rowFor(await api.compare(), "socials.website").values).not.toHaveProperty("funderhub");
});

test("a repeated path is a 400", async ({ api }) => {
  const response = await api.rawSync({
    registry: EIN_REGISTRY,
    id: AGILE_SIX_EIN,
    changes: [
      { path: "name", value: PORTAL_SEED.name },
      { path: "name", value: "Something else entirely" },
    ],
    targets: ["funderhub"],
  });

  // Two values for one field describe two different outcomes depending on
  // which is applied last, so the request is refused rather than resolved by
  // an ordering nothing in the UI made visible.
  expect(response.status()).toBe(400);

  const after = rowFor(await api.compare(), "name");
  expect(valueHeldBy(after, "funderhub")).not.toBe("Something else entirely");
});

test("an empty changes list is a 400", async ({ api }) => {
  const response = await api.rawSync({
    registry: EIN_REGISTRY,
    id: AGILE_SIX_EIN,
    changes: [],
    targets: ["funderhub"],
  });

  expect(response.status()).toBe(400);
});

test("a target that is not in the registry fails on its own row", async ({ api }) => {
  const sync = await api.sync({
    changes: [{ path: "name", value: PORTAL_SEED.name }],
    targets: ["portal", "nowhere"],
  });

  expect(resultFor(sync, "portal").ok).toBe(true);

  const missing = resultFor(sync, "nowhere");
  expect(missing.ok).toBe(false);
  expect(missing.status).toBeNull();
});

test("a path outside DEMO_FIELDS is a 400", async ({ api }) => {
  // `yearFounded` rather than `mission`, which was the example here until
  // #1190-T6 put mission in the list. A real path the demo deliberately does
  // not compare is what this case needs: an invented one would only prove that
  // nonsense is refused, which is a weaker claim than the list being the rule.
  const response = await api.rawSync({
    registry: EIN_REGISTRY,
    id: AGILE_SIX_EIN,
    changes: [{ path: "yearFounded", value: "1999" }],
    targets: ["funderhub"],
  });

  expect(response.status()).toBe(400);

  // And nothing moved.
  const yearFounded = (await api.compare()).fields.find((field) => field.path === "yearFounded");
  expect(yearFounded).toBeUndefined();
});

test("a body missing its targets is a 400", async ({ api }) => {
  const response = await api.rawSync({
    registry: EIN_REGISTRY,
    id: AGILE_SIX_EIN,
    changes: [{ path: "name", value: PORTAL_SEED.name }],
  });

  expect(response.status()).toBe(400);
});

test("a body that is not JSON at all is a 400", async ({ api }) => {
  const response = await api.rawSync("this is not JSON");

  expect(response.status()).toBe(400);
});
