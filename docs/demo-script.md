# Demo script and route walkthrough

Personal notes for running the demo by hand. The README is the overview; this is the click path,
the `curl` block, and what to say while it runs. The five-minute cut with a timed talk track is
`demo-talk-track.md`. Everything assumes `pnpm dev` is up with the four
`.env` files in place (see the README) — Link's included, since an unset `EMBED_ALLOWED_ORIGINS`
means no portal may frame the widget and **Open Link** opens nothing.

## The click path

About four minutes. It starts on GrantPortal at `http://localhost:5173` and never leaves it until
the last step.

1. **Start where the profile lives.** Open GrantPortal and follow the organization link to
   `/orgs/018f2e77-1a2b-7c3d-8e4f-000000000001`. This is the screen a nonprofit keeps their profile
   on: every field the demo compares is editable, and the rest is shown as GrantPortal stores it.
   Note the address — Suite 300. FunderHub has the same page at `http://localhost:5174`, its copy
   says Suite 210, and it has no website box at all, because it does not store `socials`. Temelio
   holds a third copy, visible on the adapter's own page at `http://localhost:5175`: Suite 210 too,
   and the old `http://www.agile6.com`. Three systems, three screens, one organization, and nobody
   reconciling them. That is the problem.
2. **Make the change where a nonprofit would.** Edit the website or the address on GrantPortal's
   page and save. This is an ordinary form on the system that holds the record — it goes through
   `applyOrgPatch`, the same rules GrantPortal's `PATCH` route enforces, so an edit typed here and
   one pushed by the widget are the same edit. The other two systems know nothing about it, which
   is the disagreement the rest of the demo is about.
3. **Open Link, from that page.** Click **Open Link**. The widget appears in an overlay over
   GrantPortal — the same page, not a tab of its own — saying at the top that it was opened from
   GrantPortal, and already carrying this organization. Inside it: a title and one button, **Link
   Grant Management System**. No data, no systems, no fields. Link holds no credentials of its own,
   so there is nothing for it to read until you have linked something — which is the honest version
   of the Plaid screen everyone already recognises.
4. **Open the picker.** Click the button. The modal lists seven grant management systems, each with
   its name and site: GrantPortal, FunderHub and Temelio, then SimplerGrants, Fluxx, Submittable
   and Foundant GLM marked **Coming soon**. Worth saying out loud that the list is configuration —
   the four stubs are entries in a registry, not code — and that clicking one does nothing on
   purpose. There is a search box if you want to show it.
5. **Link GrantPortal** as `admin@example.org`. Picking it opens a sign-in step; **Continue with
   Google** opens GrantPortal's own window — the sign-in has to leave the frame, since no identity
   provider will render inside one. Sign in, and the modal comes back with **Select your
   organization** — three of them, because that is what GrantPortal says this person may act for.
   Pick **Agile Six Applications, Inc.** and click **Continue**. The modal closes, a banner says
   GrantPortal is linked, and the organization's name and EIN sit above the grid.
6. **Link FunderHub** as the same person. Same flow, with one difference worth pausing on: at the
   organization step, only Agile Six can be chosen and it is already selected. The other one is
   greyed and says **Different organization**. You link one organization at a time, so the second
   system is held to the first system's answer — and FunderHub's own ids are different, which is
   exactly why the match is on the EIN rather than an id.
7. **Link Temelio** as the same person. This is the one to slow down for. Temelio is a real grants
   platform that has never heard of CommonGrants — what is behind this row is an adapter speaking
   the contract on its behalf. Nothing in the flow gives that away: the same sign-in, the same
   organization step, the same lock to the organization already linked.
8. **Read the grid.** One column per system, one row per compared field, each system labelled with
   what it allows — **pull and push** for all three. Seven rows, four of which agree. The **Primary
   address** row is marked as differing: GrantPortal holds what you just typed, while FunderHub and
   Temelio both say Suite 210 — so the system holding the current address is the one outnumbered.
   The **Website** row differs too: GrantPortal has the new value, Temelio still has the old
   `http://www.` form, and FunderHub has nothing at all. That last one is a gap, not a conflict,
   and does not count as a third opinion. The **Email** row is the third disagreement and the one
   nobody staged — FunderHub was seeded with a mailbox that no longer routes anywhere, and this
   time it is FunderHub that is outnumbered rather than GrantPortal. **Mission** is the website's
   gap without the refusal on top of it: GrantPortal and Temelio hold one, FunderHub simply never
   filled it in and _can_ store it. **Phone** agrees, which is worth pointing at — most fields do,
   and a grid where everything conflicts would be a grid nobody believes.
