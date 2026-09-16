/**
 * Temelio's own API, as this adapter calls it.
 *
 * Three operations, which is all the CommonGrants org routes need: find a
 * grantee by EIN, read one, merge-write one. Everything Temelio-specific — the
 * URLs, the credential, the error shapes — stops here, so `store.ts` above it
 * deals only in records and `mapping.ts` beside it only in fields.
 *
 * The credential is a foundation API key sent as `X-API-Key`. Not a bearer
 * token: Temelio's API rejects the key in an `Authorization` header, and the
 * session token that *is* a bearer expires after sixty seconds, so it is not
 * something a server can hold.
 */

import {
  TemelioErrorSchema,
  TemelioRecordSchema,
  TemelioSearchPageSchema,
  type TemelioRecord,
  type TemelioSummary,
} from "./records.js";
import type { TemelioMetadataPatch } from "./mapping.js";

/** Anything that went wrong talking to Temelio. */
export class TemelioApiError extends Error {
  /** The status Temelio answered with; `undefined` if it never answered. */
  readonly status: number | undefined;

  constructor(message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = "TemelioApiError";
    this.status = options.status;
  }
}

/**
 * What the adapter needs from Temelio.
 *
 * An interface rather than the class alone so the offline fixture can stand in
 * for it exactly — which is what lets `pnpm e2e` and a fresh checkout run with
 * no vendor credential at all.
 */
export interface TemelioApi {
  /** The foundation's grantees carrying this EIN, in Temelio's own order. */
  searchByEin(ein: string): Promise<TemelioSummary[]>;

  /** One grantee's profile, or `undefined` when this foundation cannot see it. */
  read(nonprofitId: string): Promise<TemelioRecord | undefined>;

  /** Merge the named keys into one grantee's profile. */
  write(nonprofitId: string, patch: TemelioMetadataPatch): Promise<void>;
}

export interface TemelioHttpApiOptions {
  /** Temelio's API origin, with no trailing slash and no `/api`. */
  origin: string;

  /** The foundation this adapter acts as. Every route it can reach is under one. */
  foundationId: string;

  /** The foundation API key, sent as `X-API-Key`. */
  apiKey: string;

  /**
   * The only grantees this adapter may write to.
   *
   * Temelio's API is a live system shared with real foundations and real
   * nonprofits. A demo with a bug in it must not be able to edit a record
   * belonging to somebody else, so the guard sits here — below every route,
   * script and test — rather than in the code that happens to call this.
   */
  allowlist: readonly string[];

  /** Injectable so tests exercise the real request rather than the global. */
  fetch?: typeof globalThis.fetch;
}

export class TemelioHttpApi implements TemelioApi {
  readonly #origin: string;
  readonly #foundationId: string;
  readonly #apiKey: string;
  readonly #allowlist: ReadonlySet<string>;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: TemelioHttpApiOptions) {
    this.#origin = options.origin.replace(/\/+$/, "");
    this.#foundationId = options.foundationId;
    this.#apiKey = options.apiKey;
    this.#allowlist = new Set(options.allowlist);
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async searchByEin(ein: string): Promise<TemelioSummary[]> {
    // Pages are one-based here; asking for page zero is a 400. The filter
    // shape is Temelio's typed search: `ein` is one of three string fields it
    // will match on, and it stores EINs as nine digits with no hyphen.
    const response = await this.#send(`/api/foundations/${this.#foundationId}/nonprofits/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        page: 1,
        pageSize: 25,
        filters: [{ fieldType: "STRING", field: "ein", operator: "EQ", value: ein }],
      }),
    });

    if (!response.ok) {
      throw await this.#refusal(response);
    }

    const parsed = TemelioSearchPageSchema.safeParse(await this.#body(response));

    if (!parsed.success) {
      throw new TemelioApiError("Temelio did not return a page of grantees.", {
        status: response.status,
        cause: parsed.error,
      });
    }

    return parsed.data.data;
  }

  async read(nonprofitId: string): Promise<TemelioRecord | undefined> {
    const response = await this.#send(this.#recordPath(nonprofitId), { method: "GET" });

    // Not an error: this foundation has no relationship with that grantee, so
    // there is no record of them *here*. Temelio spells it 404 to an API key
    // and 403 to a session token. Either way the honest answer upward is "no
    // record", which is a different thing to tell someone than "Temelio is
    // down" — one is a fact about their data and the other about ours.
    if (response.status === 404 || response.status === 403) {
      return undefined;
    }

    if (!response.ok) {
      throw await this.#refusal(response);
    }

    const parsed = TemelioRecordSchema.safeParse(await this.#body(response));

    if (!parsed.success) {
      throw new TemelioApiError(`Temelio did not return a profile for ${nonprofitId}.`, {
        status: response.status,
        cause: parsed.error,
      });
    }

    return parsed.data;
  }

  async write(nonprofitId: string, patch: TemelioMetadataPatch): Promise<void> {
    if (!this.#allowlist.has(nonprofitId)) {
      throw new TemelioApiError(
        `${nonprofitId} is not in this adapter's Temelio allowlist, so it will not be written to.`,
      );
    }

    // `nonprofitId` goes in the body as well as the path. Temelio answers 400
    // without it, which is easy to mistake for a bad patch.
    const response = await this.#send(this.#recordPath(nonprofitId), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nonprofitId, ...patch }),
    });

    if (!response.ok) {
      throw await this.#refusal(response);
    }

    // Nothing to parse: a successful merge answers 200 with an empty body,
    // which is why every write here is followed by a re-read upstream.
  }

  /**
   * Where one grantee's profile lives.
   *
   * Singular `foundation` — the search route below spells it plural. That is
   * Temelio's inconsistency, not a typo here.
   */
  #recordPath(nonprofitId: string): string {
    return `/api/foundation/${this.#foundationId}/nonprofit/${nonprofitId}/metadata`;
  }

  /** Send a request carrying the API key, or fail as a `TemelioApiError`. */
  async #send(path: string, init: RequestInit): Promise<Response> {
    try {
      const response = await this.#fetch(`${this.#origin}${path}`, {
        ...init,
        headers: { ...init.headers, "x-api-key": this.#apiKey },
      });

      if (!(response instanceof Response)) {
        throw new TypeError("The transport did not resolve a Response.");
      }

      return response;
    } catch (cause) {
      throw new TemelioApiError(`Could not reach Temelio at ${this.#origin}.`, { cause });
    }
  }

  /** A response body as JSON, or `undefined` when there is none to read. */
  async #body(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      return undefined;
    }
  }

  /**
   * Turn a refusal into an error worth reading.
   *
   * Temelio answers most failures with an envelope carrying a `message`, and
   * one — a request stopped before it reaches the controller — with a bare
   * framework body that has only `error`. A client that read `message` alone
   * would report `undefined` for exactly the failure hardest to diagnose.
   */
  async #refusal(response: Response): Promise<TemelioApiError> {
    const parsed = TemelioErrorSchema.safeParse(await this.#body(response));
    const envelope = parsed.success ? parsed.data : undefined;
    const message =
      envelope?.message ??
      (envelope?.error
        ? `Temelio refused the request: ${envelope.error}.`
        : `Temelio answered ${response.status}.`);

    return new TemelioApiError(message, { status: response.status });
  }
}
