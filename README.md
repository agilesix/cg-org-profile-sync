# CommonGrants Link

A working demo of one nonprofit's profile being kept in sync across independent grant systems,
using the [CommonGrants](https://commongrants.org) v0.4.0 organization routes.

## Why this exists

A nonprofit applies to many funders, and every funder's system holds its own copy of the same
organization profile-- e.g. legal name, EIN, address, website. Nobody keeps those copies in step. The
organization moves offices, updates one system, and the other three quietly go stale.

CommonGrants is an open protocol for grant data. Its org routes give every system one shared way
to look up, read, and update an organization profile. If systems speak that contract, a small tool
can read the profile from all of them at once, show where they disagree, and push the correct value
back out.

This repo proves that! Two independent systems each serve the org
routes over their own drifted copy of a profile, and a widget reads both, compares them, and writes
back. The whole exchange is covered by browser tests.

## What you can do with it

**Link the systems that hold your profile.** The widget opens on one button. Behind it is a list of
grant management systems — the two this demo runs, and others named but not wired up — the way you
would pick a bank in Plaid.

![The system picker: GrantPortal and FunderHub selectable, five more marked coming soon](docs/screenshots/1-picker.png)

**Sign in to each system, on its own terms.** Every system runs its own sign-in and then tells the
widget which organizations you may act for. You pick one, and that is what the widget works on.

![The organization step: three organizations with their EINs, and Continue waiting for a pick](docs/screenshots/2-organization.png)

**See where systems disagree.** One row per field, one column per system. Rows that differ are
flagged. A field one system simply does not have shows as a gap, not a conflict. Link a second
system and it is held to the organization you already chose — matched by EIN, since no two systems
agree on ids.

![The comparison grid: two systems, four fields, the address row flagged as differing](docs/screenshots/3-compare.png)

**Fix a field everywhere in one click.** Click the value that is right, pick which systems should
receive it, and push. Each system gets a JSON Merge Patch that changes only that field.

![After syncing GrantPortal's address to FunderHub, the row agrees and FunderHub reports the change was applied](docs/screenshots/5-synced.png)

**Find out what a system could not store.** A system that does not model a field accepts the
change, drops the field, and says so.

![Pushing the website to FunderHub: accepted, with the message that this system does not store socials](docs/screenshots/6-declined.png)

**Open it where the data already lives.** Each system has its own profile page, and one button
puts the widget in an overlay on top of it — no new tab, no second login. The widget knows whose
page it is on, and tells it when something changes.

![The widget open in an overlay over GrantPortal's profile page, comparing GrantPortal and FunderHub](docs/screenshots/7-embedded.png)

**Know which way a value is moving.** Nothing is ever just "synced". Taking the page's own value
outward is a push; taking another system's value into it is a pull, and a pull can only land on the
page you are on.

![Choosing FunderHub's address reads "Pull Primary address from FunderHub into GrantPortal", with GrantPortal the only target offered](docs/screenshots/8-pull.png)

**Edit a profile on the system that holds it.** Every system serves its own editable page, saving
through exactly the rules its `PATCH` route enforces — so an edit typed there and one pushed by the
widget are the same edit.

![GrantPortal's organization profile page, with the four compared fields editable](docs/screenshots/9-profile.png)

**Connect another system without new code.** Every system exposes the same routes, so a third one
is a config entry, not a feature. One configured read-only is labelled as such and is never offered
as a target.

```
GET   /common-grants/orgs             find an org by identifier, e.g. ?registry=org:us:ein&id=
GET   /common-grants/orgs/{orgId}     read one profile
PATCH /common-grants/orgs/{orgId}     apply a JSON Merge Patch
GET   /.well-known/jwks.json          this system's public keys
```

## Get set up

You need Node 22 or newer and pnpm 11.

```bash
pnpm install

# Each app reads its configuration from a gitignored .env. Copy all three:
cp apps/portal/.env.example apps/portal/.env
cp apps/funderhub/.env.example apps/funderhub/.env
cp apps/link/.env.example apps/link/.env

pnpm dev
```

Then open **http://localhost:5176** and connect each system. Out of the box they use a stand-in
sign-in form, so any address works — use `admin@example.org` to see both systems, or
`portal-only@example.org` to see one system refuse you.

| App             | URL                     | What it is                                       |
| --------------- | ----------------------- | ------------------------------------------------ |
| Link            | `http://localhost:5176` | The widget. This is the one to open.             |
| GrantPortal     | `http://localhost:5173` | A system holding the current profile             |
| FunderHub       | `http://localhost:5174` | A system holding a stale copy, without `socials` |
| Temelio adapter | `http://localhost:5175` | Placeholder, not built yet                       |

Then open GrantPortal's profile page from its landing page and click **Open Link** to see the
widget the way a nonprofit would: in an overlay on the system they were already using.

Do not skip the `.env` step: a system with no configuration answers 401 to everything. Link's own
`.env` holds no credentials — it forwards the token each system issues you — but it does say which
origins may frame the widget, and unset means none may.

Every value in the examples is a local placeholder, including the signing keys, which are real
private keys sitting in git. Generate your own for anything that is not localhost.

| Variable in each portal's `.env`              | What it does                                                    |
| --------------------------------------------- | --------------------------------------------------------------- |
| `CG_ACCESS_TOKEN`                             | A static service credential, for `curl` and the route specs     |
| `SIGNING_KEY_JWK`                             | That system's own ES256 key: signs its tokens, backs its JWKS   |
| `ENABLE_TEST_ROUTES`                          | Mounts `POST /__test/reset`; unset, that route 404s             |
| `IDENTITY_PROVIDER`                           | `fake` for the stand-in sign-in form; `google` for the real one |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`   | The Google client, when `IDENTITY_PROVIDER` is not `fake`       |
| `SYSTEM_ORIGIN`                               | This system's own origin; defaults to the request's             |
| `LINK_ORIGIN`                                 | The only origin it will send an authorization code to           |
| `DEMO_ADMIN_EMAIL` / `DEMO_PORTAL_ONLY_EMAIL` | Real addresses for the two demo people, if you have them        |

| Variable in Link's `.env` | What it does                                                           |
| ------------------------- | ---------------------------------------------------------------------- |
| `EMBED_ALLOWED_ORIGINS`   | Which origins may frame the widget, and which it will post messages to |

### Signing in with Google instead

**The demo runs on the stand-in form, not Google.** Both portals ship set to `IDENTITY_PROVIDER=fake`,
which is also what `pnpm e2e` drives, so nothing here needs a Google account. The Google provider is
written and unit-tested against a local key set but has not been exercised against Google itself;
standing it up is the last ticket in the plan. What follows is what that will take.

The stand-in form is enough to run and demo everything. To use real Google sign-in, make one
project in the Google Cloud console with one **Web application** OAuth client:

- Authorized redirect URIs: `http://localhost:5173/oauth/callback` and
  `http://localhost:5174/oauth/callback` — each portal's own callback, not Link's.
- Scopes: `openid` and `email`. Nothing else is read.
- Leave the consent screen in **Testing** and add the demo accounts as test users.

Then set `IDENTITY_PROVIDER=google`, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in both portals,
and point `DEMO_ADMIN_EMAIL` / `DEMO_PORTAL_ONLY_EMAIL` at the accounts you added. Only the portals
hold the client secret; Link never sees it.

### Tests

```bash
pnpm test                                    # unit tests for the shared library
pnpm --filter @cg-link/e2e install-browsers  # once per machine
pnpm e2e                                     # boots all three apps and drives the widget in a browser
```

`pnpm e2e` runs the real apps, so it needs all three `.env` files and `IDENTITY_PROVIDER=fake` —
it signs in through the stand-in form and cannot drive Google. A portal set to `google` fails the
suite with a sentence naming it. `pnpm check`, `pnpm lint` and `pnpm format:check` cover types,
lint and formatting for the whole repo.

## What's in the repo

| Path                   | What it is                                                    |
| ---------------------- | ------------------------------------------------------------- |
| `packages/cg-org-sync` | Shared library: schemas, route handlers, client, comparison   |
| `packages/seed`        | The demo organization's profile, one drifted copy per system  |
| `apps/portal`          | "GrantPortal", a CommonGrants-native system                   |
| `apps/funderhub`       | "FunderHub", a second one that does not store every field     |
| `apps/link`            | The widget                                                    |
| `apps/temelio-adapter` | Planned proxy over a vendor that has not adopted the protocol |
| `e2e`                  | Playwright specs that run the real apps                       |

Storage is in memory, so restarting `pnpm dev` puts every system back to its seed — a stand-in
with an interface behind it, chosen so the demo shows the data exchange rather than
infrastructure. Each system signs its own access tokens and publishes the public half, and every
read and write is scoped to the organizations the caller may touch. Each is also its own sign-in: the
widget opens on a button, you pick systems from a list and link them one at a time, and each runs
its own sign-in. A system you have not linked simply says so in its column; the rest still answer.

## Status and what's next

The two-system exchange works end to end and is pinned by tests, and so is per-organization
access: each system runs its own sign-in flow and issues tokens scoped to what you may touch there.
Sign-in currently goes through a stand-in form rather than Google — see above. Not built yet: real
Google sign-in, embedding the widget inside a host system, the Temelio adapter, and durable
storage. The build plan lives outside this repo. Ask Billy for a copy.

## License

[MIT](LICENSE) © Agile Six Applications, Inc.
