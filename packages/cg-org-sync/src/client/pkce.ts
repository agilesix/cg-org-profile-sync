import { base64url } from "jose";

/**
 * The client half of PKCE, for whoever is starting an authorization flow.
 *
 * Here rather than in Link because `apps/*` has no test harness and "the
 * challenge is the S256 hash of the verifier" is precisely the thing that
 * fails opaquely when it is wrong: the flow completes right up to the token
 * exchange and then refuses, with nothing on either side saying why.
 */

/** A verifier and the challenge derived from it. Only the challenge is sent. */
export interface PkcePair {
  /** The secret. Kept by the client until it redeems the code. */
  verifier: string;

  /** Its S256 hash, sent to the authorization server up front. */
  challenge: string;
}

/** 32 bytes, which RFC 7636 puts comfortably inside its 43–128 character range. */
const VERIFIER_BYTES = 32;

/** Generate a fresh verifier and its challenge. */
export async function createPkcePair(): Promise<PkcePair> {
  const verifier = base64url.encode(crypto.getRandomValues(new Uint8Array(VERIFIER_BYTES)));

  return { verifier, challenge: await challengeFor(verifier) };
}

/** The S256 challenge a verifier hashes to. */
export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));

  return base64url.encode(new Uint8Array(digest));
}
