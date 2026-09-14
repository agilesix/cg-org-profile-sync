import { describe, expect, it } from "vitest";
import { challengeFor, createPkcePair } from "./pkce.js";

describe("createPkcePair", () => {
  it("derives the challenge from the verifier it hands back", async () => {
    const { verifier, challenge } = await createPkcePair();

    expect(await challengeFor(verifier)).toBe(challenge);
  });

  it("generates a different verifier every time, since one is a single flow's secret", async () => {
    const [first, second] = [await createPkcePair(), await createPkcePair()];

    expect(second.verifier).not.toBe(first.verifier);
  });

  it("produces a verifier inside RFC 7636's 43-to-128 character range", async () => {
    const { verifier } = await createPkcePair();

    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
  });

  const unreserved = /^[A-Za-z0-9\-._~]+$/;

  it("uses only characters that survive a query string unescaped", async () => {
    const { verifier, challenge } = await createPkcePair();

    expect(verifier).toMatch(unreserved);
    expect(challenge).toMatch(unreserved);
  });
});

describe("challengeFor", () => {
  it("matches the worked example in RFC 7636 appendix B", async () => {
    // The spec's own vector, so this pins the hash against something outside
    // this repo rather than against itself. A challenge that disagreed with
    // the server's would fail only at the token exchange, with nothing on
    // either side saying which half was wrong.
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";

    expect(await challengeFor(verifier)).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});
