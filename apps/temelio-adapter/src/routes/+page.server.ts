import { DEMO_FIELDS, formatFieldValue, getAtPath } from "@cg-link/org-sync/utils";
import { servedOrgIds, servedProfiles, temelioMode, vendorAppUrl } from "$lib/server/store.js";
import type { PageServerLoad } from "./$types.js";

/**
 * What this adapter is in front of, and what it currently holds.
 *
 * The mode is here as well as in the start-up log because the log scrolls away
 * and the person who needs it most is a presenter checking, a minute before a
 * demo, that the thing about to be shown is the real integration and not the
 * stand-in.
 *
 * In fixture mode the profiles are listed in full and re-read on every load,
 * so the last step of the demo has somewhere to look: this is where a push
 * shows up. Every value there is invented demo data.
 *
 * In sandbox mode the page says how many grantees this adapter serves and
 * nothing else — no names, no record ids, no link carrying either. Those are
 * somebody's real records, and this route is not behind the bearer guard,
 * which covers `/common-grants/` alone. Anyone who needs to see a grantee can
 * open Temelio, which is a click away and asks them who they are first.
 */
export const load: PageServerLoad = async () => {
  const mode = temelioMode();

  // Sandbox mode asks the vendor nothing. The count is the allowlist's length,
  // which is configuration — so this page neither costs a vendor round trip on
  // every load nor fails when the vendor is unreachable, which is exactly when
  // somebody is most likely to be looking at it.
  if (mode === "sandbox") {
    return { mode, count: servedOrgIds().length, vendorAppUrl: vendorAppUrl(), orgs: [] };
  }

  const profiles = await servedProfiles();

  return {
    mode,
    count: profiles.length,
    vendorAppUrl: undefined,
    orgs: profiles.map((org) => ({
      id: org.id,
      name: org.name,
      fields: DEMO_FIELDS.map((field) => ({
        label: field.label,
        value: formatFieldValue(getAtPath(org, field.path)),
      })),
    })),
  };
};
