# Collaborative Writing App: hosting brief for IT

*Contact: Mark Adams (English, FH Technikum Wien) · Status: ready for a first install and test · 24 Oct 2026*

## What it is
A classroom tool for English lessons. Students on their own devices write one shared text in small groups,
and another group then gives them feedback. The lecturer runs the session from a teacher screen. It is used
in class only, by about 20 lecturers and their groups of roughly 30 students, mostly on a few days a week.

## What you are being asked to do
Run **one container** and put it behind your normal web entrance. Nothing else.

| | |
|---|---|
| Image | One Docker/OCI image, about 200 MB, built automatically from the source (see "What you receive"). Linux, any container platform (Docker, Compose, Kubernetes) |
| Run as | **One instance only** (it keeps its data in a SQLite file; do not run two copies against the same data) |
| Port | 3000 inside the container, plain HTTP |
| Data | One folder, `/data`, mounted as a persistent volume. It holds the database and the daily backups |
| Address | An internal host name, e.g. `writing.<your domain>`, with a TLS certificate from your normal process |
| Who can reach it | Students and lecturers on **Eduroam on campus, or via VPN**. It needs **no access to the internet at all**, in or out |
| Reverse proxy | Must pass **WebSocket** connections on the path `/ws` (see `nginx.example.conf`). Set `TRUST_PROXY=1` |
| Size | Small. As a starting point, 1 CPU and 512 MB RAM. These are estimates from the design; it has not been load-tested yet |

## Settings (environment variables)
Only one is required.

| Variable | Meaning | Default |
|---|---|---|
| `ADMIN_EMAIL` | **Required.** Email of the person who approves lecturer accounts (Mark). Several, comma-separated, are allowed | none |
| `TRUST_PROXY` | `1` when behind a reverse proxy that sets `X-Forwarded-For` (needed for correct rate limiting) | off |
| `PORT` | listening port | `3000` |
| `DATA_DIR` | database folder | `/data` |
| `SESSION_SECRET` | secret for sign-in tokens. Leave unset: one is generated and stored in the database. Set it only if you want it in your secret store | generated |
| `BACKUP_EVERY_HOURS`, `BACKUP_KEEP`, `BACKUP_DIR` | automatic database backups (default: every 24 h, keep 14, in `/data/backups`). `0` hours switches them off | 24, 14, `/data/backups` |

## First start, in five steps
1. Load the image and start it with `ADMIN_EMAIL` set and `/data` on a persistent volume (`docker-compose.yml` and `kubernetes.example.yaml` are starting points).
2. Put the host name and certificate in front of it (`nginx.example.conf`).
3. Look at the container log. On first start it prints a line **"Administrator … has no password yet. Open …/teacher/set-password?token=…"**. Send that line to Mark, replacing the first part with the real address. It is valid for 7 days; restarting the container prints a fresh one.
4. Check `https://<host>/healthz` answers `ok`.
5. Mark does the rest himself: he sets his password and creates the lecturer accounts in the app.

## What you do not have to do
- No accounts, LDAP or single sign-on for now (lecturer accounts are created by Mark inside the app; LDAP could be added later).
- No database server, no mail server, no outbound connections. The app cannot send email; Mark sends the account links himself.
- No changes to the application. Updates are a new image (see `RUNBOOK.md`).

## What you receive
- The image file `collab-writing-image.tar.gz`, built by GitHub from the repository `battyaggie/CollabWriting`, branch `container-backend` (`docker load < collab-writing-image.tar.gz`). Every build runs the automatic tests and starts the image once as a check. Alternatively the same image is in GitHub's container registry.
- This folder: `RUNBOOK.md` (operation, updates, backup/restore), `SECURITY.md` (what it does and does not protect), `DATA-PROTECTION.md` (what personal data exists; for your data protection officer), `docker-compose.yml`, `kubernetes.example.yaml`, `nginx.example.conf`.
- The full source code, if you want to review it. It has no dependencies on outside services; the server itself uses only what ships with Node.js.

## Questions we would like answered
1. Host name and certificate, and who sets up the reverse proxy.
2. Where backups should be copied to (the app keeps 14 daily copies *inside* `/data`; those do not protect against loss of the volume).
3. Whether the data protection officer needs anything beyond `DATA-PROTECTION.md`, and how long class data may be kept.
