import { describe, expect, it } from "vitest";
import type { FieldChange, SourceConfig } from "../types.js";
import { DEMO_FIELDS } from "./compare.js";
import { blockedChanges, topLevelKey } from "./writability.js";

describe("topLevelKey", () => {
  it("returns a single-segment path unchanged", () => {
    expect(topLevelKey("name")).toBe("name");
  });

  it("returns the first segment of a dotted path", () => {
    expect(topLevelKey("socials.website")).toBe("socials");
  });

  it("keeps a colon-bearing segment whole rather than splitting on it", () => {
    expect(topLevelKey("identifiers.org:us:ein.id")).toBe("identifiers");
  });
});

describe("blockedChanges", () => {
  const funderhub: Pick<SourceConfig, "unwritableFields"> = {
    unwritableFields: ["socials", "yearFounded", "orgType"],
  };

  const changesForAllDemoFields: FieldChange[] = DEMO_FIELDS.map((field) => ({
    path: field.path,
    value: "some value",
  }));

  it("returns only the changes whose top-level key is unwritable", () => {
    const result = blockedChanges(changesForAllDemoFields, funderhub);

    expect(result.map((change) => change.path)).toEqual(["socials.website"]);
  });

  it("returns the FieldChange objects themselves, path and value intact", () => {
    const websiteChange: FieldChange = { path: "socials.website", value: "riversidechc.org" };

    const result = blockedChanges([websiteChange], funderhub);

    expect(result).toEqual([websiteChange]);
    expect(result[0]).toBe(websiteChange);
  });

  it("blocks nothing for a source with no unwritableFields at all", () => {
    const result = blockedChanges(changesForAllDemoFields, {});

    expect(result).toEqual([]);
  });

  it("returns an empty array for an empty list of changes", () => {
    expect(blockedChanges([], funderhub)).toEqual([]);
  });
});
