import {
  AGILE_SIX_EIN,
  FUNDERHUB_ORG_ID,
  FUNDERHUB_SEED,
  FUNDERHUB_UNWRITABLE_FIELDS,
  PORTAL_ORG_ID,
  PORTAL_SEED,
} from "@cg-link/seed";
import { describe, expect, it } from "vitest";
import {
  MERGE_PATCH_CONTENT_TYPE,
  listOrgs,
  readOrg,
  updateOrg,
  type OrgRoutesConfig,
} from "./org-routes.js";
import { MemoryOrgStore } from "./store.js";

/** The lookup the widget makes when all it knows is an EIN. */
const einQuery = (ein: string) =>
  new URL(`https://example.com/common-grants/orgs?registry=org:us:ein&id=${ein}`);

/** A `PATCH` of `body`, sent as a merge patch unless another content type is given. */
function patchRequest(orgId: string, body: unknown, contentType = MERGE_PATCH_CONTENT_TYPE) {
  return new Request(`https://example.com/common-grants/orgs/${orgId}`, {
    method: "PATCH",
    headers: { "content-type": contentType },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("listOrgs", () => {
  it("filters to only the orgs carrying the given identifier as active, paginated", async () => {
    const otherOrg = structuredClone(FUNDERHUB_SEED);
    otherOrg.id = "018f2e77-1a2b-7c3d-8e4f-000000000099";
    otherOrg.identifiers = {
      "org:us:ein": {
        registry: {
          code: "org:us:ein",
          url: "https://commongrants.org/registries/org-us-ein",
        },
        id: "987654321",
      },
    };

    const store = new MemoryOrgStore([PORTAL_SEED, FUNDERHUB_SEED, otherOrg]);
    const config: OrgRoutesConfig = { store, source: "portal" };

    const response = await listOrgs(einQuery(AGILE_SIX_EIN), config);
    const body = await response.json();

    expect(body).toEqual({
      status: 200,
      message: "Success",
      items: [PORTAL_SEED, FUNDERHUB_SEED],
      paginationInfo: { page: 1, pageSize: 100, totalItems: 2, totalPages: 1 },
    });
  });

  it("excludes an org whose only matching identifier is archived", async () => {
    const retiredOrg = structuredClone(PORTAL_SEED);
    retiredOrg.id = "018f2e77-1a2b-7c3d-8e4f-000000000098";
    retiredOrg.identifiers = {
      "org:us:ein": {
        registry: { code: "org:us:ein" },
        allIds: [{ id: AGILE_SIX_EIN, status: "archived" }],
      },
    };

    const store = new MemoryOrgStore([retiredOrg]);

    const response = await listOrgs(einQuery(AGILE_SIX_EIN), { store, source: "portal" });
    const body = await response.json();

    expect(body.items).toEqual([]);
    expect(body.paginationInfo.totalItems).toBe(0);
  });

  it("rejects a registry filter that is missing its id", async () => {
    const store = new MemoryOrgStore([PORTAL_SEED]);

    const response = await listOrgs(
      new URL("https://example.com/common-grants/orgs?registry=org:us:ein"),
      { store, source: "portal" },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.status).toBe(400);
  });

  it("falls back to the first page when page and pageSize are not positive integers", async () => {
    const store = new MemoryOrgStore([PORTAL_SEED, FUNDERHUB_SEED]);

    const response = await listOrgs(
      new URL("https://example.com/common-grants/orgs?page=0&pageSize=nonsense"),
      { store, source: "portal" },
    );
    const body = await response.json();

    expect(body.paginationInfo).toEqual({
      page: 1,
      pageSize: 100,
      totalItems: 2,
      totalPages: 1,
    });
    expect(body.items).toHaveLength(2);
  });
});

describe("readOrg", () => {
  it("returns the profile in the standard envelope", async () => {
    const store = new MemoryOrgStore([PORTAL_SEED, FUNDERHUB_SEED]);

    const response = await readOrg(PORTAL_ORG_ID, { store, source: "portal" });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual(PORTAL_SEED);
  });

  it("returns 404 for an org this system does not hold", async () => {
    const store = new MemoryOrgStore([PORTAL_SEED]);

    const response = await readOrg(FUNDERHUB_ORG_ID, { store, source: "portal" });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.status).toBe(404);
  });
});

describe("updateOrg", () => {
  it("stores the patched profile, keeps id unchanged, and returns an accepted revision", async () => {
    const store = new MemoryOrgStore([PORTAL_SEED]);
    const config: OrgRoutesConfig = { store, source: "portal" };
    const patch = { mission: "A new mission statement." };

    const response = await updateOrg(PORTAL_ORG_ID, patchRequest(PORTAL_ORG_ID, patch), config);
    const body = await response.json();

    expect(body.data.status.value).toBe("accepted");
    expect(body.data.source).toBe("portal");
    expect(body.data.patch).toEqual(patch);
    expect(body.data.snapshot.id).toBe(PORTAL_ORG_ID);
    expect(body.data.snapshot.mission).toBe(patch.mission);

    const stored = await store.read(PORTAL_ORG_ID);

    expect(stored?.id).toBe(PORTAL_ORG_ID);
    expect(stored?.mission).toBe(patch.mission);
  });

  it("drops an unwritable field, applies the rest, and names the drop in the message", async () => {
    const store = new MemoryOrgStore([FUNDERHUB_SEED]);
    const config: OrgRoutesConfig = {
      store,
      source: "funderhub",
      unwritableFields: FUNDERHUB_UNWRITABLE_FIELDS,
    };
    const patch = {
      socials: { website: "https://agile6.com" },
      mission: "A new mission statement.",
    };

    const response = await updateOrg(
      FUNDERHUB_ORG_ID,
      patchRequest(FUNDERHUB_ORG_ID, patch),
      config,
    );
    const body = await response.json();

    expect(body.message).toContain("socials");
    expect(body.data.snapshot.mission).toBe(patch.mission);
    expect(body.data.snapshot.socials).toBeUndefined();

    const stored = await store.read(FUNDERHUB_ORG_ID);

    expect(stored?.mission).toBe(patch.mission);
    expect(stored?.socials).toBeUndefined();
  });

  it("rejects a patch that nulls a required field and stores nothing", async () => {
    const store = new MemoryOrgStore([PORTAL_SEED]);
    const config: OrgRoutesConfig = { store, source: "portal" };

    const response = await updateOrg(
      PORTAL_ORG_ID,
      patchRequest(PORTAL_ORG_ID, { name: null }),
      config,
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.status).toBe(400);
    expect(body.errors.length).toBeGreaterThan(0);

    const stored = await store.read(PORTAL_ORG_ID);

    expect(stored).toEqual(PORTAL_SEED);
  });

  it("rejects a patch sent as plain JSON rather than a merge patch", async () => {
    const store = new MemoryOrgStore([PORTAL_SEED]);
    const request = patchRequest(PORTAL_ORG_ID, { mission: "Sent wrong" }, "application/json");

    const response = await updateOrg(PORTAL_ORG_ID, request, { store, source: "portal" });

    expect(response.status).toBe(415);
    expect(await store.read(PORTAL_ORG_ID)).toEqual(PORTAL_SEED);
  });

  it("rejects a body that is not JSON", async () => {
    const store = new MemoryOrgStore([PORTAL_SEED]);
    const request = patchRequest(PORTAL_ORG_ID, "{ not json");

    const response = await updateOrg(PORTAL_ORG_ID, request, { store, source: "portal" });

    expect(response.status).toBe(400);
    expect(await store.read(PORTAL_ORG_ID)).toEqual(PORTAL_SEED);
  });

  it("rejects a patch carrying a field the schema does not know", async () => {
    const store = new MemoryOrgStore([PORTAL_SEED]);
    const request = patchRequest(PORTAL_ORG_ID, { missionStatement: "Misspelled" });

    const response = await updateOrg(PORTAL_ORG_ID, request, { store, source: "portal" });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.errors.length).toBeGreaterThan(0);
    expect(await store.read(PORTAL_ORG_ID)).toEqual(PORTAL_SEED);
  });

  it("returns 404 for an org this system does not hold", async () => {
    const store = new MemoryOrgStore([PORTAL_SEED]);
    const request = patchRequest(FUNDERHUB_ORG_ID, { mission: "Nobody to patch" });

    const response = await updateOrg(FUNDERHUB_ORG_ID, request, { store, source: "portal" });

    expect(response.status).toBe(404);
  });
});
