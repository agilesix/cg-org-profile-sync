/**
 * The shapes Link's own API answers with.
 *
 * Re-exported from `@cg-link/org-sync/types` rather than redefined, so the
 * widget page, the routes, and the Playwright specs all name one type. Kept as
 * a module in `$lib` (not `$lib/server`) because the browser half imports it
 * too; everything here is type-only and erases at build time.
 *
 * Import path for the e2e suite (#1153-T6): `@cg-link/link/api-types` is not
 * exported, so specs should import from `@cg-link/org-sync/types` directly —
 * these are the same declarations.
 */

export type {
  CompareResult,
  FieldComparison,
  JsonValue,
  SourceResolution,
  SyncResult,
  SyncTargetResult,
} from "@cg-link/org-sync/types";

export type { SyncChange } from "@cg-link/org-sync/client";

/** What both routes answer with when they reject a request. */
export interface ApiError {
  /** A sentence naming what was wrong with the request. */
  message: string;

  /** The Zod issues behind it, so a caller can point at the offending field. */
  errors: unknown[];
}
