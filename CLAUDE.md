# CollabWriting

## Keep this clone in sync with GitHub

GitHub is the source of truth: changes are often made and merged there (cloud sessions, pull requests) while this Mac clone stays behind. At the start of every session, including a continued one, and again before any build or deploy, before doing other work:

1. Run `git fetch` and compare with `origin/main` (`git status -sb`).
2. If the clone is behind and the working tree is clean, run `git pull --ff-only` and tell Mark in one line what came in.
3. If it is behind and there are local changes, or the pull cannot fast-forward, do not pull. Tell Mark what differs and ask.
4. If it is ahead, say so. Do not push unless asked.
5. If the fetch fails (offline, SSH or network), say so rather than assuming the clone is current.

## Known issues / to fix later

### Teacher password-link email does not reach Technikum addresses (found 22 Nov 2026)
- The "Send me a password link" button on /teacher/login calls Firebase's standard `sendPasswordResetEmail` (no return address set, so the Vercel domain does not need to be in Firebase's authorized domains). Firebase accepts the request (`sendOobCode` returns 200) and the email arrives at batty@gmx.at, but it never arrived at adams@technikum-wien.at (inbox, spam and search checked). Technikum's mail system seems to drop Firebase's default sender `noreply@collab-writing-app.firebaseapp.com`. Other universities may do the same.
- Workaround for now: create or reset a teacher account in the Firebase console (Authentication, Users, Add user) and send the person their details yourself.
- Mark decided to wait for the Technikum-server (container) version before dealing with this fully, since mail may work differently there.
- Reminder: when other lecturers get accounts, email them their login details (address of the app, how to set the password).
- Built (22 Nov 2026, pull request "Admin page: Send email with link"): the administrator page (Vercel version, `src/components/ApprovedTeachers.tsx`) has a "Send email with link" button per approved address. It asks `/api/teacher-access` (action `reset-link`, admins only) for a one-time Firebase password link and opens a ready-made email in Mark's mail program with a CC to batty@gmx.at (`adminCopyEmail` in `src/lib/config.ts`, override with `NEXT_PUBLIC_ADMIN_COPY_EMAIL`), so he picks the sender and can forward it. Firebase's own email on the login page is unchanged. Firebase reset links only stay valid for a short time, so send it right away.
- How approval works: approving an address in `src/app/api/teacher-access/route.ts` creates the Firebase account with a random password; the teacher then uses "Send me a password link" to choose one.
