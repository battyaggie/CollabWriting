# Security summary

Written for IT security. It describes what the application does and, as important, what it does not.
Not penetration-tested or audited by a third party.

## Exposure
- One HTTP port (plain HTTP; **TLS must be done by the reverse proxy**, because passwords and tokens travel over it).
- Intended reach: Eduroam on campus and VPN only. Not meant for the public internet.
- No outbound connections, no external fonts, scripts or trackers. The image can run with no internet access.
- No other open ports, no SSH, no shell service. Process runs as the unprivileged user `node` (uid 1000) and works with a read-only root filesystem and all capabilities dropped (checked on every build).

## Who can do what
| Role | How they get in | What they can do |
|---|---|---|
| Student | Open the page, enter a class code and a nickname. No account. A random identity is created in the browser | Join a class, write in their group while the exercise is open, write feedback under their own identity |
| Lecturer | Account created by an administrator; email + password | Create and run classes, groups, exercises; see their students' texts and feedback |
| Administrator | Same as lecturer, address listed in `ADMIN_EMAIL` | Additionally: approve requests, import lists, issue password links, switch accounts off |

The server enforces this on every write (reads are open, see limitation 1) (`server/rules.mjs`, with automated tests); the screens are not trusted.
Anything not explicitly allowed is refused. A lecturer can only change their own classes. A student can only change their
own roster entry and their own feedback; nobody can change a closed exercise.

## Accounts and passwords
- No self-registration. A lecturer asks for access; an administrator approves (or imports a list). The server answers
  the same way whether or not an address exists, so the form does not reveal who has an account.
- The administrator receives a one-time link (valid 7 days, usable once, only its hash is stored) which the lecturer uses to choose a password.
- Passwords: at least 10 characters, stored only as scrypt hashes with a random salt. Login takes the same time for unknown and known addresses.
- Sign-in token: signed (HMAC-SHA256) with a server secret, stored in the browser. Lecturers 30 days, students 365 days. A switched-off account is refused from its next action on.
- Rate limits (in memory, per instance): 10 password attempts per address and 60 per client address per 15 minutes; 5 access requests per client address per hour; 20 password-link uses per client address per hour. At most 200 open requests.

## Data at rest
- One SQLite file in `/data`. Not encrypted by the application: use encryption of the volume/disk if your rules require it.
- Backups are plain copies of the same database. They contain password hashes and the token secret; protect them like the database.

## Known limitations (please read)
1. **Reading is open on the network; the class code is not a secret.** As in the pilot version, the rules let anyone who can reach the server read classes, texts and feedback (the join page looks classes up by code, and the projector view needs open reading). Anyone on the network who knows a code can join a class under a nickname, and a technically skilled person could list and read other classes' texts. Writing is protected as described above. The network restriction (Eduroam/VPN) and the nickname rule are the mitigation. Reading can be restricted to a class's members and its lecturer; this needs changes to the screens and has not been done.
2. **Single instance.** No clustering or failover. If the container crashes, text typed in the last moments may be lost; service resumes when it restarts.
3. **Token in browser storage.** The sign-in token is kept in the browser's local storage, so a script injection flaw would expose it. The app renders user text through React (escaped by default) and has no raw-HTML rendering; no third-party scripts are loaded. No Content-Security-Policy header is set by the app yet; the proxy can add one.
4. **No audit log** of who changed what beyond what the documents themselves show (author colours, feedback authorship).
5. **No email.** Setup links are handed over by the administrator, so they pass through whatever channel (mail, chat) the administrator uses.
6. **Experimental SQLite module.** The database uses the SQLite built into Node.js 24, which Node still marks as experimental (a warning appears in the log). It has been stable in our tests; the backups reduce the risk.
7. **Not load-tested.** Designed for about 30 students per class and a handful of classes at once.
8. **Passwords reset only by links**; there is no "forgot password" self-service.
9. **Dependencies.** Next.js, React and their packages are installed when the image is built, from the public npm registry (the lock file is not committed yet, so versions are those current at build time). Rebuild the image to pick up security fixes; each build runs the tests.

## Reporting
Security concerns: Mark Adams (see README).
