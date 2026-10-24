# Container backend (work in progress)

This folder is the server for the **container version** of the Collaborative Writing App. It replaces
what Firebase does in the Vercel version (sign-in, database, live updates) so everything can run on
Technikum's own server. It has **no outside dependencies**: it uses only what ships with Node.js
(version 22.13 or newer; the container uses Node 24).

| Part | File |
|---|---|
| Starts everything (web pages + server on one port) | `index.mjs` |
| Connections, live updates, sign-in tokens | `app.mjs` |
| Database (one SQLite file) | `store.mjs` |
| Queries (`where`, `orderBy`) | `query.mjs` |
| WebSocket implementation | `websocket.mjs` |
| Teacher accounts, requests, import, passwords | `accounts.mjs` |
| Who may read/write what | `rules.mjs` (port of `firestore.rules`) |
| Tests | `test/` |

The browser side is in `src/backend/local/`: small replacements for `firebase/firestore`,
`firebase/auth` and `firebase/app`. Building with `BACKEND=local` (see `next.config.mjs`) swaps them
in, so no screen had to change. The normal build (Vercel) is unaffected.

## Status

- [x] Stage 1: database, live updates, transactions, anonymous student identity, tests
- [x] Stage 2a: teacher accounts (request access, approval, Excel/CSV import, password links)
- [x] Stage 2b: the access rules from `firestore.rules` in `rules.mjs` (keep both files in step; tests in `test/rules.test.mjs`)
- [ ] Stage 3: Dockerfile and automatic image build
- [ ] Stage 4: handover pack for IT (brief, settings, runbook)

## Settings (environment variables)

| Variable | Meaning | Default |
|---|---|---|
| `PORT` | port to listen on | `3000` |
| `DATA_DIR` | folder for the database file (back this up) | `./data` |
| `SESSION_SECRET` | secret for sign-in tokens; if unset, one is generated and stored in the database | generated |
| `ADMIN_EMAIL` | administrator email(s), comma-separated; they approve teachers. On first start the log shows a one-time link to choose their password | none |
| `TRUST_PROXY` | `1` if behind a reverse proxy that sets `X-Forwarded-For` (for rate limits) | off |

## Try it without Docker

```
npm install
npm run test:server        # server tests
npm run test:shim          # the browser-side stand-in against the real server
npm run build:local        # builds the app for the container
npm run start:local        # http://localhost:3000
```

## Protocol (browser to server, JSON over one WebSocket at `/ws`)

Requests carry a number `rid` and are answered by `{t:"res", rid, ok, ...}`.

- `hello {token?}` who am I; `anon` new anonymous student; `signout`; `login {email,password}`; `signup` is refused
- `access-request {email,name}`; `set-password {token,password}` (one-time link)
- admin only: `admin-overview`, `admin-approve {id}`, `admin-reject {id}`, `admin-import {people}`, `admin-reset {uid}`, `admin-disable {uid,disabled}`

The server cannot send email (no outbound connections). Setup links are shown to the administrator, who
sends them by mail draft or mail merge. Automatic mail would need an SMTP relay from IT.
- `sub {sid, kind:"doc"|"query", path, where?, order?}` live results, pushed as `snap {sid, doc | docs}`; `unsub {sid}`
- `get {kind, path, where?, order?}` one-off read
- `commit {writes:[{op:"set"|"update"|"delete", path, data?, merge?}], reads?:{path:version}}` all-or-nothing;
  `reads` makes it a transaction: it fails with code `aborted` if a document read has changed meanwhile

A write is applied, every affected live query is re-sent, and only then is the writer answered, so a
browser always sees its own change before the confirmation.
