import { TEMELIO_ORG_ID, TEMELIO_SEED } from "@cg-link/seed";
import { describe, expect, it } from "vitest";
import type { Organization } from "@cg-link/org-sync/schemas";
import { type TemelioApi, TemelioApiError } from "./api.js";
import { AGILE_SIX_TEMELIO_RECORD, FakeTemelioApi } from "./fixture.js";
import { TemelioRecordSchema, type TemelioRecord } from "./records.js";
import { TemelioOrgStore } from "./store.js";

/** Wraps a `TemelioApi` to record the order and arguments of its `read`/`write` calls. */
function trackCalls(inner: TemelioApi): {
  api: TemelioApi;
  calls: Array<["read" | "write", unknown[]]>;
} {
  const calls: Array<["read" | "write", unknown[]]> = [];
  const api: TemelioApi = {
    searchByEin: (ein) => inner.searchByEin(ein),
    read: async (nonprofitId) => {
      calls.push(["read", [nonprofitId]]);
      return inner.read(nonprofitId);
    },
    write: async (nonprofitId, patch) => {
      calls.push(["write", [nonprofitId, patch]]);
      return inner.write(nonprofitId, patch);
    },
  };

  return { api, calls };
}

describe("TemelioOrgStore", () => {
  describe("list", () => {
    it("returns one organization per allowlisted id, in allowlist order", async () => {
      const secondId = "second-nonprofit-id";
      const thirdId = "third-nonprofit-id";
      const { api, calls } = trackCalls({
        searchByEin: async () => [],

        // Each id answers as itself. A stub handing back one record for every
        // id would let a store that ignored the allowlist order pass.
        read: async (nonprofitId) =>
          ({ ...AGILE_SIX_TEMELIO_RECORD, nonprofitId }) as TemelioRecord,
        write: async () => undefined,
      });
      const store = new TemelioOrgStore({ api, allowlist: [secondId, TEMELIO_ORG_ID, thirdId] });

      const result = await store.list();

      expect(result.map((org) => org.id)).toEqual([secondId, TEMELIO_ORG_ID, thirdId]);
      expect(calls.map(([method, args]) => [method, args[0]])).toEqual([
        ["read", secondId],
        ["read", TEMELIO_ORG_ID],
        ["read", thirdId],
      ]);
    });

    it("skips an allowlisted id the api has no record for, and reports it once through onProblem", async () => {
      const missingId = "no-such-nonprofit-id";
      const problems: string[] = [];
      const api: TemelioApi = {
        searchByEin: async () => [],
        read: async (nonprofitId) =>
          nonprofitId === TEMELIO_ORG_ID ? (AGILE_SIX_TEMELIO_RECORD as TemelioRecord) : undefined,
        write: async () => undefined,
      };

      const store = new TemelioOrgStore({
        api,
        allowlist: [TEMELIO_ORG_ID, missingId],
        onProblem: (problem) => problems.push(problem),
      });

      const result = await store.list();

      expect(result.map((org) => org.id)).toEqual([TEMELIO_ORG_ID]);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(missingId);
    });

    it("lets a TemelioApiError from read propagate, rather than reading as an empty list", async () => {
      const error = new TemelioApiError("Temelio rejected the request.", { status: 401 });
      const api: TemelioApi = {
        searchByEin: async () => [],
        read: async () => {
          throw error;
        },
        write: async () => undefined,
      };

      const store = new TemelioOrgStore({ api, allowlist: [TEMELIO_ORG_ID] });

      await expect(store.list()).rejects.toBe(error);
    });
  });

  describe("read", () => {
    it("resolves undefined for an id outside the allowlist, without asking the api for it", async () => {
      const { api, calls } = trackCalls({
        searchByEin: async () => [],
        read: async () => AGILE_SIX_TEMELIO_RECORD as TemelioRecord,
        write: async () => undefined,
      });
      const store = new TemelioOrgStore({ api, allowlist: [TEMELIO_ORG_ID] });

      const result = await store.read("some-other-nonprofit-id");

      expect(result).toBeUndefined();
      expect(calls).toEqual([]);
    });

    it("maps an allowlisted id to the Organization Temelio's record describes", async () => {
      const api = new FakeTemelioApi();
      const store = new TemelioOrgStore({ api, allowlist: [TEMELIO_ORG_ID] });

      const result = await store.read(TEMELIO_ORG_ID);

      expect(result).toEqual(TEMELIO_SEED);
    });
  });

  describe("write", () => {
    it("reads the current record, writes only the changed keys, then re-reads and returns that", async () => {
      const { api, calls } = trackCalls(new FakeTemelioApi());
      const store = new TemelioOrgStore({ api, allowlist: [TEMELIO_ORG_ID] });

      const current = await store.read(TEMELIO_ORG_ID);
      calls.length = 0; // only the write's own calls matter from here

      // `TEMELIO_SEED.socials.website` is Temelio's `website` field, the one
      // field this change touches — `toMetadataPatch` reports exactly that
      // key alone for the identical edit (see mapping.test.ts).
      const changed: Organization = {
        ...(current as Organization),
        socials: { website: "https://agile6.com" },
      };

      const result = await store.write(changed);

      expect(calls.map(([method]) => method)).toEqual(["read", "write", "read"]);

      const writeCall = calls[1];
      expect(writeCall?.[1]).toEqual([TEMELIO_ORG_ID, { website: "https://agile6.com" }]);

      expect(result?.socials?.website).toBe("https://agile6.com");
    });

    it("declines a write for an org outside the allowlist, without calling the api's write", async () => {
      const { api, calls } = trackCalls(new FakeTemelioApi());
      const store = new TemelioOrgStore({ api, allowlist: [TEMELIO_ORG_ID] });
      const outside: Organization = { id: "some-other-nonprofit-id", name: "Not Allowed" };

      const result = await store.write(outside);

      expect(result).toBeUndefined();
      expect(calls.some(([method]) => method === "write")).toBe(false);
    });

    it("sends no write when nothing changed, and still returns the org", async () => {
      const { api, calls } = trackCalls(new FakeTemelioApi());
      const store = new TemelioOrgStore({ api, allowlist: [TEMELIO_ORG_ID] });

      const current = await store.read(TEMELIO_ORG_ID);
      calls.length = 0;

      const result = await store.write(current as Organization);

      expect(calls.some(([method]) => method === "write")).toBe(false);
      expect(result).toEqual(current);
    });
  });
});

describe("FakeTemelioApi", () => {
  it("puts a written record back to its seeded value on reset", async () => {
    const api = new FakeTemelioApi();

    // The seeded record as the fake holds it: parsed, so the funder-side keys
    // the adapter never maps have already been stripped.
    const seeded = TemelioRecordSchema.parse(AGILE_SIX_TEMELIO_RECORD);

    await api.write(TEMELIO_ORG_ID, { website: "https://example.org/changed" });
    expect(api.records.get(TEMELIO_ORG_ID)).not.toEqual(seeded);

    api.reset();

    expect(api.records.get(TEMELIO_ORG_ID)).toEqual(seeded);
  });
});
