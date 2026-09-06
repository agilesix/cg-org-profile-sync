import { z } from "zod";
import {
  OrgProfileWritableSchema,
  OrganizationBaseSchema,
  RecordTimestampsSchema,
  RevisionStatusSchema,
} from "./models.js";
import { UuidSchema } from "./types.js";

/**
 * Rewrite a schema into its JSON Merge Patch form (RFC 7396).
 *
 * Every property becomes optional and nullable, recursively: omit a field to
 * leave it alone, send `null` to clear it, send a value to set it. Record
 * values become nullable too, so a keyed entry can be deleted the same way.
 *
 * Derived rather than hand-written on purpose. The protocol's own TypeSpec
 * keeps a parallel set of hand-declared patch models and needs a test to stop
 * them drifting from the base models; deriving removes that hazard instead of
 * reproducing it.
 */
export function toMergePatch<T extends z.ZodObject>(schema: T): z.ZodObject {
  return z.strictObject(patchShape(schema));
}

/**
 * Zod's `.def` exposes members through its internal `$ZodType`, so walking a
 * schema means casting back to the public type at each hop.
 */
type Shape = Record<string, z.ZodType>;

function patchShape(schema: z.ZodObject): Shape {
  const shape: Shape = {};

  for (const [key, member] of Object.entries(schema.def.shape)) {
    shape[key] = patchMember(member as z.ZodType).nullish();
  }

  return shape;
}

/** Rewrite one property, recursing through objects and record values. */
function patchMember(member: z.ZodType): z.ZodType {
  const core = unwrap(member);

  if (core.def.type === "object") {
    return z.strictObject(patchShape(core as z.ZodObject));
  }

  if (core.def.type === "record") {
    const { keyType, valueType } = (core as z.ZodRecord).def;
    return z.record(keyType as z.ZodString, patchMember(valueType as z.ZodType).nullable());
  }

  // Arrays and scalars replace whole, so they patch as themselves.
  return core;
}

/**
 * Strip the optional, nullable and default wrappers a base schema may carry.
 *
 * The patch form reapplies its own, so carrying the originals through would
 * double them up and hide the shape underneath.
 */
function unwrap(schema: z.ZodType): z.ZodType {
  let current = schema;

  while (
    current.def.type === "optional" ||
    current.def.type === "nullable" ||
    current.def.type === "default" ||
    current.def.type === "prefault"
  ) {
    current = (current.def as unknown as { innerType: z.ZodType }).innerType;
  }

  return current;
}

/**
 * A merge patch body for an organization profile.
 *
 * Sent as `application/merge-patch+json`. Strict, so a misspelled field is a
 * 400 rather than a silent no-op.
 */
export const OrgPatchDataSchema = toMergePatch(OrgProfileWritableSchema);

/**
 * A single change to an organization profile.
 *
 * `patch` is what was submitted and `snapshot` is the profile with that change
 * applied, so a consumer sees both the delta and the result without a second
 * request.
 */
export const OrgRevisionSchema = RecordTimestampsSchema.extend({
  /** Globally unique id for the revision. */
  id: UuidSchema,

  status: RevisionStatusSchema,

  /** The system the change came from. */
  source: z.string().optional(),

  patch: OrgPatchDataSchema.optional(),
  snapshot: OrganizationBaseSchema.optional(),
});

export type OrgPatchData = z.infer<typeof OrgPatchDataSchema>;
export type OrgRevision = z.infer<typeof OrgRevisionSchema>;
