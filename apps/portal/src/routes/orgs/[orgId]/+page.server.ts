import { error, fail } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { applyOrgPatch } from "@cg-link/org-sync/server";
import { OrgPatchDataSchema } from "@cg-link/org-sync/schemas";
import { EIN_REGISTRY, buildMergePatch, parseOrigin, topLevelKey } from "@cg-link/org-sync/utils";
import type { JsonObject, JsonValue } from "@cg-link/org-sync/types";
import { SYSTEM_ID, store, unscopedRoutes } from "$lib/server/store.js";
import type { Actions, PageServerLoad } from "./$types.js";

/** The parts of the primary address the form offers, in display order. */
const ADDRESS_PARTS = [
  "street1",
  "street2",
  "city",
  "stateOrProvince",
  "country",
  "postalCode",
] as const;

/** Every path the form can set, by the name of the input that carries it. */
const EDITABLE_PATHS = {
  name: "name",
  ein: "identifiers.org:us:ein.id",
  website: "socials.website",
  mission: "mission",
  email: "emails.primary",
  phone: "phones.primary.number",
  address: "addresses.primary",
} as const;

type FormField = keyof typeof EDITABLE_PATHS;

/**
 * Which boxes this system's form offers.
 *
 * Read off this system's own `unwritableFields` rather than hardcoded, which
 * is what lets the two apps hold the identical copy of this file: FunderHub
 * declines `socials` and its page has no website field, GrantPortal declines
 * nothing and its page has them all. A patch it declined would be accepted and
 * dropped rather than refused, so leaving the input out is not about avoiding
 * an error — it is about not offering someone a box whose contents go nowhere.
 *
 * Derived over every field rather than asked about one of them, because the
 * form and the patch below both read it: a box this page offers is a value it
 * sends, and a rule applied to only some fields is one that silently stops
 * holding the day a system declines a different field.
 */
const unwritable = new Set(unscopedRoutes.unwritableFields ?? []);

const edits = Object.fromEntries(
  Object.entries(EDITABLE_PATHS).map(([field, path]) => [
    field,
    !unwritable.has(topLevelKey(path)),
  ]),
) as Record<FormField, boolean>;

/**
 * This system's copy of one profile.
 *
 * Deliberately outside the bearer guard, which covers `/common-grants/*` only:
 * this is the system's own screen, and auth on it is out of scope for the demo.
 */
export const load: PageServerLoad = async ({ params }) => {
  const org = await store.read(params.orgId);

  if (!org) {
    error(404, `No organization with id ${params.orgId}.`);
  }

  return {
    org,
    edits,

    /** This system's id, which the widget is told so it can name its host. */
    system: SYSTEM_ID,

    /** The EIN the widget looks this org up by — ids are assigned per system. */
    registry: EIN_REGISTRY,
    ein: org.identifiers?.[EIN_REGISTRY]?.id ?? null,

    /**
     * Where Link is served from, or `null` if this system has no Link.
     *
     * The same `LINK_ORIGIN` this system already uses as the one origin it
     * will send an authorization code to. One variable rather than two: a
     * deployment whose Link lives somewhere else would have to be wrong in
     * both places at once to embed one Link and trust another.
     *
     * Normalized through `parseOrigin`, so the page has either something the
     * loader can use or no Open Link button at all, rather than a malformed
     * value it throws on.
     */
    linkOrigin: parseOrigin(env.LINK_ORIGIN) ?? null,
  };
};

export const actions: Actions = {
  /**
   * Save the fields this page offers as one merge patch.
   *
   * The only real work here is turning inputs into a patch; every rule about
   * what a change may do lives in `applyOrgPatch`, which is the same function
   * `PATCH /common-grants/orgs/{orgId}` goes through. An edit made here and an
   * edit pushed by the widget are then the same edit, validated the same way,
   * rather than two code paths that happen to agree today.
   */
  default: async ({ params, request }) => {
    const data = await request.formData();

    // One call over every change, so `buildMergePatch` does the merging: two
    // paths sharing a root end up in one object rather than overwriting each
    // other, and overlapping paths throw instead of resolving by order. These
    // all have distinct roots, but that is no longer this form's problem to
    // keep true.
    const body: JsonObject = buildMergePatch(
      offeredFields().map((field) => ({
        path: EDITABLE_PATHS[field],
        value: valueOf(field, data),
      })),
    );

    const parsed = OrgPatchDataSchema.safeParse(body);

    // Rejected before the store is touched, and reported field by field: the
    // likely mistake here is a typo in a value, and "the change is not valid"
    // on its own gives whoever typed it nothing to fix.
    if (!parsed.success) {
      const reasons = parsed.error.issues
        .map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`)
        .join("; ");

      return fail(400, { ok: false, message: `This change is not valid. ${reasons}` });
    }

    const outcome = await applyOrgPatch(params.orgId, parsed.data as JsonObject, unscopedRoutes);

    // The system's own sentence either way, passed through untouched — it is
    // where a system says a change landed, or which fields it declined.
    return outcome.ok
      ? { ok: true, message: outcome.message }
      : fail(outcome.status, { ok: false, message: outcome.message });
  },
};

/**
 * One posted input as a patch value: the text, or `null` when it was blank.
 *
 * `null` rather than an omitted key or `""`. RFC 7396 spells clearing a field
 * as `null`, and the comparison counts an empty string as nothing held — so a
 * box someone emptied has to either clear the value or be refused, and which
 * of those it is belongs to the schema rather than to this form. Emptying the
 * website clears it; emptying the legal name is refused.
 */
function posted(value: FormDataEntryValue | null): JsonValue {
  const text = typeof value === "string" ? value.trim() : "";

  return text === "" ? null : text;
}

/** The fields this system will store, in the order they are declared above. */
function offeredFields(): FormField[] {
  return (Object.keys(EDITABLE_PATHS) as FormField[]).filter((field) => edits[field]);
}

/**
 * One offered field as its patch value.
 *
 * The address is the one field built from several inputs; every other box is a
 * single value. The phone posts the number alone, not the whole
 * `phones.primary` — a merge patch keeps the siblings it does not name, so the
 * country code this system already holds survives an edit to the number, which
 * is also why the compared path is that leaf rather than the object around it.
 */
function valueOf(field: FormField, data: FormData): JsonValue {
  return field === "address" ? addressFrom(data) : posted(data.get(field));
}

/**
 * The address inputs as one value for `addresses.primary`.
 *
 * Only the parts the form shows, so the merge leaves anything else this system
 * holds on the address — coordinates, say — where it is.
 */
function addressFrom(data: FormData): JsonObject {
  return Object.fromEntries(ADDRESS_PARTS.map((part) => [part, posted(data.get(part))]));
}
