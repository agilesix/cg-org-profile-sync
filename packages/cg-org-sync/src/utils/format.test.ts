import { describe, expect, it } from "vitest";
import { formatFieldValue } from "./format.js";

describe("formatFieldValue", () => {
  it("passes a string through untouched", () => {
    expect(formatFieldValue("https://agile6.com")).toBe("https://agile6.com");
  });

  it("renders an address as one readable line", () => {
    const address = {
      street1: "600 B Street",
      street2: "Suite 300",
      city: "San Diego",
      stateOrProvince: "CA",
      country: "US",
      postalCode: "92101",
    };

    expect(formatFieldValue(address)).toBe("600 B Street, Suite 300, San Diego, CA, 92101");
  });

  it("drops the address parts a source did not fill in", () => {
    const address = { street1: "600 B Street", city: "San Diego", stateOrProvince: "CA" };

    expect(formatFieldValue(address)).toBe("600 B Street, San Diego, CA");
  });

  it("ignores the address parts nobody would read off an envelope", () => {
    const address = {
      street1: "600 B Street",
      city: "San Diego",
      stateOrProvince: "CA",
      postalCode: "92101",
      latitude: 32.71,
      longitude: -117.16,
    };

    expect(formatFieldValue(address)).not.toContain("32.71");
  });

  it("says nothing for a value there is nothing to say about", () => {
    // `null` is a legal value — RFC 7396 spells a deletion that way — so it
    // has to format rather than throw. Same for a field a source omitted.
    expect(formatFieldValue(null)).toBe("");
    expect(formatFieldValue(undefined)).toBe("");

    // An address whose every printable part is blank. Reachable, because
    // `AddressSchema.street1` is a plain `z.string()` with no minimum length.
    expect(formatFieldValue({ street1: "", city: "", stateOrProvince: "", postalCode: "" })).toBe(
      "",
    );
  });

  it("falls back to JSON for a shape it has no opinion about", () => {
    // Not an address — no `street1` — so it must still be legible rather than
    // rendering as an empty cell, which would read as "this source holds
    // nothing" when the source in fact holds something.
    expect(formatFieldValue({ countryCode: "+1", number: "619-555-0142" })).toBe(
      '{"countryCode":"+1","number":"619-555-0142"}',
    );
    expect(formatFieldValue(["a", "b"])).toBe('["a","b"]');
    expect(formatFieldValue(2015)).toBe("2015");
    expect(formatFieldValue(false)).toBe("false");
  });
});
