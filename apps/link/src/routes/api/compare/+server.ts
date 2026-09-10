import { compareAcrossSources } from "@cg-link/org-sync/client";
import { json } from "@sveltejs/kit";
import { z } from "zod";
import { SOURCES, tokenProvider } from "$lib/server/sources.js";
import type { RequestHandler } from "./$types.js";

/** `?registry=org:us:ein&id=123456789` — the identifier the widget starts from. */
const QuerySchema = z.object({
  registry: z.string().min(1),
  id: z.string().min(1),
});

/**
 * `GET /api/compare` — read every source's copy of one org and diff them.
 *
 * Thin on purpose: parse the query, hand off to `compareAcrossSources`, return
 * what it built. A source that is down or unauthorized is reported inside a 200
 * rather than failing the request, because the answer "here is what the systems
 * that did answer hold, and here is who did not" is the useful one.
 */
export const GET: RequestHandler = async ({ url }) => {
  const parsed = QuerySchema.safeParse({
    registry: url.searchParams.get("registry"),
    id: url.searchParams.get("id"),
  });

  if (!parsed.success) {
    return json(
      {
        message: "A comparison needs a registry and an id to look the org up by.",
        errors: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  const result = await compareAcrossSources(parsed.data.registry, parsed.data.id, {
    sources: SOURCES,
    tokens: tokenProvider(),
  });

  return json(result);
};
