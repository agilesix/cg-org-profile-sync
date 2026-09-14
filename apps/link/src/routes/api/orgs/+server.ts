import { listOrgsAt, tokensFromHeader } from "@cg-link/org-sync/client";
import { json } from "@sveltejs/kit";
import { z } from "zod";
import { SOURCES } from "$lib/server/sources.js";
import type { RequestHandler } from "./$types.js";

/** `?source=portal` — which system to ask what this person may touch there. */
const QuerySchema = z.object({
  source: z.string().min(1),
});

/**
 * `GET /api/orgs` — the organizations one system says this person may touch.
 *
 * Thin on purpose, like `/api/compare` and `/api/sync`: parse the query, hand
 * off to `listOrgsAt`, return what it built. The modal's organization step is
 * the only caller, and it asks one system at a time — the person has just
 * signed into that one, and the others may not be connected at all.
 *
 * One source rather than a fan-out because this list is the system's own
 * answer about its own grants. Two systems' lists are not rows of one table;
 * they are two separate questions asked at two separate moments in the flow.
 *
 * Not connected answers 401 rather than an empty 200. An empty list and "we
 * never asked" look identical in a body and mean opposite things to the modal:
 * one is a person with no organizations here, the other is a person who has
 * not signed in yet and should be offered Connect.
 */
export const GET: RequestHandler = async ({ url, request }) => {
  const parsed = QuerySchema.safeParse({ source: url.searchParams.get("source") });

  if (!parsed.success) {
    return json(
      {
        message: "Listing organizations needs the id of the system to ask.",
        errors: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  const result = await listOrgsAt(parsed.data.source, {
    sources: SOURCES,
    tokens: tokensFromHeader(request),
  });

  // Every other outcome is a 200 carrying `connection` and a reason, the same
  // way `/api/compare` reports a source that is down inside a success: the
  // modal has something to say about each of them and no retry to offer.
  return json(result, { status: result.connection === "not-connected" ? 401 : 200 });
};
