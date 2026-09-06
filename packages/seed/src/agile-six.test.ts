import { describe, expect, it } from "vitest";
import { OrganizationBaseSchema } from "@cg-link/org-sync/schemas";
import { AGILE_SIX_EIN, FUNDERHUB_SEED, PORTAL_SEED } from "./agile-six.js";

const seeds = [
  ["GrantPortal", PORTAL_SEED],
  ["FunderHub", FUNDERHUB_SEED],
] as const;

describe("seed profiles", () => {
  it.each(seeds)("%s is a valid organization", (_system, seed) => {
    const result = OrganizationBaseSchema.safeParse(seed);

    expect(result.error?.issues ?? []).toEqual([]);
    expect(result.success).toBe(true);
  });

  it.each(seeds)("%s carries the EIN the widget matches on", (_system, seed) => {
    expect(seed.identifiers?.["org:us:ein"]?.id).toBe(AGILE_SIX_EIN);
  });

  it("gives each system its own record id, as separate systems would", () => {
    expect(PORTAL_SEED.id).not.toBe(FUNDERHUB_SEED.id);
  });

  it("agrees on the fields that identify the organization", () => {
    expect(FUNDERHUB_SEED.name).toBe(PORTAL_SEED.name);
  });

  it("disagrees on the fields the comparison is meant to surface", () => {
    expect(FUNDERHUB_SEED.addresses?.primary.street2).not.toBe(
      PORTAL_SEED.addresses?.primary.street2,
    );
    expect(FUNDERHUB_SEED.emails?.primary).not.toBe(PORTAL_SEED.emails?.primary);
    expect(FUNDERHUB_SEED.mission).toBeUndefined();
    expect(PORTAL_SEED.mission).toBeTruthy();
  });

  it("leaves FunderHub without the fields it does not model", () => {
    expect(FUNDERHUB_SEED.socials).toBeUndefined();
    expect(FUNDERHUB_SEED.yearFounded).toBeUndefined();
  });
});
