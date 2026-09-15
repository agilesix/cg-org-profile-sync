# Demo script and route walkthrough

Personal notes for running the demo by hand. The README is the overview; this is the click path,
the `curl` block, and what to say while it runs. Everything assumes `pnpm dev` is up with the three
`.env` files in place (see the README).

## The click path

About two minutes. Everything is at `http://localhost:5176`.

1. **Open Link.** It opens on a title and one button: **Link Grant Management System**. No data,
   no systems, no fields. Link holds no credentials of its own, so there is nothing for it to read
   until you have linked something — which is the honest version of the Plaid screen everyone
   already recognises.
2. **Open the picker.** Click the button. The modal lists seven grant management systems, each with
   its name and site: GrantPortal and FunderHub, then Temelio, SimplerGrants, Fluxx, Submittable
   and Foundant GLM marked **Coming soon**. Worth saying out loud that the list is configuration —
   the five stubs are entries in a registry, not code — and that clicking one does nothing on
   purpose. There is a search box if you want to show it.
3. **Link GrantPortal** as `admin@example.org`. Picking it opens a sign-in step; **Continue with
   Google** opens GrantPortal's own window. Sign in, and the modal comes back with **Select your
   organization** — three of them, because that is what GrantPortal says this person may act for.
   Pick **Agile Six Applications, Inc.** and click **Continue**. The modal closes, a banner says
   GrantPortal is linked, and the organization's name and EIN sit above the grid.
4. **Link FunderHub** as the same person. Same flow, with one difference worth pausing on: at the
   organization step, only Agile Six can be chosen and it is already selected. The other two are
   greyed and say **Different organization**. You link one organization at a time, so the second
   system is held to the first system's answer — and FunderHub's own ids are different, which is
   exactly why the match is on the EIN rather than an id.
5. **Read the grid.** One column per system, one row per compared field. Three rows agree. The
   **Primary address** row is marked as differing: GrantPortal says Suite 300, FunderHub says Suite 210. The **Website** row shows a value under GrantPortal and nothing under FunderHub. That is a
   gap, not a conflict, so the row is not flagged.
6. **Fix the address.** Click GrantPortal's address to choose it. The panel echoes the pick, and
   FunderHub is pre-selected as the target (the system a value came from is never offered, since it
   already holds it). Click **Sync**. FunderHub answers "accepted", the grid re-reads both systems,
   and the address row now agrees on Suite 300.
7. **Push the website.** Click GrantPortal's website, then **Sync**. FunderHub still answers
   "accepted", but its message reads "This system does not store socials." The patch was applied,
   the field was dropped, and the sender was told so. The grid re-reads and the website row is
   unchanged: FunderHub still holds nothing.
8. **The beat worth ending on.** Open a new tab at `http://localhost:5176` — tokens and the linked
   organization live for the tab, so this one starts empty — and link as `portal-only@example.org`.
   GrantPortal signs them in and offers them one organization, which is what a real applicant looks
   like. Then link FunderHub as the same person: it signs them in and answers **No organization on
   FunderHub for that account**. Same widget, same person, two answers, because each system decides
   for itself. Nothing is broken, and the comparison still shows what GrantPortal holds.

If a browser blocks the sign-in window, the flow falls back to this tab and comes back to the step
it was on — worth knowing, not worth demonstrating. Allow popups for `localhost:5176` beforehand.

Restart `pnpm dev`, or `POST /__test/reset` on FunderHub, to run it again from the seed.

Talking points, one per step:

- The widget knows nothing about how many systems there are. A third one is an entry in
  `apps/link/src/lib/server/sources.ts`. Link holds no credentials of its own: you connect each
  system through its own sign-in, and the browser keeps that system's token for the session.
- Ids are assigned per system, so every operation matches on the EIN instead. No two systems agree
  on ids and the contract does not ask them to — which is also why the second system's organization
  step can lock to the first system's answer without either of them sharing an identifier for the
  record itself.
- The write is a JSON Merge Patch that sets exactly one field. A system that cannot store the
  field accepts the patch, drops the field, and says so in its message. The sender learns the
  value went no further without the whole change failing.
- Nobody typed a password into Link, and Link stores nothing. Each system runs its own sign-in and
  issues its own short-lived token, scoped to the organizations that person may touch there. The
  browser holds them for the tab; close it and they are gone.

## Poke the routes directly

The tokens are the placeholder `CG_ACCESS_TOKEN` values from the `.env.example` files — each
system's static service credential, which is scoped to every organization it holds. A token minted
for a person is scoped to theirs instead, and a system answers 404 for an org outside that grant.
Ids are assigned per system, so the EIN lookup is always the first call; the ids shown are the
seeded ones.

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
# No token, or the other system's token: 401. A system only accepts a token
# minted for itself, which is what makes one lifted from elsewhere useless.
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5173/common-grants/orgs
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5173/common-grants/orgs \
  -H "Authorization: Bearer $FUNDERHUB_TOKEN"

# Each system's public keys, unauthenticated. The two `kid`s differ, because
# the two systems sign with different keys.
curl -s http://localhost:5173/.well-known/jwks.json
curl -s http://localhost:5174/.well-known/jwks.json

# Put a system back to its seed. 204 with ENABLE_TEST_ROUTES=true, 404 without.
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:5174/__test/reset
```

### Minting a token by hand

The flow the Connect button runs, one hop at a time — useful when something is off and you want to
know which hop broke. Assumes `IDENTITY_PROVIDER=fake`; against Google the middle hop is a browser
sign-in rather than a URL you can curl.

```bash
# 1. Link starts the flow: a PKCE verifier into a cookie jar, a redirect to the portal.
curl -s -c /tmp/link-jar -o /dev/null -D - \
  'http://localhost:5176/api/connect/start?source=portal' | grep -i '^location'

# 2. Follow that location. The portal's /oauth/authorize redirects on to its own sign-in page,
#    carrying a signed state. Submitting the form is a GET the state travels on:
#      http://localhost:5173/oauth/callback?state=<state>&email=admin@example.org
#    which redirects back to Link with ?code=<code>&state=<...>.

# 3. Link exchanges the code for the portal's token. Ask for JSON to see it:
curl -s -b /tmp/link-jar -H 'Accept: application/json' \
  'http://localhost:5176/connect/callback?code=<code>&state=<state>'

# 4. That token works at the system that issued it, and nowhere else:
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5173/common-grants/orgs \
  -H "Authorization: Bearer $TOKEN"   # 200
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5174/common-grants/orgs \
  -H "Authorization: Bearer $TOKEN"   # 401 — minted for another audience
```

`e2e/fixtures.ts`'s `connectViaApi` drives exactly these hops, if you would rather read it than
type it.

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

- **Every column says a system is not connected**: nothing has been connected yet. Use the
  Connect control on each system in the widget's list.
- **Every route answers 401**: that system's `.env` is missing. Copy its `.env.example`.
- **`/.well-known/jwks.json` answers 500**: that system's `SIGNING_KEY_JWK` is unset or is not a
  private ES256 JWK. The server log names the variable. The org routes still work on
  `CG_ACCESS_TOKEN`, so this shows up on its own rather than taking the demo down.
- **A port is taken**: every app sets `strictPort`, so the dev server fails instead of moving. To
  move one, change the port together in the app's `vite.config.ts`, Link's registry in
  `apps/link/src/lib/server/sources.ts`, and the Playwright origins in `e2e/env.ts`.
- **The grid shows something the code does not explain**: check what is actually listening on
  5173, 5174 and 5176. A `pnpm dev` from another checkout of this repo serves that branch's code
  on the same ports, and both `pnpm e2e` and your browser will happily talk to it.
