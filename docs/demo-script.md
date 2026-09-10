# Demo script and route walkthrough

Personal notes for running the demo by hand. The README is the overview; this is the click path,
the `curl` block, and what to say while it runs. Everything assumes `pnpm dev` is up with the three
`.env` files in place (see the README).

## The click path

About two minutes. Everything is at `http://localhost:5176`.

1. **Open Link.** The EIN field already holds the demo org (`123456789`) and the grid shows one
   column per system, GrantPortal and FunderHub, and one row per compared field. Three rows agree.
   The **Primary address** row is marked as differing: GrantPortal says Suite 300, FunderHub says
   Suite 210. The **Website** row shows a value under GrantPortal and nothing under FunderHub. That
   is a gap, not a conflict, so the row is not flagged.
2. **Fix the address.** Click GrantPortal's address to choose it. The panel echoes the pick, and
   FunderHub is pre-selected as the target (the system a value came from is never offered, since it
   already holds it). Click **Sync**. FunderHub answers "accepted", the grid re-reads both systems,
   and the address row now agrees on Suite 300.
3. **Push the website.** Click GrantPortal's website, then **Sync**. FunderHub still answers
   "accepted", but its message reads "This system does not store socials." The patch was applied,
   the field was dropped, and the sender was told so. The grid re-reads and the website row is
   unchanged: FunderHub still holds nothing.
4. **Optional: an org nobody knows.** Type `000000000` in the EIN field and click **Look up**. Each
   column reports that the system has no record of the org, the grid still renders, and the value
   picked for the previous org is dropped so it cannot be written onto the wrong organization.

Restart `pnpm dev`, or `POST /__test/reset` on FunderHub, to run it again from the seed.

Talking points, one per step:

- The widget knows nothing about how many systems there are. A third one is an entry in
  `apps/link/src/lib/server/sources.ts` and a token in Link's `.env`.
- Ids are assigned per system, so every operation starts from the EIN lookup. No two systems agree
  on ids and the contract does not ask them to.
- The write is a JSON Merge Patch that sets exactly one field. A system that cannot store the
  field accepts the patch, drops the field, and says so in its message. The sender learns the
  value went no further without the whole change failing.

## Poke the routes directly

The tokens are the placeholder values from the `.env.example` files. Ids are assigned per system,
so the EIN lookup is always the first call; the ids shown are the seeded ones.

```bash
PORTAL_TOKEN=portal-local-placeholder-change-me
FUNDERHUB_TOKEN=funderhub-local-placeholder-change-me

# Find the org by EIN on each system. Both hold it under a different id.
curl -s "http://localhost:5173/common-grants/orgs?registry=org:us:ein&id=123456789" \
  -H "Authorization: Bearer $PORTAL_TOKEN"
curl -s "http://localhost:5174/common-grants/orgs?registry=org:us:ein&id=123456789" \
  -H "Authorization: Bearer $FUNDERHUB_TOKEN"

# Read one profile. Portal says Suite 300; FunderHub says Suite 210.
curl -s http://localhost:5173/common-grants/orgs/018f2e77-1a2b-7c3d-8e4f-000000000001 \
  -H "Authorization: Bearer $PORTAL_TOKEN"
curl -s http://localhost:5174/common-grants/orgs/018f2e77-1a2b-7c3d-8e4f-000000000002 \
  -H "Authorization: Bearer $FUNDERHUB_TOKEN"

# Patch FunderHub's address. The body is a JSON Merge Patch (RFC 7396), so only
# the keys you send change, and the content type has to say so.
curl -s -X PATCH http://localhost:5174/common-grants/orgs/018f2e77-1a2b-7c3d-8e4f-000000000002 \
  -H "Authorization: Bearer $FUNDERHUB_TOKEN" \
  -H "Content-Type: application/merge-patch+json" \
  -d '{"addresses":{"primary":{"street2":"Suite 300"}}}'

# Push a field FunderHub does not store. Not an error: the change is accepted,
# the field is dropped, and the message names it.
#   "message": "Change applied. This system does not store socials."
curl -s -X PATCH http://localhost:5174/common-grants/orgs/018f2e77-1a2b-7c3d-8e4f-000000000002 \
  -H "Authorization: Bearer $FUNDERHUB_TOKEN" \
  -H "Content-Type: application/merge-patch+json" \
  -d '{"socials":{"website":"https://agile6.com"}}'
```

Every response is a CommonGrants envelope: `{ status, message, data }` for one record,
`{ status, message, items, paginationInfo }` for a list, `{ status, message, errors }` for a
failure. A `PATCH` returns an `OrgRevision` whose `snapshot` is the profile after the change.

Two things worth confirming while you are here:

```bash
# No token, or the other system's token: 401.
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5173/common-grants/orgs
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5173/common-grants/orgs \
  -H "Authorization: Bearer $FUNDERHUB_TOKEN"

# Put a system back to its seed. 204 with ENABLE_TEST_ROUTES=true, 404 without.
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:5174/__test/reset
```

Link's own two routes are unauthenticated. The tokens only matter server-side, between Link and
the systems:

```bash
# Every system's copy of the four demo fields, side by side.
curl -s "http://localhost:5176/api/compare?registry=org:us:ein&id=123456789"

# Push one value to the named targets. Each target answers separately.
curl -s -X POST http://localhost:5176/api/sync \
  -H "Content-Type: application/json" \
  -d '{"registry":"org:us:ein","id":"123456789","path":"addresses.primary",
       "value":{"street1":"600 B Street","street2":"Suite 300","city":"San Diego",
                "stateOrProvince":"CA","country":"US","postalCode":"92101"},
       "targets":["funderhub"]}'
```

## If something is off

- **Every column says "no access token is configured"**: Link's `.env` is missing. Copy
  `apps/link/.env.example`.
- **Every route answers 401**: that system's `.env` is missing. Copy its `.env.example`.
- **A port is taken**: every app sets `strictPort`, so the dev server fails instead of moving. To
  move one, change the port together in the app's `vite.config.ts`, Link's registry in
  `apps/link/src/lib/server/sources.ts`, and the Playwright origins in `e2e/env.ts`.
- **The grid shows something the code does not explain**: check what is actually listening on
  5173, 5174 and 5176. A `pnpm dev` from another checkout of this repo serves that branch's code
  on the same ports, and both `pnpm e2e` and your browser will happily talk to it.
