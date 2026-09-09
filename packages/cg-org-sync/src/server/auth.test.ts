import { describe, expect, it } from "vitest";
import { requireBearer } from "./auth.js";

const EXPECTED_TOKEN = "portal-secret";

/** A request carrying `header` as its `Authorization`, or none when omitted. */
const request = (header?: string) =>
  new Request("https://portal.test/common-grants/orgs", {
    headers: header === undefined ? {} : { Authorization: header },
  });

describe("requireBearer", () => {
  it("rejects a request missing the Authorization header and passes a matching one", async () => {
    const rejected = requireBearer(request(), EXPECTED_TOKEN);
    const body = await rejected?.json();

    expect(rejected?.status).toBe(401);
    expect(body).toMatchObject({ status: 401 });
    expect(requireBearer(request(`Bearer ${EXPECTED_TOKEN}`), EXPECTED_TOKEN)).toBeUndefined();
  });

  const refused: ReadonlyArray<readonly [string, string]> = [
    ["an empty header", ""],
    ["a scheme that is not Bearer", `Basic ${EXPECTED_TOKEN}`],
    ["a token that does not match", "Bearer some-other-token"],
    ["a token with the scheme but no value", "Bearer"],
  ];

  it.each(refused)("rejects %s", (_label, header) => {
    expect(requireBearer(request(header), EXPECTED_TOKEN)?.status).toBe(401);
  });

  it("accepts the scheme in any case, which RFC 7235 says is case-insensitive", () => {
    expect(requireBearer(request(`bearer ${EXPECTED_TOKEN}`), EXPECTED_TOKEN)).toBeUndefined();
  });

  it("fails closed when the system itself has no token configured", () => {
    expect(requireBearer(request(`Bearer ${EXPECTED_TOKEN}`), undefined)?.status).toBe(401);
  });
});
