import { describe, expect, it } from "vitest";
import { DEMO_FIELDS, compareProfiles } from "@cg-link/org-sync/utils";
import { AGILE_SIX_EIN, FUNDERHUB_SEED, PORTAL_SEED } from "./agile-six.js";

/**
 * The comparison the demo actually shows, run over the real seeds.
 *
 * Lives here rather than in `@cg-link/org-sync` because the seeds depend on
 * that package; importing them there would make the dependency circular.
 */
describe("comparing the seed profiles", () => {
  const rows = compareProfiles({ portal: PORTAL_SEED, funderhub: FUNDERHUB_SEED });
  const rowFor = (path: string) => rows.find((row) => row.path === path);

  it("compares one row per demo field", () => {
    expect(rows.map((row) => row.path)).toEqual(DEMO_FIELDS.map((field) => field.path));
  });

  it("finds the address and the email as the only disagreements", () => {
    expect(rows.filter((row) => row.status === "differs").map((row) => row.path)).toEqual([
      "addresses.primary",
      "emails.primary",
    ]);

    // Names which system holds what, not just that the two disagree. The
    // address does the same below, in the case that is about it.
    expect(rowFor("emails.primary")?.values).toEqual({
      portal: PORTAL_SEED.emails?.primary,
      funderhub: FUNDERHUB_SEED.emails?.primary,
    });
  });

  it("agrees on the phone number", () => {
    // Nothing was invented to make the phone drift, so it stands as the
    // demo's example of two systems that actually agree on a shared field.
    expect(rowFor("phones.primary.number")?.status).toBe("agree");
    expect(rowFor("phones.primary.number")?.distinctCount).toBe(1);
  });

  it("shows the mission as held by GrantPortal only, not a disagreement", () => {
    // FunderHub never filled the mission in at all — a gap, not a drift — so
    // it must not read as a conflict the way the address and email do.
    const mission = rowFor("mission");

    expect(mission?.values).toEqual({ portal: PORTAL_SEED.mission });

    // Not merely undefined under that key: `toEqual` reads an undefined
    // property and an absent one as the same thing, and the grid renders a
    // cell for every key it finds.
    expect(mission?.values).not.toHaveProperty("funderhub");
    expect(mission?.distinctCount).toBe(1);
    expect(mission?.status).toBe("agree");
  });

  it("shows each system's own suite number for the address", () => {
    expect(rowFor("addresses.primary")?.values).toEqual({
      portal: PORTAL_SEED.addresses?.primary,
      funderhub: FUNDERHUB_SEED.addresses?.primary,
    });
  });

  it("shows the website as held by GrantPortal only", () => {
    const website = rowFor("socials.website");

    expect(website?.values).toEqual({ portal: PORTAL_SEED.socials?.website });
    expect(website?.distinctCount).toBe(1);
    expect(website?.status).toBe("agree");
  });

  it("agrees on the name and the EIN the org is matched by", () => {
    expect(rowFor("name")?.status).toBe("agree");
    expect(rowFor("identifiers.org:us:ein.id")?.values).toEqual({
      portal: AGILE_SIX_EIN,
      funderhub: AGILE_SIX_EIN,
    });
    expect(rowFor("identifiers.org:us:ein.id")?.status).toBe("agree");
  });
});
