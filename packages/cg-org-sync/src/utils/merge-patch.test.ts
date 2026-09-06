import { describe, expect, it } from "vitest";
import { applyMergePatch } from "./merge-patch.js";

describe("applyMergePatch", () => {
  it("sets the fields it names and leaves the rest alone", () => {
    const org = { name: "Riverside", mission: "Old mission", yearFounded: "2011" };

    expect(applyMergePatch(org, { mission: "New mission" })).toEqual({
      name: "Riverside",
      mission: "New mission",
      yearFounded: "2011",
    });
  });

  it("removes a field sent as null", () => {
    const org = { name: "Riverside", socials: { website: "riversidechc.org" } };

    expect(applyMergePatch(org, { socials: { website: null } })).toEqual({
      name: "Riverside",
      socials: {},
    });
  });

  it("merges nested objects rather than replacing them", () => {
    const org = { addresses: { primary: { city: "Philadelphia", postalCode: "19123" } } };

    expect(applyMergePatch(org, { addresses: { primary: { postalCode: "19130" } } })).toEqual({
      addresses: { primary: { city: "Philadelphia", postalCode: "19130" } },
    });
  });

  it("replaces arrays whole", () => {
    const org = { tags: ["health", "philadelphia"] };

    expect(applyMergePatch(org, { tags: ["health"] })).toEqual({ tags: ["health"] });
  });

  it("adds fields the target does not have yet", () => {
    expect(applyMergePatch({ name: "Riverside" }, { mission: "Expanding access" })).toEqual({
      name: "Riverside",
      mission: "Expanding access",
    });
  });

  it("ignores a null for a field that was already absent", () => {
    expect(applyMergePatch({ name: "Riverside" }, { mission: null })).toEqual({
      name: "Riverside",
    });
  });

  it("replaces a scalar target with the patch object", () => {
    expect(applyMergePatch("Riverside", { name: "Riverside" })).toEqual({ name: "Riverside" });
  });

  it("leaves a field alone when the key is present but undefined", () => {
    const patch = { mission: undefined } as unknown as Record<string, never>;

    expect(applyMergePatch({ mission: "Expanding access" }, patch)).toEqual({
      mission: "Expanding access",
    });
  });
});
