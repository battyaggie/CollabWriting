# Personal data in the application

**For the data protection officer (DSB).** This is a technical description of what is stored, not a legal
assessment. The legal basis, retention periods, and whether a data protection impact assessment is needed are
decisions for the university and are listed at the end as open points.

## Purpose
Support English teaching: students write short texts in groups and give each other feedback during class;
lecturers see the results and may use them for feedback and, as announced to students, for grading.

## Where it runs
On a server of FH Technikum Wien only. No data is sent to anyone else: the application makes no
outbound connections, uses no external services (no analytics, fonts, cloud, email provider) and sets no
advertising or tracking cookies.

## What is stored
| Data | About whom | Notes |
|---|---|---|
| Nickname (alias) and a colour | Students | Students are asked to use a **nickname instead of their real name** and not to write personal details; the notice is shown before joining. How a nickname is matched to a person for grading is arranged by the lecturer in class and is **not** recorded in the application |
| A random identifier | Students | Created in the browser on first visit; links a student to their entries within a class |
| Texts written, with who wrote which part | Students | The shared group text; authorship by identifier/colour |
| Feedback comments, with author | Students | Peer feedback; the author is needed for grading |
| Class name, exercise title, group assignments, timestamps | Lecturers/Students | |
| Name and work email address | Lecturers (about 20) | Needed for sign-in and for sending the account link |
| Password (scrypt hash only) | Lecturers | The password itself is never stored |
| Access requests (name, email, date, decision) | Lecturers | Kept in the database |
| Sign-in token | All | Stored **in the user's browser** (local storage), not a cookie. Students 365 days, lecturers 30 days. Needed to stay signed in |

**Not stored:** students' real names or email addresses (unless a student types them into the text, which they are told not to), IP addresses (used only in memory for rate limiting; not written to the database), device or browser details.

**Logs** (container output) contain: start-up messages, errors, and a line when a lecturer requests access (name and email). Log retention is up to IT's logging setup.

## Who can see it
- Students: in the screens, the texts and feedback of their own class/group, plus the other group's text during peer review.
- Lecturers: in the screens, their own classes.
- **Technical caveat:** reading is not restricted on the server. Anyone who can reach the server (Eduroam/VPN) and knows how to query it could read other classes' texts and feedback; only writing is protected. The same applies to the pilot version. See `SECURITY.md`, limitation 1.
- Administrator (Mark Adams): the lecturer account list and requests; technically also the database, as does IT with access to the server.
- IT: the server, the volume and the backups.

## Deletion and retention
- A lecturer can delete a whole class, or a single exercise, in the application, with everything in it (groups, texts, feedback, student list); the data is then removed from the database. Backups keep deleted data until they rotate out (14 daily copies).
- Lecturer accounts can be switched off; there is no function yet to delete an account completely.
- **There is no automatic deletion yet.** If a retention period is required (for example "delete classes after 12 months"), it can be added.

## Rights of data subjects
Access, correction and erasure requests go to the lecturer/administrator, who can find and delete a class's data. Because students are identified only by nickname, a request needs the nickname and class to locate data.

## Open points for the university
1. Legal basis and the entry in the record of processing activities.
2. Retention period for class data and for lecturer accounts; whether an automatic deletion should be built.
3. Whether the notice shown to students needs approved wording. Current text (container version): *"Before you join: this tool runs on a server of FH Technikum Wien. Please use a nickname instead of your real name, and don't write personal details such as your address, phone number or email in your text. Your teacher will tell you how your nickname is matched to you for grading."*
4. Whether a data protection impact assessment is required.
5. Backup target and who has access to backups.

## Pilot version (for comparison)
The current pilot runs on Vercel (hosting) and Google Firebase (database and sign-in). The container version replaces both so that nothing leaves the university.
