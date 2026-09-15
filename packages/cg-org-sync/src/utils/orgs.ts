import type { Organization } from "../schemas/index.js";
import type { OrgSummary, SelectableOrg } from "../types.js";
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

/**
 * The organization someone has already linked, as the lock on later systems.
 *
 * Carries the name as well as the EIN because a system may publish an
 * organization it has no EIN for, and the lock still has to mean something
 * when it does.
 */
export interface OrgLock {
  /** Its EIN, or `null` when the system holding it publishes none. */
  ein: string | null;

  /** Its name, which is the fallback when there is no EIN to match on. */
  name: string;
}

/** What the picker says about a row that is not the linked organization. */
export const DIFFERENT_ORG_REASON = "Different organization";

/**
 * Mark which of a system's organizations may be chosen, given what is linked.
 *
 * A person links one organization at a time, so the second system may only
 * offer the same one. That rule lives here rather than in the modal for the
 * usual reason — `apps/*` has no test harness — and because it is the rule
 * that decides which record a later `PATCH` lands on. Getting it wrong writes
 * one organization's address onto another, which is the failure this whole
 * demo is supposed to be about preventing.
 *
 * **Rows are marked, never dropped.** Order and length always survive. Someone
 * has to be able to see the organization they cannot pick — a list that
 * quietly omitted it would be lying about what the system holds, and would
 * leave them hunting for a row that was filtered away.
 *
 * Matching prefers the EIN, because that is the identifier that means the same
 * thing at two systems. Only when the linked organization has none does it
 * fall back to the name, compared case-insensitively — weaker, and the caller
 * is expected to say so on screen rather than let it pass as an EIN match.
 */
export function selectableOrgs(orgs: readonly OrgSummary[], lock: OrgLock | null): SelectableOrg[] {
  if (lock === null) {
    return orgs.map((org) => ({ ...org, selectable: true }));
  }

  return orgs.map((org) => {
    const selectable =
      lock.ein !== null
        ? // A row with no EIN cannot be shown to be the same organization, so
          // it is refused rather than guessed at.
          org.ein === lock.ein
        : org.name.toLowerCase() === lock.name.toLowerCase();

    return selectable
      ? { ...org, selectable }
      : { ...org, selectable, reason: DIFFERENT_ORG_REASON };
  });
}
