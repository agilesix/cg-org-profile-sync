import { describe, expect, it } from "vitest";
import type { Organization } from "../schemas/index.js";
import { OrganizationBaseSchema } from "../schemas/index.js";
import type { OrgSummary } from "../types.js";
import { DIFFERENT_ORG_REASON, selectableOrgs, summarizeOrg } from "./orgs.js";
import type { OrgLock } from "./orgs.js";

/**
 * Build a minimal, valid `Organization` by parsing a literal through the
 * schema, so a fixture that drifts from `OrganizationBaseSchema` fails loudly
 * here rather than quietly passing a stale shape.
 */
function org(overrides: Partial<Organization>): Organization {
  return OrganizationBaseSchema.parse({
    id: "018f2e77-1a2b-7c3d-8e4f-000000000001",
    name: "Agile Six Applications, Inc.",
    ...overrides,
  });
}

describe("summarizeOrg", () => {
  it("reads the EIN off an org that carries one", () => {
    const summary = summarizeOrg(
      org({
        identifiers: {
          "org:us:ein": { id: "123456789" },
        },
      }),
    );

    expect(summary).toEqual({
      id: "018f2e77-1a2b-7c3d-8e4f-000000000001",
      name: "Agile Six Applications, Inc.",
      ein: "123456789",
    });
  });

  it("gives ein: null for an org with no identifiers at all", () => {
    const summary = summarizeOrg(org({}));

    expect(summary).toEqual({
      id: "018f2e77-1a2b-7c3d-8e4f-000000000001",
      name: "Agile Six Applications, Inc.",
      ein: null,
    });
  });

  it("gives ein: null for an org whose identifiers name other registries but not org:us:ein", () => {
    const summary = summarizeOrg(
      org({
        identifiers: {
          systemId: { id: "018f2e77-1a2b-7c3d-8e4f-000000000002" },
          "org:us:uei": { id: "ABC123456789" },
        },
      }),
    );

    expect(summary.ein).toBeNull();
  });

  it("reads org:us:ein and ignores the other identifiers alongside it", () => {
    const summary = summarizeOrg(
      org({
        identifiers: {
          systemId: { id: "018f2e77-1a2b-7c3d-8e4f-000000000002" },
          "org:us:ein": { id: "987654321" },
          "org:us:uei": { id: "ABC123456789" },
        },
      }),
    );

    expect(summary.ein).toBe("987654321");
  });
});

describe("selectableOrgs", () => {
  const orgs: OrgSummary[] = [
    { id: "org-1", name: "Agile Six Applications, Inc.", ein: "123456789" },
    { id: "org-2", name: "Example Nonprofit", ein: "987654321" },
    { id: "org-3", name: "No EIN Org", ein: null },
  ];

  it("marks every row selectable with no reason when nothing is linked yet", () => {
    const rows = selectableOrgs(orgs, null);

    expect(rows).toEqual([
      { id: "org-1", name: "Agile Six Applications, Inc.", ein: "123456789", selectable: true },
      { id: "org-2", name: "Example Nonprofit", ein: "987654321", selectable: true },
      { id: "org-3", name: "No EIN Org", ein: null, selectable: true },
    ]);
  });

  it("selects only the row carrying the locked EIN", () => {
    const lock: OrgLock = { ein: "987654321", name: "Example Nonprofit" };

    const rows = selectableOrgs(orgs, lock);

    expect(rows.find((row) => row.id === "org-2")?.selectable).toBe(true);
    expect(rows.find((row) => row.id === "org-1")).toMatchObject({
      selectable: false,
      reason: DIFFERENT_ORG_REASON,
    });
  });

  it("does not select a row with no EIN of its own against an EIN lock", () => {
    const lock: OrgLock = { ein: "987654321", name: "Example Nonprofit" };

    const rows = selectableOrgs(orgs, lock);

    expect(rows.find((row) => row.id === "org-3")).toMatchObject({
      selectable: false,
      reason: DIFFERENT_ORG_REASON,
    });
  });

  it("marks every row unselectable when the locked EIN matches nothing", () => {
    const lock: OrgLock = { ein: "000000000", name: "Nobody Here" };

    const rows = selectableOrgs(orgs, lock);

    expect(rows.every((row) => !row.selectable)).toBe(true);
  });

  it("falls back to matching by name when the lock carries no EIN", () => {
    const lock: OrgLock = { ein: null, name: "Example Nonprofit" };

    const rows = selectableOrgs(orgs, lock);

    expect(rows.find((row) => row.id === "org-2")?.selectable).toBe(true);
    expect(rows.find((row) => row.id === "org-1")).toMatchObject({
      selectable: false,
      reason: DIFFERENT_ORG_REASON,
    });
  });

  it("matches by name case-insensitively when the lock carries no EIN", () => {
    const lock: OrgLock = { ein: null, name: "Agile Six Applications, Inc." };
    const rows = selectableOrgs(
      [{ id: "org-1", name: "AGILE SIX APPLICATIONS, INC.", ein: null }],
      lock,
    );

    expect(rows[0]?.selectable).toBe(true);
  });

  it("preserves order and length for a locked list", () => {
    const lock: OrgLock = { ein: "987654321", name: "Example Nonprofit" };

    const rows = selectableOrgs(orgs, lock);

    expect(rows.map((row) => row.id)).toEqual(["org-1", "org-2", "org-3"]);
  });

  it("returns an empty array for an empty input list rather than throwing", () => {
    const rows = selectableOrgs([], null);

    expect(rows).toEqual([]);
  });
});
