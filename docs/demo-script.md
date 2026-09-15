# Demo script and route walkthrough

Personal notes for running the demo by hand. The README is the overview; this is the click path,
the `curl` block, and what to say while it runs. Everything assumes `pnpm dev` is up with the three
`.env` files in place (see the README).

## The click path

About two minutes. It starts on GrantPortal at `http://localhost:5173` and moves to Link at
`http://localhost:5176`.

1. **Start where the profile lives.** Open GrantPortal and follow the organization link to
   `/orgs/018f2e77-1a2b-7c3d-8e4f-000000000001`. This is the screen a nonprofit keeps their profile
   on: the four fields the demo compares are editable, the rest is shown as GrantPortal stores it.
   Note the address — Suite 300. FunderHub has the same page at `http://localhost:5174`, its copy
   says Suite 210, and it has no website box at all, because it does not store `socials`. Two
   systems, two screens, one organization, and nobody reconciling them. That is the problem.
2. **Open Link, from that page.** Click **Open Link**. The widget appears in an overlay over
   GrantPortal — the same page, not a tab of its own — already looking this organization up by the
   EIN GrantPortal holds for it, and saying at the top that it was opened from GrantPortal. It
   opens on the systems it can talk to, not on data: GrantPortal and FunderHub, each labelled with
   what it allows and each offering **Connect**. Link holds no credentials of its own, so there is
   nothing for it to read until you sign in with one.
3. **Connect GrantPortal** as `admin@example.org`. Sign-in happens in a popup rather than in the
   frame — Google will not render its page in an iframe, so nothing here can — and the popup closes
   itself once GrantPortal has issued a token. GrantPortal's column fills in. FunderHub's column says it is not connected — a state,
   not an error: the grid still renders everything GrantPortal holds.
4. **Connect FunderHub** as the same person. Now the EIN field holds the demo org (`123456789`) and
   the grid shows one column per system, with one row per compared field. Three rows agree.
   The **Primary address** row is marked as differing: GrantPortal says Suite 300, FunderHub says
   Suite 210. The **Website** row shows a value under GrantPortal and nothing under FunderHub. That
   is a gap, not a conflict, so the row is not flagged.
5. **Fix the address.** Click GrantPortal's address to choose it. The panel echoes the pick, and
   FunderHub is pre-selected as the target (the system a value came from is never offered, since it
   already holds it). Click **Sync**. FunderHub answers "accepted", the grid re-reads both systems,
   and the address row now agrees on Suite 300. Link tells the page underneath, which re-reads
   itself — so GrantPortal's own values are current behind the overlay, with no reload.
6. **Push the website.** Click GrantPortal's website, then **Sync**. FunderHub still answers
   "accepted", but its message reads "This system does not store socials." The patch was applied,
   the field was dropped, and the sender was told so. The grid re-reads and the website row is
   unchanged: FunderHub still holds nothing.
7. **Close, and go and look.** Click **Close**: the widget asks GrantPortal's page to take the
   frame away, and it does. Then open FunderHub's profile page at
   `http://localhost:5174/orgs/018f2e77-1a2b-7c3d-8e4f-000000000002`. Suite 300, typed by nobody
   there. That is the whole demo in one screen.
8. **The beat worth ending on.** Open a new tab at `http://localhost:5176` — tokens live for the
   tab, so this one starts disconnected — and connect as `portal-only@example.org`. GrantPortal
   signs them in. FunderHub signs them in too, and then says **No access on this system**: that
   person has no organization there. Same widget, same person, two answers, because each system
   decides for itself. Nothing is broken, and the comparison still shows what GrantPortal holds.
9. **Optional: an org nobody knows.** Type `000000000` in the EIN field and click **Look up**. Each
   column reports that the system has no record of the org, the grid still renders, and the value
   picked for the previous org is dropped so it cannot be written onto the wrong organization.

Restart `pnpm dev`, or `POST /__test/reset` on FunderHub, to run it again from the seed. The
profile pages read the same store, so a reset shows up there too — and editing a field on
GrantPortal's page is the other way to create a disagreement to go and find.

Talking points, one per step:

- The widget is embedded, not a destination. The portal includes one script from Link's origin and
  calls `CgLink.open(...)`; everything after that is an iframe and two `postMessage`s. Link names
  the origins allowed to frame it, in `EMBED_ALLOWED_ORIGINS`, and refuses the rest at the browser
  — so this is a third party's widget on someone else's page, with both directions checked.
- The profile pages are each system's own screen, not part of the protocol. They save through
  exactly the function `PATCH /common-grants/orgs/{orgId}` goes through, so an edit typed here and
  an edit pushed by the widget are the same edit, refused by the same rules.
- The widget knows nothing about how many systems there are. A third one is an entry in
  `apps/link/src/lib/server/sources.ts`. Link holds no credentials of its own: you connect each
  system through its own sign-in, and the browser keeps that system's token for the session.
- Ids are assigned per system, so every operation starts from the EIN lookup. No two systems agree
  on ids and the contract does not ask them to.
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
  Connect control on each system in the widget's list. Note that tokens taken while embedded and
  tokens taken standalone are separate: Chromium partitions storage inside a third-party frame, so
  connecting in the overlay does not connect the widget opened directly, or the other way round.
- **Open Link does nothing, or the overlay is blank**: Link is not running, or the portal's
  `LINK_ORIGIN` points somewhere else. The page says which origin it tried. An overlay that
  appears and stays empty is `EMBED_ALLOWED_ORIGINS` in Link's `.env` not naming the portal's
  origin — the browser refuses the frame, and the console says so.
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
