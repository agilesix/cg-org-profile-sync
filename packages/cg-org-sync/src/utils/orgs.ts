import type { Organization } from "../schemas/index.js";
import type { OrgSummary } from "../types.js";
import { EIN_REGISTRY } from "./compare.js";

/**
 * Reduce a profile to the line the organization picker shows for it.
 *
 * The picker is a list of names to choose between, not a comparison, so it
 * wants the two things that tell one organization from another: its name, and
 * the EIN the widget will go on to match it by across systems. Everything else
 * in a profile is noise at that moment.
 *
 * Lives here rather than in the modal because `apps/*` has no test harness,
 * and because the EIN is read out of a registry-keyed map — the one part of
 * this that can silently return `undefined` and needs pinning.
 */
export function summarizeOrg(org: Organization): OrgSummary {
  return {
    id: org.id,
    name: org.name,

    // `null`, never a dropped record. A system may publish an organization it
    // has no EIN for, and leaving it out of the list would give someone no way
    // to pick the org they actually came to link — worse than showing it with
    // nothing to match on, which the picker can at least say out loud.
    //
    // Only `org:us:ein` is read. An organization commonly carries a system id
    // and a UEI alongside it, and neither means the same thing at two systems.
    ein: org.identifiers?.[EIN_REGISTRY]?.id ?? null,
  };
}
