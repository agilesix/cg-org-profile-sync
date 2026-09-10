/**
 * The read/write client the widget speaks to one source through.
 *
 * Every system in the demo exposes the identical CommonGrants org routes, so
 * this client is constructed from a `SourceConfig` rather than written per
 * system — adding a third source is a registry entry, not another client.
 *
 * Everything that can go wrong on the way to or from a source surfaces as an
 * `OrgClientError` carrying that source's id. The widget fans out across
 * several systems at once, so an error that cannot say which one it came from
 * is an error it cannot render.
 */

import {
  OrgRevisionSchema,
  OrganizationBaseSchema,
  type Organization,
  type OrgRevision,
} from "../schemas/index.js";
import type { JsonObject, SourceConfig, TokenProvider } from "../types.js";
import { isJsonObject } from "../utils/json.js";
import { MERGE_PATCH_CONTENT_TYPE } from "../utils/merge-patch.js";

/** Anything that went wrong talking to one source, tagged with which source. */
export class OrgClientError extends Error {
  /** The `SourceConfig.id` of the system this failed against. */
  readonly sourceId: string;

  /** The HTTP status the source responded with; `undefined` if it never responded. */
  readonly status: number | undefined;

  /** The error envelope's `errors`, or the schema issues that rejected a response. */
  readonly errors: readonly unknown[];

  constructor(
    sourceId: string,
    message: string,
    options: { status?: number; errors?: readonly unknown[]; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "OrgClientError";
    this.sourceId = sourceId;
    this.status = options.status;
    this.errors = options.errors ?? [];
  }
}

export interface OrgClientOptions {
  /** The system to talk to. */
  source: SourceConfig;

  /** Supplies that system's access token; each system issues its own. */
  tokens: TokenProvider;

  /** Injectable so tests can stub the transport. Defaults to global `fetch`. */
  fetch?: typeof globalThis.fetch;
}

/** Resolves a token per source from a static map. What Link uses for the demo. */
export class StaticTokenProvider implements TokenProvider {
  readonly #tokens: Readonly<Record<string, string>>;

  constructor(tokens: Readonly<Record<string, string>>) {
    this.#tokens = { ...tokens };
  }

  async tokenFor(sourceId: string): Promise<string> {
    const token = this.#tokens[sourceId];

    if (token === undefined) {
      throw new OrgClientError(sourceId, `No access token is configured for ${sourceId}.`);
    }

    return token;
  }
}

export class OrgClient {
  readonly #source: SourceConfig;
  readonly #tokens: TokenProvider;
  readonly #fetch: typeof globalThis.fetch;

  constructor({ source, tokens, fetch = globalThis.fetch }: OrgClientOptions) {
    this.#source = source;
    this.#tokens = tokens;
    this.#fetch = fetch;
  }

  /**
   * Look this source's copy of an org up by an identifier it publishes.
   *
   * The widget starts from an EIN rather than an id, because ids are assigned
   * per system and no two systems agree on them. More than one match means the
   * source holds duplicate records for the same registry id; the first wins,
   * which keeps the comparison readable rather than failing the whole fan-out.
   */
  async findByIdentifier(registry: string, id: string): Promise<Organization | undefined> {
    const url = this.#url("/common-grants/orgs");
    url.searchParams.set("registry", registry);
    url.searchParams.set("id", id);

    const { body, status } = await this.#request(url, { method: "GET" });
    const items = body["items"];

    // No `items` is a source that is not speaking the protocol, which is a very
    // different thing to tell someone than "this system has no record of you".
    if (!Array.isArray(items)) {
      throw this.#notConformant("a paginated list of organizations", status);
    }

    const first = items[0];

    return first === undefined ? undefined : this.#parseOrg(first, status);
  }

  /** Read this source's copy of an org by the id this source assigned it. */
  async read(orgId: string): Promise<Organization> {
    const { body, status } = await this.#request(this.#orgUrl(orgId), { method: "GET" });

    return this.#parseOrg(body["data"], status);
  }

  /**
   * Apply a JSON Merge Patch to this source's copy.
   *
   * The envelope's `message` comes back untouched because a system that cannot
   * store a field drops it and says so there rather than failing — the caller
   * needs that sentence to tell the person which parts of their change landed.
   */
  async patch(
    orgId: string,
    mergePatch: JsonObject,
  ): Promise<{ revision: OrgRevision; message: string }> {
    const { body, status } = await this.#request(this.#orgUrl(orgId), {
      method: "PATCH",
      headers: { "content-type": MERGE_PATCH_CONTENT_TYPE },
      body: JSON.stringify(mergePatch),
    });

