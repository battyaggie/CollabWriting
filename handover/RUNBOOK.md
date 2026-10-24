# Runbook

Everything IT needs to run, update, back up and restore the container. Commands use Docker; with
Kubernetes the same steps apply to the Deployment and the volume.

## Overview
- One process serves the web pages, the live connections (`/ws`) and the database.
- All data is in `/data` (volume). Container itself keeps nothing; it can be deleted and recreated at any time.
- Health check: `GET /healthz` returns `ok` (HTTP 200). The image has a built-in Docker `HEALTHCHECK`.
- Logs go to the container's standard output. Nothing is written elsewhere.

## Install
```
docker load < collab-writing-image.tar.gz        # prints the image name, e.g. collab-writing:ci
docker compose up -d                              # with handover/docker-compose.yml, after setting ADMIN_EMAIL
docker logs collab-writing | grep set-password    # the one-time link for the administrator (see README)
```

## Update to a new version
1. Make sure a recent backup exists (see below). The app also makes one at every start.
2. Load the new image, then recreate the container with the **same volume**: `docker compose up -d` (Kubernetes: new image tag, the Deployment replaces the pod).
3. Check `/healthz` and that Mark can sign in.
4. **Roll back**: start the previous image again with the same volume. If a release changes the stored data, its notes say so and tell you to restore the pre-update backup instead.

Updates are only needed when Mark asks for new functions or fixes. There is no schedule.

## Backups
- **Automatic**: at start and then every 24 hours the app writes a complete, consistent copy of the database to `/data/backups/collab-writing-<date>T<time>Z.sqlite` and keeps the newest 14. This is safe while the app is running.
- **Please also copy `/data/backups` to your normal backup target** (daily is plenty). Copies inside the same volume do not protect against loss of the volume.
- Do **not** back up by copying the live file `/data/collab-writing.sqlite` while the app runs; it is in WAL mode and the copy may be inconsistent. Use the files in `/data/backups`, or stop the container first.
- Size: a class produces kilobytes to a few megabytes. A whole term for all lecturers is far below 1 GB.

## Restore
1. Stop the container.
2. In the volume, copy the chosen backup over `collab-writing.sqlite` and **delete** `collab-writing.sqlite-wal` and `collab-writing.sqlite-shm` if they exist.
3. Start the container, check `/healthz`.

Everyone is signed out only if the backup is older than their sign-in; sessions are otherwise unaffected.

## Everyday questions
| Situation | What to do |
|---|---|
| Administrator forgot the password | Mark can ask another administrator to issue a new link in the app. If there is none: restart the container with `ADMIN_EMAIL` set; if the account has no password a fresh link is logged. If it does have a password, ask Mark to contact us; this case needs a one-off database change |
| Add another administrator | Add the address to `ADMIN_EMAIL` (comma-separated) and restart; a setup link is logged for the new one |
| A lecturer leaves | Mark switches the account off on the "Teacher accounts" page. Their classes stay until deleted |
| Disk full | The database grows slowly; check `/data/backups`. Lower `BACKUP_KEEP` if needed |
| Students cannot connect, page loads but text does not sync | The proxy is not passing WebSocket on `/ws` (see `nginx.example.conf`) |
| Everyone is rate-limited / "too many attempts" | `TRUST_PROXY=1` is missing, so all users appear to come from the proxy's address |
| Container restarts repeatedly | `docker logs`; usually `/data` is not writable by user 1000 |

## Monitoring (optional)
Poll `/healthz` every minute. Nothing else needs watching. The log shows sign-in problems and backup results
(`Backup written` / `Backup FAILED`).

## Time and clock
Sign-in tokens carry an expiry time. Keep the host clock on NTP.
