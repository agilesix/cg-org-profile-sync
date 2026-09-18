/**
 * `GET /api/compare` against the three running systems.
 *
 * The assertions are about the seed's deliberate disagreements, which are the
 * whole point of the demo: three copies of Agile Six's profile agree on who
 * the org is and disagree on where it is, what its website says and which
 * mailbox reaches it. The third is a vendor behind an adapter rather than a
 * CommonGrants-native system, and nothing here can tell — which is the claim.
 */

import { DEMO_FIELDS } from "@cg-link/org-sync/utils";
import { AGILE_SIX_EIN, FUNDERHUB_SEED, PORTAL_SEED, TEMELIO_SEED } from "@cg-link/seed";
import { expect, rowFor, test } from "../fixtures.js";

test("every configured source answers with its own id for the org", async ({ api }) => {
  const result = await api.compare();

  expect(result.sources.map((source) => source.id)).toEqual(["portal", "funderhub", "temelio"]);

  for (const source of result.sources) {
    expect(source.error, `${source.id} did not answer`).toBeUndefined();
    expect(source.orgId, `${source.id} holds no record of the org`).not.toBeNull();
  }

  // Ids are assigned per system, so the same org has three of them. If any two
  // matched, the widget would be reading one system twice.
  const ids = result.sources.map((source) => source.orgId);
  expect(new Set(ids).size).toBe(ids.length);
});

test("the primary address differs — portal holds Suite 300, funderhub Suite 210", async ({
  api,
}) => {
  const row = rowFor(await api.compare(), "addresses.primary");

  expect(row.status).toBe("differs");

  // Two values between three systems: Temelio sides with FunderHub, so the
  // system holding the current address is outnumbered. A tie would make
  // choosing look automatic.
  expect(row.distinctCount).toBe(2);
  expect(row.values.portal).toMatchObject({ street2: "Suite 300" });
  expect(row.values.funderhub).toMatchObject({ street2: "Suite 210" });
  expect(row.values.temelio).toMatchObject({ street2: "Suite 210" });
});

test("the legal name and the EIN agree across all three systems", async ({ api }) => {
  const result = await api.compare();

  const name = rowFor(result, "name");
  expect(name.status).toBe("agree");
  expect(name.values.portal).toBe(PORTAL_SEED.name);
  expect(name.values.funderhub).toBe(name.values.portal);
  expect(name.values.temelio).toBe(name.values.portal);

  const ein = rowFor(result, "identifiers.org:us:ein.id");
  expect(ein.status).toBe("agree");
  expect(ein.values.portal).toBe(AGILE_SIX_EIN);
  expect(ein.values.funderhub).toBe(AGILE_SIX_EIN);

  // The adapter normalizes Temelio's stored EIN to the nine bare digits the
  // protocol asks for, so the org matches across systems that spell it
  // differently.
  expect(ein.values.temelio).toBe(AGILE_SIX_EIN);
});

test("the website disagrees between the systems that publish one, and funderhub holding none is not a third opinion", async ({
  api,
}) => {
  const row = rowFor(await api.compare(), "socials.website");

  expect(row.values.portal).toBe(PORTAL_SEED.socials?.website);
  expect(row.values.temelio).toBe(TEMELIO_SEED.socials?.website);
  expect(row.status).toBe("differs");

  // FunderHub does not model socials at all. A field two systems hold and a
  // third has never heard of is a disagreement between the two — the absent
  // one must not be counted as a value, or every partial system would look
  // like it was contradicting everybody.
  expect(row.values).not.toHaveProperty("funderhub");
  expect(row.distinctCount).toBe(2);
});

test("the email disagrees, and funderhub is the one system out of step", async ({ api }) => {
  const row = rowFor(await api.compare(), "emails.primary");

  expect(row.status).toBe("differs");

  // The second disagreement in the seed, and the only one nobody invented for
  // the demo: FunderHub was given a mailbox that no longer routes anywhere,
  // and the two systems that hold the working address outnumber it.
  expect(row.distinctCount).toBe(2);
  expect(row.values.portal).toBe(PORTAL_SEED.emails?.primary);
  expect(row.values.temelio).toBe(PORTAL_SEED.emails?.primary);
  expect(row.values.funderhub).toBe(FUNDERHUB_SEED.emails?.primary);
});

test("the mission is a gap at funderhub rather than a disagreement", async ({ api }) => {
  const row = rowFor(await api.compare(), "mission");

  // The same beat as the website, without the write refusal on top of it:
  // FunderHub *can* store a mission and simply never had one filled in. Two
  // systems holding one value and a third holding none is agreement.
  expect(row.status).toBe("agree");
  expect(row.distinctCount).toBe(1);
  expect(row.values.portal).toBe(PORTAL_SEED.mission);
  expect(row.values.temelio).toBe(TEMELIO_SEED.mission);
  expect(row.values).not.toHaveProperty("funderhub");
});

test("the phone number agrees across all three systems", async ({ api }) => {
  const row = rowFor(await api.compare(), "phones.primary.number");

  // The leaf, not the object: the two portals seed `isMobile: false` and the
  // adapter's mapping never produces it, so comparing `phones.primary` would
  // report a disagreement about a key nobody typed.
  expect(row.status).toBe("agree");
  expect(row.distinctCount).toBe(1);
  expect(row.values.portal).toBe(PORTAL_SEED.phones?.primary.number);
  expect(row.values.funderhub).toBe(PORTAL_SEED.phones?.primary.number);
  expect(row.values.temelio).toBe(PORTAL_SEED.phones?.primary.number);
});

test("an org no system holds comes back as sources with no record, not an error", async ({
  api,
}) => {
  const result = await api.compare("000000000");

  for (const source of result.sources) {
    expect(source.error, `${source.id} treated an unknown EIN as a failure`).toBeUndefined();
    expect(source.orgId).toBeNull();
  }

  // Every field is still a row, so the grid has a shape to render. Counted
  // from `DEMO_FIELDS` rather than written out: the library's promise is that
  // adding a field to the demo is one entry there and nothing else, and a
  // literal here would be the "nothing else" that breaks.
  expect(result.fields.map((field) => field.path)).toEqual(DEMO_FIELDS.map((field) => field.path));
  expect(result.fields.every((field) => field.status === "agree")).toBe(true);
});

test("a compare with no registry or id is a 400", async ({ api }) => {
  const response = await api.rawCompare({ id: AGILE_SIX_EIN });

  expect(response.status()).toBe(400);
});
