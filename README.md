# CommonGrants Link

A demo of organization profile syncing across grant systems, built against the
[CommonGrants](https://commongrants.org) v0.4.0 org routes and the contract described in ADR-0026.

A nonprofit keeps the same profile in several systems, and those copies drift apart. This repo
stands up three systems that each speak the CommonGrants org routes, plus a widget that reads the
profile from all of them, shows where they disagree, and pushes the corrections back out.

One of the three systems is a real vendor that has not implemented the protocol: `temelio-adapter`
is a CommonGrants-conformant proxy over Temelio's own API, which is how we find out whether the
contract retrofits onto a system nobody designed for it.

See [`docs/build-plan.md`](docs/build-plan.md) for the architecture, the field mapping, and the
decisions behind them.

## Layout

| Path                   | What it is                                                       |
| ---------------------- | ---------------------------------------------------------------- |
| `packages/cg-org-sync` | Shared org schemas, client, comparison engine, and token helpers |
| `apps/portal`          | "GrantPortal" — the app that embeds the widget                   |
| `apps/funderhub`       | "FunderHub" — a second CommonGrants-native system                |
| `apps/temelio-adapter` | CommonGrants proxy over the Temelio sandbox                      |
| `apps/link`            | The widget: iframe app and embed loader                          |

Every server exposes the same routes, which is what lets the widget treat a new source as
configuration rather than code:

```
GET   /common-grants/orgs             list, filtered by ?registry= &id=
GET   /common-grants/orgs/{orgId}     read one profile
PATCH /common-grants/orgs/{orgId}     apply a JSON Merge Patch
POST  /token                          mint this system's own access token
GET   /.well-known/jwks.json          this system's public keys
```

## Getting started

```bash
pnpm install
pnpm dev
```

## Scripts

| Command       | What it does                |
| ------------- | --------------------------- |
| `pnpm dev`    | Run every app in parallel   |
| `pnpm build`  | Build every app and package |
| `pnpm check`  | Type-check every workspace  |
| `pnpm test`   | Run the test suites         |
| `pnpm lint`   | Lint the repo               |
| `pnpm format` | Format the repo             |
