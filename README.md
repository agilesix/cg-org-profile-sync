# CommonGrants Link

A demo of organization profile syncing across grant systems, built against the
[CommonGrants](https://commongrants.org) v0.4.0 org routes and the contract described in ADR-0026.

A nonprofit keeps the same profile in several systems, and those copies drift apart. This repo
stands up two systems that each speak the CommonGrants org routes and each hold a drifted copy of
one organization's profile, plus a widget that reads the profile from both, shows where they
disagree, and pushes a chosen value back to whichever systems you pick.

A third system is scaffolded but not built: `temelio-adapter` will be a CommonGrants-conformant
proxy over Temelio's own API, which is how we find out whether the contract retrofits onto a system
nobody designed for it.

The build plan, including the architecture and the decisions behind it, is kept outside this
repo. Ask Billy for a copy.

## Where this actually is

The vertical slice works end to end and is pinned by tests: two systems serve the org routes over
their own seed, Link reads both and writes back to either, and a Playwright suite boots all three
and drives the widget in a browser. What is _not_ here is anything a deploy would need: real auth,
durable storage, the embed loader, and the Temelio proxy.

| Piece                                             | State                                          |
| ------------------------------------------------- | ---------------------------------------------- |
| Workspace, TypeScript, lint, format               | Done                                           |
| `applyMergePatch` (RFC 7396)                      | Done, tested                                   |
| Zod schemas for the org models                    | Done, tested against the protocol's fixtures   |
| Seed profiles for the demo organization           | Done, tested                                   |
| Shared org route handlers, bearer guard, reset    | Done, tested, wired into portal and funderhub  |
| Org client and fan-out (compare, sync)            | Done, tested with a stubbed transport          |
| Comparison engine and patch builder               | Done, tested                                   |
| Link's `/api/compare` and `/api/sync`             | Done, covered by the Playwright API specs      |
| The widget page                                   | Done, covered by the Playwright browser specs  |
| Embed loader (iframe into GrantPortal)            | Not started — the widget is a standalone page  |
| Auth (Google SSO, per-system JWTs, `POST /token`) | Not started — a static bearer token per system |
| `temelio-adapter`                                 | Scaffold only                                  |

Two decisions worth knowing before you read the code:

- **Storage is in memory**, behind an `OrgStore` interface so D1 can replace it without the handlers
  changing. Writes live as long as the dev server (or, deployed, the Worker isolate). Restarting
  `pnpm dev` puts every system back to its seed, which is fine locally and wrong for anything
  deployed.
- **The schemas are checked against the protocol's own fixtures**, not against hand-written examples.
  `packages/cg-org-sync/src/schemas/__fixtures__/protocol-orgs.json` is copied verbatim from the
  CommonGrants repo; every published record must parse, and a corpus of records that each break a
  documented rule must not.

## Layout

| Path                   | What it is                                                                   |
| ---------------------- | ---------------------------------------------------------------------------- |
| `packages/cg-org-sync` | Shared org schemas, route handlers, store, client, comparison engine         |
| `packages/seed`        | The demo organization's profile, one drifted copy per system                 |
| `apps/portal`          | "GrantPortal" — the full-coverage system, and the copy that is current       |
| `apps/funderhub`       | "FunderHub" — a second system, a suite number behind and missing `socials`   |
| `apps/temelio-adapter` | CommonGrants proxy over the Temelio sandbox (scaffold)                       |
| `apps/link`            | The widget, served as a standalone page over its own `/api/*` fan-out routes |
| `e2e`                  | Playwright: API specs against Link's routes, browser specs against the page  |

Every system exposes the same routes, which is what lets the widget treat a new source as
configuration rather than code — a third system is an entry in
`apps/link/src/lib/server/sources.ts` and a token in Link's `.env`:

```
GET   /common-grants/orgs             list, filtered by ?registry= &id=
GET   /common-grants/orgs/{orgId}     read one profile
PATCH /common-grants/orgs/{orgId}     apply a JSON Merge Patch
POST  /token                          mint this system's own access token   (not yet)
GET   /.well-known/jwks.json          this system's public keys             (not yet)
```

## Running the demo

You need Node 22 or newer and pnpm 11 (`corepack enable` gets you the pinned version).

```bash
pnpm install

# Every app reads its secrets from a gitignored .env. Copy all three examples:
cp apps/portal/.env.example apps/portal/.env
cp apps/funderhub/.env.example apps/funderhub/.env
cp apps/link/.env.example apps/link/.env

pnpm dev
```

`pnpm dev` starts every app in parallel on a fixed port each:

| App               | URL                     | Role                                         |
| ----------------- | ----------------------- | -------------------------------------------- |
| GrantPortal       | `http://localhost:5173` | Holds the current copy of the profile        |
| FunderHub         | `http://localhost:5174` | Holds the stale copy; does not store socials |
| Temelio adapter   | `http://localhost:5175` | Placeholder page only                        |
| Link (the widget) | `http://localhost:5176` | Open this one                                |

Open `http://localhost:5176` and the grid is already filled in — the page is server-rendered from a
live read of both systems. The two system apps each serve a placeholder page listing their routes;
there is nothing to click on them.

**Do not skip the `.env` step.** Without them the apps boot and do nothing useful: portal and
funderhub fail closed on their bearer guard, so every org route answers 401, and Link reports each
source as "no access token is configured" instead of comparing anything.

Each system's `CG_ACCESS_TOKEN` is the bearer it accepts, and Link holds one token per source —
`PORTAL_ACCESS_TOKEN` and `FUNDERHUB_ACCESS_TOKEN` must each match that system's own value, since a
token minted for one system is meant to be useless at another. Copying the three examples unchanged
already lines them up. They are local placeholders; generate real secrets for anything that is not
localhost.

`ENABLE_TEST_ROUTES=true` in the two systems' `.env` mounts `POST /__test/reset`, which puts that
system's store back to its seed. Unset, the route 404s, which is what keeps it out of a deploy — the
variable is deliberately absent from each app's `wrangler.jsonc`.

**If a port is taken.** Every app sets `strictPort`, so a collision fails that app's dev server
rather than silently moving it and breaking everyone who expected the documented port. To move one,
change the port in the same three places together: the app's `vite.config.ts`, Link's registry in
`apps/link/src/lib/server/sources.ts`, and the Playwright suite's origins in `e2e/env.ts`
(`playwright.config.ts` reads from there).

## Poke the routes directly

The tokens below are the placeholder values from the `.env.example` files. Ids are assigned per
system, so the EIN lookup is always the first call; the ids shown are the seeded ones.

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

Link's own two routes are unauthenticated — the tokens only matter server-side, between Link and
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

## Tests

There are two suites, and they prove different things.

**`pnpm test`** runs the Vitest suites in `packages/cg-org-sync` and `packages/seed`. Everything with
logic in it lives in the library and is tested there: the schemas against the protocol's fixtures,
the merge patch, the route handlers against an in-memory store, the client and fan-out against a
stubbed `fetch`, the comparison engine. The SvelteKit apps have no test harness of their own; their
routes are thin wrappers over this code. Run one package with
`pnpm --filter @cg-link/org-sync test`, or one file with
`pnpm --filter @cg-link/org-sync exec vitest run src/utils/merge-patch.test.ts`.

**`pnpm e2e`** runs the Playwright workspace in `e2e/`, and is the only test that runs the real apps.
It boots portal, funderhub and link on their dev ports (or joins a `pnpm dev` that is already
running), then drives Link two ways: `specs/api-*.spec.ts` call `/api/compare` and `/api/sync` over
HTTP and check that a value actually travelled from one system to another; `specs/widget.spec.ts`
opens the page in Chromium and clicks through the demo below. This is what catches a route that is
wired up wrong, which the stubbed-transport unit tests cannot.

```bash
pnpm --filter @cg-link/e2e install-browsers   # once per machine: playwright install chromium
pnpm e2e
```

Things to know before running it:

- **It needs all three `.env` files**, since it drives the real servers. A missing one shows up as
  the reset fixture failing with a sentence naming the app, not as a spec that fails on an
  assertion.
- **Isolation comes from `POST /__test/reset`.** Both systems are in memory and shared by every
  spec, so an automatic fixture re-seeds them before each test. That route is gated by
  `ENABLE_TEST_ROUTES`, not by the bearer, so the suite holds no credentials — and so a deployed
  Worker, which never sets the flag, has no such route at all. The suite runs serially for the same
  reason: two workers would be resetting each other's fixtures.
- **`reuseExistingServer` is on locally.** If a spec passes or fails in a way the source does not
  explain, check what is actually listening on 5173/5174/5176 — a stale `pnpm dev`, or one from
  another checkout of this repo, serves code that is not in front of you.
- **Browsers not installed** is the one setup error Playwright reports clearly; the
  `install-browsers` line above is the fix.
- Run one spec with `pnpm --filter @cg-link/e2e exec playwright test specs/widget.spec.ts`, add
  `-g "pattern"` for one test by name, or `--ui` for the inspector.

**`pnpm check`** type-checks every workspace (`tsc --noEmit` for packages, `svelte-check` for apps).
The apps read their env through `$env/dynamic/private`, so this passes without any `.env` present.
`pnpm lint` and `pnpm format:check` are configured once at the root and cover the whole repo.

## Demo script

About two minutes once `pnpm dev` is up. Everything is at `http://localhost:5176`.

1. **Open Link.** The EIN field already holds the demo org (`123456789`) and the grid shows one
   column per system, GrantPortal and FunderHub, and one row per compared field. Three rows agree.
   The **Primary address** row is marked as differing: GrantPortal says Suite 300, FunderHub says
   Suite 210. The **Website** row shows a value under GrantPortal and nothing under FunderHub —
   that is a gap, not a conflict, so the row is not flagged.
2. **Fix the address.** Click GrantPortal's address to choose it. The panel echoes the pick, and
   FunderHub is pre-selected as the target (the system a value came from is never offered — it
   already holds it). Click **Sync**. FunderHub answers "accepted", the grid re-reads both systems,
   and the address row now agrees on Suite 300.
3. **Push the website.** Click GrantPortal's website, then **Sync**. FunderHub still answers
   "accepted", but its message reads "This system does not store socials." — the patch was
   applied, the field was dropped, and the sender was told so. The grid re-reads and the website
   row is unchanged: FunderHub still holds nothing.
4. **Optional: an org nobody knows.** Type `000000000` in the EIN field and click **Look up**. Each
   column reports that the system has no record of the org, the grid still renders, and the value
   picked for the previous org is dropped so it cannot be written onto the wrong organization.

Restart `pnpm dev`, or `POST /__test/reset` on FunderHub, to run it again from the seed.

## Scripts

| Command       | What it does                                                                |
| ------------- | --------------------------------------------------------------------------- |
| `pnpm dev`    | Run every app in parallel (`--no-bail`, so one crash doesn't stop the rest) |
| `pnpm build`  | Build every app and package                                                 |
| `pnpm check`  | Type-check every workspace                                                  |
| `pnpm test`   | Run the Vitest suites                                                       |
| `pnpm e2e`    | Playwright: boot all three apps and run the specs in `e2e/`                 |
| `pnpm lint`   | Lint the repo                                                               |
| `pnpm format` | Format the repo (`format:check` to verify only)                             |

## What's next

Not in this slice, in roughly the order they matter:

- **Embed loader.** The widget is a standalone page. The plan is an iframe plus `postMessage`
  loader that GrantPortal hosts, so the demo shows the widget inside a system rather than beside
  it.
- **Real auth.** `POST /token` minting a per-system JWT with an `aud` claim, published keys at
  `/.well-known/jwks.json`, and Google SSO in front of the widget. The static bearer token is a
  placeholder for exactly that, and `requireBearer` is the seam it replaces.
- **`temelio-adapter`.** A conformant proxy over a vendor that has not implemented the protocol.
  Link is ready for it: uncomment the entry in `apps/link/src/lib/server/sources.ts` and add its
  token.
- **Durable storage.** A D1-backed `OrgStore` behind the same interface, so writes outlive a
  restart.

## License

[MIT](LICENSE) © Agile Six Applications, Inc.
