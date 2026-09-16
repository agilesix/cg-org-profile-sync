import { describe, expect, it } from "vitest";
import { PORTAL_ORG_ID } from "./agile-six.js";
import { DEMO_USERS, demoUsers, grantsFor, roleFor } from "./demo-users.js";
import { FUNDERHUB_SEEDS, PORTAL_SEEDS } from "./other-orgs.js";

const PORTAL_ORG_IDS = PORTAL_SEEDS.map((seed) => seed.id);
const FUNDERHUB_ORG_IDS = FUNDERHUB_SEEDS.map((seed) => seed.id);

const SEEDED_ORG_IDS = [...PORTAL_ORG_IDS, ...FUNDERHUB_ORG_IDS];

describe("DEMO_USERS", () => {
  it("holds exactly two people, with distinct emails", () => {
    expect(DEMO_USERS).toHaveLength(2);
    expect(new Set(DEMO_USERS.map((user) => user.email)).size).toBe(2);
  });

  it("grants the admin every seeded org on portal", () => {
    const admin = DEMO_USERS.find((user) => user.email === "admin@example.org");

    expect(new Set(admin?.grants.portal)).toEqual(new Set(PORTAL_SEEDS.map((seed) => seed.id)));
  });

  it("grants the admin every seeded org on funderhub", () => {
    const admin = DEMO_USERS.find((user) => user.email === "admin@example.org");

    expect(new Set(admin?.grants.funderhub)).toEqual(
      new Set(FUNDERHUB_SEEDS.map((seed) => seed.id)),
    );
  });

  it("grants the portal-only user only the portal org on portal", () => {
    const portalOnly = DEMO_USERS.find((user) => user.email === "portal-only@example.org");

    expect(portalOnly?.grants.portal).toEqual([PORTAL_ORG_ID]);
  });

  it("grants the portal-only user nothing on funderhub", () => {
    const portalOnly = DEMO_USERS.find((user) => user.email === "portal-only@example.org");

    expect(portalOnly?.grants.funderhub).toEqual([]);
  });

  it("every org id named in any user's grants is one of the seeded org ids", () => {
    const grantedOrgIds = DEMO_USERS.flatMap((user) => Object.values(user.grants).flat());

    for (const orgId of grantedOrgIds) {
      expect(SEEDED_ORG_IDS).toContain(orgId);
    }
  });
});

describe("grantsFor", () => {
  it("gives the portal-only user nothing on funderhub, even though they exist elsewhere", () => {
    expect(grantsFor("funderhub", "portal-only@example.org")).toEqual([]);
  });

  it("returns nothing for an email nobody in DEMO_USERS has", () => {
    expect(grantsFor("portal", "nobody@example.org")).toEqual([]);
  });

  it("returns nothing for a system id nobody is granted anything on, rather than throwing", () => {
    expect(grantsFor("temelio", "admin@example.org")).toEqual([]);
  });

  it("matches the email case-insensitively", () => {
    expect(grantsFor("portal", "Admin@Example.org")).toEqual(PORTAL_ORG_IDS);
  });
});

describe("demoUsers", () => {
  it("with no argument, returns the same people as DEMO_USERS", () => {
    expect(demoUsers()).toEqual(DEMO_USERS);
  });

  it("replaces the admin's email with an override, leaving their grants untouched", () => {
    const [admin] = demoUsers({ admin: "someone-else@example.net" });

    expect(admin?.email).toBe("someone-else@example.net");
    expect(admin?.grants.portal).toEqual(PORTAL_ORG_IDS);
    expect(admin?.grants.funderhub).toEqual(FUNDERHUB_ORG_IDS);
  });

  it("overriding one role leaves the other role's placeholder alone", () => {
    const users = demoUsers({ admin: "someone-else@example.net" });
    const portalOnly = users.find((user) => user.role === "portal-only");

    expect(portalOnly?.email).toBe("portal-only@example.org");
  });

  it("an undefined override leaves the placeholder in place", () => {
    const users = demoUsers({ admin: undefined });
    const admin = users.find((user) => user.role === "admin");

    expect(admin?.email).toBe("admin@example.org");
  });

  it("an empty string override leaves the placeholder in place", () => {
    const users = demoUsers({ admin: "" });
    const admin = users.find((user) => user.role === "admin");

    expect(admin?.email).toBe("admin@example.org");
  });

  it("tags each returned user with the role they play in the demo", () => {
    const users = demoUsers({ admin: "someone-else@example.net" });

    expect(users.find((user) => user.email === "someone-else@example.net")?.role).toBe("admin");
    expect(users.find((user) => user.role === "portal-only")?.email).toBe(
      "portal-only@example.org",
    );
  });

  it("grantsFor looks up an overridden email in the list passed to it", () => {
    const users = demoUsers({ admin: "someone-else@example.net" });

    expect(grantsFor("portal", "someone-else@example.net", users)).toEqual(PORTAL_ORG_IDS);
    expect(grantsFor("portal", "admin@example.org", users)).toEqual([]);
  });

  it("the overridden lookup still matches case-insensitively", () => {
    const users = demoUsers({ admin: "someone-else@example.net" });

    expect(grantsFor("portal", "Someone-Else@Example.net", users)).toEqual(PORTAL_ORG_IDS);
  });
});

describe("roleFor", () => {
  it("resolves the admin's address to the admin role", () => {
    expect(roleFor("admin@example.org")).toBe("admin");
  });

  it("resolves the portal-only person's address to the portal-only role", () => {
    expect(roleFor("portal-only@example.org")).toBe("portal-only");
  });

  it("resolves an address belonging to nobody to undefined, not a default role", () => {
    expect(roleFor("nobody@example.org")).toBeUndefined();
  });

  it("matches the email case-insensitively, like grantsFor", () => {
    expect(roleFor("Admin@Example.org")).toBe("admin");
  });

  it("looks up an overridden email in the list passed to it, and no longer matches the placeholder it replaced", () => {
    const users = demoUsers({ admin: "someone-else@example.net" });

    expect(roleFor("someone-else@example.net", users)).toBe("admin");
    expect(roleFor("admin@example.org", users)).toBeUndefined();
  });
});
