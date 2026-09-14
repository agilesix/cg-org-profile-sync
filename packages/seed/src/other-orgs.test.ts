import { describe, expect, it } from "vitest";
import { OrganizationBaseSchema } from "@cg-link/org-sync/schemas";
import { DEMO_FIELDS, EIN_REGISTRY, compareProfiles } from "@cg-link/org-sync/utils";
import { FUNDERHUB_SEED, PORTAL_SEED } from "./agile-six.js";
import { FUNDERHUB_SEEDS, PORTAL_SEEDS } from "./other-orgs.js";

const systemSeeds = [
  ["GrantPortal", PORTAL_SEEDS],
  ["FunderHub", FUNDERHUB_SEEDS],
] as const;

describe("PORTAL_SEEDS and FUNDERHUB_SEEDS", () => {
  it.each(systemSeeds)("%s seeds three organizations", (_system, seeds) => {
    expect(seeds).toHaveLength(3);
  });

  it("puts the Agile Six seed first on GrantPortal", () => {
    expect(PORTAL_SEEDS[0]).toEqual(PORTAL_SEED);
  });

  it("puts the Agile Six seed first on FunderHub", () => {
    expect(FUNDERHUB_SEEDS[0]).toEqual(FUNDERHUB_SEED);
  });

  it.each(systemSeeds)("every %s seed is a valid organization", (_system, seeds) => {
    for (const seed of seeds) {
      const result = OrganizationBaseSchema.safeParse(seed);

      expect(result.error?.issues ?? []).toEqual([]);
      expect(result.success).toBe(true);
    }
  });

  it.each(systemSeeds)("%s assigns each of its three orgs a distinct id", (_system, seeds) => {
    const ids = seeds.map((seed) => seed.id);

    expect(new Set(ids).size).toBe(seeds.length);
  });

  it.each(systemSeeds)("%s assigns each of its three orgs a distinct EIN", (_system, seeds) => {
    const eins = seeds.map((seed) => seed.identifiers?.[EIN_REGISTRY]?.id);

    expect(new Set(eins).size).toBe(seeds.length);
  });

  it("shares no org id between the two systems", () => {
    const portalIds = new Set(PORTAL_SEEDS.map((seed) => seed.id));
    const funderhubIds = new Set(FUNDERHUB_SEEDS.map((seed) => seed.id));

    for (const id of portalIds) {
      expect(funderhubIds.has(id)).toBe(false);
    }
  });

  it("holds the same set of EINs on both systems", () => {
    const portalEins = new Set(PORTAL_SEEDS.map((seed) => seed.identifiers?.[EIN_REGISTRY]?.id));
    const funderhubEins = new Set(
      FUNDERHUB_SEEDS.map((seed) => seed.identifiers?.[EIN_REGISTRY]?.id),
    );

    expect(funderhubEins).toEqual(portalEins);
  });

  it("agrees on the name of each org sharing an EIN across systems", () => {
    const funderhubByEin = new Map(
      FUNDERHUB_SEEDS.map((seed) => [seed.identifiers?.[EIN_REGISTRY]?.id, seed.name]),
    );

    for (const seed of PORTAL_SEEDS) {
      const ein = seed.identifiers?.[EIN_REGISTRY]?.id;

      expect(funderhubByEin.get(ein)).toBe(seed.name);
    }
  });
});

describe("the two new orgs added beyond Agile Six", () => {
  const newPortalSeeds = PORTAL_SEEDS.slice(1);
  const newFunderhubSeeds = FUNDERHUB_SEEDS.slice(1);

  const pairs = newPortalSeeds.flatMap((portalSeed) => {
    const ein = portalSeed.identifiers?.[EIN_REGISTRY]?.id;
    const funderhubSeed = newFunderhubSeeds.find(
      (seed) => seed.identifiers?.[EIN_REGISTRY]?.id === ein,
    );

    return funderhubSeed ? [[ein, portalSeed, funderhubSeed] as const] : [];
  });

  it("finds a FunderHub counterpart for each new GrantPortal org", () => {
    expect(pairs).toHaveLength(newPortalSeeds.length);
  });

  it.each(pairs)(
    "every demo field agrees across systems for EIN %s",
    (_ein, portalSeed, funderhubSeed) => {
      const rows = compareProfiles({ portal: portalSeed, funderhub: funderhubSeed });

      expect(rows).toHaveLength(DEMO_FIELDS.length);
      for (const row of rows) {
        expect(row.status).toBe("agree");
      }
    },
  );
});
