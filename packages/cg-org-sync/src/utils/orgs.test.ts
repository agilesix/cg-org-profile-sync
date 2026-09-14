import { describe, expect, it } from "vitest";
import type { Organization } from "../schemas/index.js";
import { OrganizationBaseSchema } from "../schemas/index.js";
import { summarizeOrg } from "./orgs.js";

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