9. **Push the address out.** Click GrantPortal's address to choose it. The panel does not say
   "sync" — it says **Push Primary address from GrantPortal to FunderHub and Temelio**, because you
   are standing on GrantPortal and this value is leaving it. Pick several fields and the sentence
   counts them instead of naming one; the direction is still the set's, and a pull only stays a
   pull while every pick came from the same other system. Both other systems are pre-selected as
   targets (the system a value came from is never offered, since it already holds it). Click
   **Push**. Each target answers separately, the grid re-reads all three, and the address row
   agrees. One patch went to a system that implements the protocol and to one that does not, and
   the screen cannot tell them apart. Link also tells the page underneath, which re-reads itself —
   so GrantPortal's own values are current behind the overlay, with no reload.
10. **Push the website too, without starting over.** Click GrantPortal's website. The panel now
    lists two picks — the address from the last step and the website — each with its own
    **Remove**, and they go together: one patch per target, not one per field. (Re-sending the
    address is a harmless no-op; **Remove** it first if you would rather show only the website
    moving.) Clicking a second value in a row you have already picked replaces that row's choice
    rather than adding to it, since one field cannot have two values.

    Now the beat worth slowing down for: **Push** greys out, and a line above it reads "FunderHub
    can't store Website. Unselect it or drop FunderHub as a target." The widget knows before
    asking. Uncheck **FunderHub** and the button comes back. Click **Push**. Temelio takes both,
    the grid re-reads, and the website now agrees between GrantPortal and Temelio while FunderHub
    still holds nothing — untouched, because nothing was sent to it.

    Worth saying out loud: that list is Link's own copy of what FunderHub will not keep, and
    duplicating it is not the real answer — a system publishing its own capabilities is, and the
    protocol does not define that yet. It is safe to duplicate only because FunderHub still
    enforces the rule itself, so this copy can over-block and never under-block.

11. **Now pull one in.** Reset FunderHub (`curl -X POST http://localhost:5174/__test/reset`) and
    re-read the grid, so the address disagrees once more. Then click **FunderHub's** address
    instead. The panel flips: **Pull Primary address from FunderHub into GrantPortal**, and
    GrantPortal is the only target offered — a pull goes into the page you are on and nowhere else.
    Click **Pull**. GrantPortal answers "pulled into", and the page behind the overlay is now
    showing Suite 210. Over the protocol this was the identical request to step 9, a `PATCH` to one
    system; what changed is which copy was authoritative, and the widget says which before you
    commit to it.
12. **Close, and go and look.** Click **Close**: the widget asks GrantPortal's page to take the
    frame away, and it does. Then open FunderHub's profile page at
    `http://localhost:5174/orgs/018f2e77-1a2b-7c3d-8e4f-000000000002`, and the adapter's page at
    `http://localhost:5175`, and see what arrived in each, typed by nobody. When the adapter is
    pointed at the real Temelio instead of its stand-in, that page links straight to the grantee's
    record in Temelio's own interface, and the change is visible there.
13. **The beat worth ending on.** Open a new tab at `http://localhost:5176` — tokens and the linked
    organization live for the tab, so this one starts empty — and link as `portal-only@example.org`.
    GrantPortal signs them in and offers them one organization, which is what a real applicant looks
    like. Then link FunderHub as the same person: it signs them in and answers **No organization on
    FunderHub for that account**. Same widget, same person, two answers, because each system decides
    for itself. Nothing is broken, and the comparison still shows what GrantPortal holds.

**Optional, if someone asks what happens with a system that has never heard of you.** Start a fresh
tab and link **Tallgrass Literacy Project** on GrantPortal instead of Agile Six — FunderHub does not
hold that organization. Link FunderHub and the organization step says it holds no organization with
that EIN. Close it, and FunderHub's column reads "No record of this organization" while GrantPortal's
copy still shows. Signed in fine, simply not known there: a state, not a failure.

If a browser blocks the sign-in window, the flow falls back to this tab and comes back to the step
it was on — worth knowing, not worth demonstrating. Allow popups for `localhost:5176` beforehand.

Sign-in is the stand-in form, not Google. It looks like a credentials screen on purpose; the
password field is decorative and submits nothing, and the page says so above it. Real Google
sign-in is the last ticket in the plan and happens after this demo.

