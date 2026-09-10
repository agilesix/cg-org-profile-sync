/**
 * `GET /api/compare` against the two running systems.
 *
 * The assertions are about the seed's four deliberate disagreements, which are
 * the whole point of the demo: the two copies of Agile Six's profile agree on
 * who the org is and disagree on where it is.
 */

import { DEMO_FIELDS } from "@cg-link/org-sync/utils";
import { AGILE_SIX_EIN, PORTAL_SEED } from "@cg-link/seed";
import { expect, rowFor, test } from "../fixtures.js";

test("every configured source answers with its own id for the org", async ({ api }) => {
  const result = await api.compare();

  expect(result.sources.map((source) => source.id)).toEqual(["portal", "funderhub"]);

  for (const source of result.sources) {
    expect(source.error, `${source.id} did not answer`).toBeUndefined();
    expect(source.orgId, `${source.id} holds no record of the org`).not.toBeNull();
  }

  // Ids are assigned per system, so the same org has two of them. If these
  // matched, the widget would be reading one system twice.
  const [portal, funderhub] = result.sources;
  expect(portal?.orgId).not.toEqual(funderhub?.orgId);
});

test("the primary address differs — portal holds Suite 300, funderhub Suite 210", async ({
  api,
}) => {
  const row = rowFor(await api.compare(), "addresses.primary");

  expect(row.status).toBe("differs");
  expect(row.distinctCount).toBe(2);
  expect(row.values.portal).toMatchObject({ street2: "Suite 300" });
  expect(row.values.funderhub).toMatchObject({ street2: "Suite 210" });
});

test("the legal name and the EIN agree across both systems", async ({ api }) => {
  const result = await api.compare();

  const name = rowFor(result, "name");
  expect(name.status).toBe("agree");
  expect(name.values.portal).toBe(PORTAL_SEED.name);
  expect(name.values.funderhub).toBe(name.values.portal);

  const ein = rowFor(result, "identifiers.org:us:ein.id");
  expect(ein.status).toBe("agree");
  expect(ein.values.portal).toBe(AGILE_SIX_EIN);
  expect(ein.values.funderhub).toBe(AGILE_SIX_EIN);
});

test("the website is held by portal only, and that is not a conflict", async ({ api }) => {
  const row = rowFor(await api.compare(), "socials.website");

  expect(row.values.portal).toBe(PORTAL_SEED.socials?.website);

  // FunderHub does not model socials at all. A field one system holds and the
  // other has never heard of is not a disagreement, and must not render as one.
  expect(row.values).not.toHaveProperty("funderhub");
  expect(row.status).toBe("agree");
  expect(row.distinctCount).toBe(1);
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
  // from `DEMO_FIELDS` rather than written as 4: the library's promise is that
  // adding a field to the demo is one entry there and nothing else, and a
  // literal here would be the "nothing else" that breaks.
  expect(result.fields.map((field) => field.path)).toEqual(DEMO_FIELDS.map((field) => field.path));
  expect(result.fields.every((field) => field.status === "agree")).toBe(true);
});

test("a compare with no registry or id is a 400", async ({ api }) => {
  const response = await api.rawCompare({ id: AGILE_SIX_EIN });

  expect(response.status()).toBe(400);
});
