# CollabWriting

## Standing rules (set by Mark, 22 Nov 2026)

- **Merge automatically.** Mark wants every pull request I open for him in this repo merged right away (squash), without asking again. Then sync the Mac (below).
- **The Mac copy is not maintained.** Mark works on this project only through Claude, so GitHub is the source of truth and the Mac clone is just an old snapshot; do not sync it after merges. Mark plans a weekly backup copy to the Mac (emergencies only), set up as a scheduled task.

## Known issues / to fix later

### Teacher password-link email does not reach Technikum addresses (found 22 Nov 2026)
- The "Send me a password link" button on /teacher/login calls Firebase's standard `sendPasswordResetEmail` (no return address set, so the Vercel domain does not need to be in Firebase's authorized domains). Firebase accepts the request (`sendOobCode` returns 200) and the email arrives at a private GMX address, but it never arrived at Mark's Technikum address (inbox, spam and search checked). Technikum's mail system seems to drop Firebase's default sender `noreply@collab-writing-app.firebaseapp.com`. Other universities may do the same.
- Workaround for now: create or reset a teacher account in the Firebase console (Authentication, Users, Add user) and send the person their details yourself.
- Mark decided to wait for the Technikum-server (container) version before dealing with this fully, since mail may work differently there.
- Reminder: when other lecturers get accounts, email them their login details (address of the app, how to set the password).
- Built (22 Nov 2026, pull request "Admin page: Send email with link"): the administrator page (Vercel version, `src/components/ApprovedTeachers.tsx`) has a "Send email with link" button per approved address. It asks `/api/teacher-access` (action `reset-link`, admins only) for a one-time Firebase password link and opens a ready-made email in Mark's mail program with a CC to the address in the environment variable `NEXT_PUBLIC_ADMIN_COPY_EMAIL` (`adminCopyEmail` in `src/lib/config.ts`; Mark's private address, set in the Vercel project settings; no copy if empty), so he picks the sender and can forward it. Firebase's own email on the login page is unchanged. Firebase reset links only stay valid for a short time, so send it right away.
- Optional, NOT set up yet (22 Nov 2026): the CC copy of that email only happens once `NEXT_PUBLIC_ADMIN_COPY_EMAIL` is set in the Vercel project settings (then redeploy, because it is a build-time variable). Mark is leaving it unset for now to see whether it is needed, and it may be obsolete: he can send the email directly from his own address, which other universities will probably accept, unlike Firebase's sender. Without the variable the email still opens, just with no CC. Remove the CC code if it is still unused later.
- How approval works: approving an address in `src/app/api/teacher-access/route.ts` creates the Firebase account with a random password; the teacher then uses "Send me a password link" to choose one.
