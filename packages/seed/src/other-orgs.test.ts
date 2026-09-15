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
  it("seeds GrantPortal with three organizations", () => {
    expect(PORTAL_SEEDS).toHaveLength(3);
  });

  it("seeds FunderHub with two, since it has never heard of one of them", () => {
    // Not an oversight. Two independent systems hold different sets of
    // records, and the widget has a state for signing in to one that has no
    // record of the organization you linked.
    expect(FUNDERHUB_SEEDS).toHaveLength(2);
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

  it.each(systemSeeds)("%s assigns each of its orgs a distinct id", (_system, seeds) => {
    const ids = seeds.map((seed) => seed.id);

    expect(new Set(ids).size).toBe(seeds.length);
  });

  it.each(systemSeeds)("%s assigns each of its orgs a distinct EIN", (_system, seeds) => {
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

  it("holds every FunderHub EIN on GrantPortal too", () => {
    // The weaker claim than "the same set", and the one that actually has to
    // hold: FunderHub may know fewer organizations, but it must not know one
    // GrantPortal has never heard of, or the widget could be locked to an
    // organization the first system cannot show.
    const portalEins = new Set(PORTAL_SEEDS.map((seed) => seed.identifiers?.[EIN_REGISTRY]?.id));

    for (const seed of FUNDERHUB_SEEDS) {
      expect(portalEins).toContain(seed.identifiers?.[EIN_REGISTRY]?.id);
    }
  });

  it("holds one organization GrantPortal knows and FunderHub does not", () => {
    // The beat the organization step's "no organization with that EIN" exists
    // for, and the reason a browser spec can reach it at all.
    const funderhubEins = new Set(
      FUNDERHUB_SEEDS.map((seed) => seed.identifiers?.[EIN_REGISTRY]?.id),
    );
    const onlyOnPortal = PORTAL_SEEDS.filter(
      (seed) => !funderhubEins.has(seed.identifiers?.[EIN_REGISTRY]?.id),
    );

    expect(onlyOnPortal).toHaveLength(1);
  });

  it("agrees on the name of each org sharing an EIN across systems", () => {
    const funderhubByEin = new Map(
      FUNDERHUB_SEEDS.map((seed) => [seed.identifiers?.[EIN_REGISTRY]?.id, seed.name]),
    );

    for (const seed of PORTAL_SEEDS) {
      const ein = seed.identifiers?.[EIN_REGISTRY]?.id;
      const onFunderhub = funderhubByEin.get(ein);

      // Skipped rather than failed when FunderHub does not hold it: this is
      // about the mapping being consistent, not about coverage.
      if (onFunderhub !== undefined) {
        expect(onFunderhub).toBe(seed.name);
      }
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

  it("finds at least one pair to compare, so the cases below are not vacuous", () => {
    // `it.each([])` passes by running nothing. This is the guard against the
    // agreement checks below quietly testing an empty list if the seeds ever
    // stop overlapping at all.
    expect(pairs.length).toBeGreaterThan(0);
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
