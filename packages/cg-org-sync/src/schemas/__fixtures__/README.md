# Fixtures

`protocol-orgs.json` is the organization fixture set from the CommonGrants
protocol repo (`website/src/lib/mock/data/organizations.ts`), copied verbatim.

It exists so the Zod schemas can be checked against records the protocol itself
publishes rather than against examples written to match them. Refresh it from
the protocol repo when the spec moves.

The records still carry the top-level `ein`, `uei` and `duns` fields the spec
removed in v0.4.0 in favour of `identifiers`. The schemas ignore unknown keys on
reads, so those pass through without complaint — which is the behaviour we want
from a receiver reading an older sender's payload.