    // The revision is parsed first: when a source gets both halves wrong, the
    // schema issues say more about what it is doing than a missing message does.
    const revision = this.#parseRevision(body["data"], status);
    const message = body["message"];

    if (typeof message !== "string") {
      throw this.#notConformant("a message describing the change", status);
    }

    return { revision, message };
  }

  /**
   * Send a request carrying this source's bearer token and read back its envelope.
   *
   * Reads are behind the same bearer guard as writes, so every call carries the
   * token rather than only the ones that change something.
   */
  async #request(url: URL, init: RequestInit): Promise<{ body: JsonObject; status: number }> {
    const token = await this.#token();

    let response: Response;

    try {
      const sent = await this.#fetch(url, {
        ...init,
        headers: { ...init.headers, authorization: `Bearer ${token}` },
      });

      // A transport that resolves something other than a `Response` is as
      // broken as one that rejects, and the caller should hear about it the
      // same way rather than through a `TypeError` from the next line.
      if (!(sent instanceof Response)) {
        throw new TypeError("The transport did not resolve a Response.");
      }

      response = sent;
    } catch (cause) {
      throw new OrgClientError(
        this.#source.id,
        `Could not reach ${this.#source.label} at ${this.#source.baseUrl}.`,
        { cause },
      );
    }

    const status = response.status;
    let body: unknown;

    try {
      body = await response.json();
    } catch (cause) {
      throw new OrgClientError(this.#source.id, `${this.#source.label} did not return JSON.`, {
        status,
        cause,
      });
    }

    if (!isJsonObject(body)) {
      throw this.#notConformant("a response envelope", status);
    }

    if (!response.ok) {
      throw new OrgClientError(
        this.#source.id,
        typeof body["message"] === "string"
          ? body["message"]
          : `${this.#source.label} rejected the request with ${status}.`,
        { status, errors: Array.isArray(body["errors"]) ? body["errors"] : [] },
      );
    }

    return { body, status };
  }

  /**
   * Parse the revision a `PATCH` reports the change as.
   *
   * `PATCH /common-grants/orgs/{orgId}` returns `Responses.OkT<OrgRevision>`,
   * so the revision gets the same treatment as an org: validated here rather
   * than trusted, since it carries the post-change `snapshot` the widget can
   * refresh from without a second read.
   */
  #parseRevision(value: unknown, status: number): OrgRevision {
    const parsed = OrgRevisionSchema.safeParse(value);

    if (!parsed.success) {
      throw new OrgClientError(
        this.#source.id,
        `${this.#source.label} did not return the applied change as a revision.`,
        { status, errors: parsed.error.issues },
      );
    }

    return parsed.data;
  }

  /**
   * Ask the provider for this source's token.
   *
   * `StaticTokenProvider` only ever fails one way, but a provider that mints a
   * token over the network can fail every way a request can — and the caller
   * still needs to hear "this source" rather than a bare transport error.
   */
  async #token(): Promise<string> {
    try {
      return await this.#tokens.tokenFor(this.#source.id);
    } catch (cause) {
      if (cause instanceof OrgClientError) {
        throw cause;
      }

      throw new OrgClientError(
        this.#source.id,
        `Could not get an access token for ${this.#source.label}.`,
        { cause },
      );
    }
  }

  /**
   * Parse a record off the wire.
   *
   * A source that publishes a shape the protocol does not describe fails here,
   * rather than leaking a half-built profile into the comparison grid where it
   * would read as a disagreement between systems.
   */
  #parseOrg(value: unknown, status: number): Organization {
    const parsed = OrganizationBaseSchema.safeParse(value);

    if (!parsed.success) {
      throw new OrgClientError(
        this.#source.id,
        `${this.#source.label} returned something that is not a CommonGrants organization.`,
        { status, errors: parsed.error.issues },
      );
    }

    return parsed.data;
  }

  #url(path: string): URL {
    return new URL(path, this.#source.baseUrl);
  }

  #orgUrl(orgId: string): URL {
    return this.#url(`/common-grants/orgs/${encodeURIComponent(orgId)}`);
  }

  #notConformant(expected: string, status: number): OrgClientError {
    return new OrgClientError(
      this.#source.id,
      `${this.#source.label} did not return ${expected}.`,
      { status },
    );
  }
}