**Optional, if someone asks what happens with a system that has never heard of you.** Start a fresh
tab and link **Tallgrass Literacy Project** on GrantPortal instead of Agile Six — FunderHub does not
hold that organization. Link FunderHub and the organization step says it holds no organization with
that EIN. Close it, and FunderHub's column reads "No record of this organization" while GrantPortal's
copy still shows. Signed in fine, simply not known there: a state, not a failure.

If a browser blocks the sign-in window, the flow falls back to this tab and comes back to the step
it was on — worth knowing, not worth demonstrating. Allow popups for `localhost:5176` beforehand.

Sign-in is the stand-in form, not Google. It looks like a credentials screen on purpose; the
password field is decorative and submits nothing, and the page says so above it. Real Google
sign-in is the last ticket in the plan and happens after this demo.

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
- Ids are assigned per system, so every operation matches on the EIN instead. No two systems agree
  on ids and the contract does not ask them to — which is also why the second system's organization
  step can lock to the first system's answer without either of them sharing an identifier for the
  record itself.
- Direction is the thing a person has to get right, so it is never implied. Every action names
  which system a value leaves and which it lands on, and a system configured `write: false` is
  never offered as a target at all — the fan-out refuses one without sending a request, so the
  declaration is enforced rather than decorative. Nothing in this demo is configured read-only —
  all three take a push — but a source that were would show as a pull-only column without a line
  of widget code knowing about it.
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
TEMELIO_TOKEN=temelio-local-placeholder-change-me

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

# The Temelio adapter answers the same three routes, over a vendor that has
# never heard of CommonGrants. Its id for the org is Temelio's own.
curl -s "http://localhost:5175/common-grants/orgs?registry=org:us:ein&id=123456789" \
  -H "Authorization: Bearer $TEMELIO_TOKEN"

# Its reset only exists against the in-memory stand-in. In sandbox mode it
# answers 409: those records live in a system shared with other people.
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:5175/__test/reset
```

### Putting Temelio back by hand

Only needed when the adapter is in `sandbox` mode, where there is no reset route to call: those
records live in a system shared with other people. After a demo has pushed a value to Temelio, the
record has to be returned to the drift the demo starts from.

The quickest way is through the adapter itself, which is the same path the demo used — push the
old value back:

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
TEMELIO_TOKEN=temelio-local-placeholder-change-me
ORG=$(curl -s "http://localhost:5175/common-grants/orgs?registry=org:us:ein&id=123456789" \
  -H "Authorization: Bearer $TEMELIO_TOKEN" | python3 -c 'import json,sys; print(json.load(sys.stdin)["items"][0]["id"])')

curl -s -X PATCH "http://localhost:5175/common-grants/orgs/$ORG" \
  -H "Authorization: Bearer $TEMELIO_TOKEN" \
  -H 'content-type: application/merge-patch+json' \
  -d '{"socials":{"website":"http://www.agile6.com"},
       "addresses":{"primary":{"street1":"600 B Street","street2":"Suite 210","city":"San Diego",
                               "stateOrProvince":"CA","country":"US","postalCode":"92101"}}}'
```

Going straight at the vendor's own API works too, and is sometimes what you want when the adapter
is the thing under suspicion. Those endpoint shapes are in the internal spec and in the adapter's
gitignored findings file, not here.

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
- **Temelio's column is showing the wrong thing, or the demo is not proving what you think**:
  check which mode the adapter is in. Its landing page at http://localhost:5175 says so, and so
  does one line in its server log at start-up. `fixture` is an in-memory stand-in and never
  contacts the vendor; `sandbox` is the real thing.
- **Temelio answers 502**: the vendor refused or could not be reached, and the message carries what
  it said. An expired `TEMELIO_API_TOKEN` is the usual cause — it is a foundation API key, and
  revoking one on the vendor's own settings page takes effect immediately.
- **A push to Temelio reports that `name` was not stored**: that is correct and not a fault. A
  funder cannot rename a grantee through the vendor's API, so the adapter drops the field and says
  so rather than reporting a change that did not happen.
- **The grid shows something the code does not explain**: check what is actually listening on
  5173, 5174 and 5176. A `pnpm dev` from another checkout of this repo serves that branch's code
  on the same ports, and both `pnpm e2e` and your browser will happily talk to it.
