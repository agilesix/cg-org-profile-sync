import { describe, expect, it } from "vitest";
import type { SourceCapabilities, SourceConfig } from "../types.js";
import { capabilitiesOf, isConnectable } from "./sources.js";

const PORTAL_SOURCE: SourceConfig = {
  id: "portal",
  label: "GrantPortal",
  baseUrl: "https://portal.example.com",
};

describe("capabilitiesOf", () => {
  it("reads as both read and write when a source declares no capabilities", () => {
    expect(capabilitiesOf(PORTAL_SOURCE)).toEqual({ read: true, write: true });
  });

  it("returns an explicit read-and-write declaration unchanged", () => {
    const source: SourceConfig = { ...PORTAL_SOURCE, capabilities: { read: true, write: true } };

    expect(capabilitiesOf(source)).toEqual({ read: true, write: true });
  });

  it("keeps write: false on a read-only source rather than defaulting it back to true", () => {
    const source: SourceConfig = { ...PORTAL_SOURCE, capabilities: { read: true, write: false } };

    expect(capabilitiesOf(source)).toEqual({ read: true, write: false });
  });

  it("keeps read: false on a write-only source rather than defaulting it back to true", () => {
    const source: SourceConfig = { ...PORTAL_SOURCE, capabilities: { read: false, write: true } };

    expect(capabilitiesOf(source)).toEqual({ read: false, write: true });
  });

  it("returns a source that allows nothing as declared, not as a mistake to correct", () => {
    const source: SourceConfig = { ...PORTAL_SOURCE, capabilities: { read: false, write: false } };

    expect(capabilitiesOf(source)).toEqual({ read: false, write: false });
  });

  it("returns a fresh object, not the caller's own capabilities object", () => {
    const capabilities: SourceCapabilities = { read: true, write: false };
    const source: SourceConfig = { ...PORTAL_SOURCE, capabilities };

    const result = capabilitiesOf(source);
    result.write = true;

    expect(source.capabilities).toEqual({ read: true, write: false });
  });
});

describe("isConnectable", () => {
  it("is connectable when a source declares neither status nor enabled", () => {
    expect(isConnectable(PORTAL_SOURCE)).toBe(true);
  });

  it("is connectable when status is explicitly available", () => {
    const source: SourceConfig = { ...PORTAL_SOURCE, status: "available" };

    expect(isConnectable(source)).toBe(true);
  });

  it("is not connectable when status is coming-soon", () => {
    const source: SourceConfig = { ...PORTAL_SOURCE, status: "coming-soon" };

    expect(isConnectable(source)).toBe(false);
  });

  it("is not connectable when enabled is false, even with status available", () => {
    const source: SourceConfig = { ...PORTAL_SOURCE, status: "available", enabled: false };

    expect(isConnectable(source)).toBe(false);
  });

  it("is not connectable when status is coming-soon, even with enabled true", () => {
    const source: SourceConfig = { ...PORTAL_SOURCE, status: "coming-soon", enabled: true };

    expect(isConnectable(source)).toBe(false);
  });
});
