import { isDemoFieldPath, syncToTargets, tokensFromHeader } from "@cg-link/org-sync/client";
import type { JsonValue } from "@cg-link/org-sync/types";
import { buildMergePatch } from "@cg-link/org-sync/utils";
import { json } from "@sveltejs/kit";
import { z } from "zod";
import { SOURCES } from "$lib/server/sources.js";
import type { RequestHandler } from "./$types.js";

/**
 * Anything that survives `JSON.parse`, which is exactly a `JsonValue`.
 *
 * Spelled out rather than left as `z.unknown()` so a body carrying something
 * JSON cannot represent is a 400 here instead of a confusing rejection from the
 * far system.
 */
const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

const ChangeSchema = z.object({
  // Only the fields the demo compares can be synced. Anything else is a
  // request to write a field nothing in the UI can have produced.
  path: z.string().refine(isDemoFieldPath, {
    message: "That field is not one of the fields this demo compares.",
  }),

  // Present but `null` is meaningful and must not be confused with absent:
  // `null` is how RFC 7396 spells clearing a field.
  value: JsonValueSchema,
});

const BodySchema = z.object({
  registry: z.string().min(1),
  id: z.string().min(1),

  /*
   * The fields to set, folded into one patch per target.
   *
   * The overlap rule is `buildMergePatch`'s rather than a second copy of it
   * here: a body carrying `socials` and `socials.website` means two different
   * things depending on which is applied last, and the library already refuses
   * to guess. Running it during validation is what turns that refusal into a
   * 400 with the library's own sentence, instead of a rejected promise from
   * `syncToTargets` that would surface as a 500.
   */
  changes: z
    .array(ChangeSchema)
    .min(1)
    .superRefine((changes, ctx) => {
      try {
        buildMergePatch(changes);
      } catch (cause) {
        ctx.addIssue({
          code: "custom",
          message: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }),

  targets: z.array(z.string().min(1)).min(1),
});

/**
 * `POST /api/sync` — push the chosen values to the systems the person picked.
 *
 * Thin on purpose, the same as `/api/compare`. Per-target outcomes come back
 * inside a 200: some systems storing a change and others declining it is the
 * normal case here, not an error, and each target's own message is the only
 * place it says which parts of the change it kept.
 */
export const POST: RequestHandler = async ({ request }) => {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return json({ message: "The request body is not valid JSON.", errors: [] }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);

  if (!parsed.success) {
    return json(
      {
        message: "The request body does not describe a change this demo can make.",
        errors: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  const result = await syncToTargets(parsed.data, {
    sources: SOURCES,
    tokens: tokensFromHeader(request),
  });

  return json(result);
};
