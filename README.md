# Family Newsletter

A private, invite-only web app where a family posts updates, photos, and events into a shared
feed, and an admin compiles them into a weekly/monthly newsletter issue (web + copy-paste
email), with AI assistance for drafting copy and assembling issues.

- **Live:** https://javierweekly-1fc65.web.app
- **Product spec:** [`PRD.md`](PRD.md)
- **Original build plan:** [`mvp-launch-plan.md`](mvp-launch-plan.md)

## Stack

| | |
|---|---|
| Frontend | One static file, `public/family-newsletter.html` — vanilla ES modules, Firebase Web SDK from CDN, **no build step**. |
| Hosting | Firebase Hosting (SPA rewrite to the single file). |
| Auth | Firebase Auth — email/password + anonymous (guests). |
| Data | Cloud Firestore (`users`, `invites`, `posts`, `newsletters`, `settings/app`). |
| Files | Firebase Storage under `uploads/{uid}/…` (25 MB, images/videos only). |
| Backend | One 2nd-gen Cloud Functions codebase, `functions/` (TypeScript, Node 20): `runAIEditor` (Anthropic proxy) and `verifyGuestPassword`. |
| AI | Anthropic Messages API, model `claude-sonnet-5`. |

## Local development

Requires Node 20 and a JDK (for the Firestore emulator). Firebase CLI is a dev dependency.

```bash
npm install
(cd functions && npm install)

# one-time: local secrets for the emulator
cp functions/.secret.local.example functions/.secret.local
# then edit functions/.secret.local and fill in real values

npm run emulators        # firebase emulators:start
```

Open http://localhost:5000. The app auto-connects to the emulators on `localhost`/`127.0.0.1`.

## Configuration (secrets are not in this repo)

### Function secrets

Set once per environment; used by the Cloud Functions in production:

```bash
firebase functions:secrets:set ANTHROPIC_API_KEY   # Anthropic API key for runAIEditor
firebase functions:secrets:set GUEST_PASSWORD      # shared read-only "site password" for guests
```

Locally, the same two names go in `functions/.secret.local` (gitignored).

### Admin allowlist

Admins are defined by `settings/app.adminEmails` (a lowercased email array) in Firestore, edited
from **Profile → Admin settings** in the running app. There is no admin list in source code.

After a fresh setup, seed it once: sign in as an account that already has `users/{uid}.isAdmin
== true` (or set that flag directly in the Firestore console for the first admin), open
**Profile → Admin settings**, enter the admin emails (one per line), and save. `firestore.rules`
reads the same doc, so changes take effect on each user's next sign-in with no redeploy.

## Deploy

```bash
firebase deploy                       # everything
# or scope it:
firebase deploy --only hosting
firebase deploy --only firestore:rules,storage
firebase deploy --only functions
```

**Before the first deploy that includes the secret scrub:** make sure `GUEST_PASSWORD` is set
(above) — otherwise `verifyGuestPassword` throws and guest login breaks — and seed
`settings/app.adminEmails` so admin auto-grant keeps working. Existing admin accounts keep their
access regardless, because `users/{uid}.isAdmin` is not cleared by any of this.

### Rollback

Hosting: `firebase hosting:rollback`. Rules/functions: redeploy from the previous git commit.

## Reviewable changes & deploy protection

Every change lands on `main` via a pull request, reviewed before merge — never a direct push.
`firebase deploy` is then run manually from an up-to-date `main`, so nothing reaches production
that hasn't gone through review first. This is the process today; two things would make it
enforced rather than just documented, and are flagged here rather than changed silently:

- **Branch protection on `main` is not yet turned on.** Enabling "Require a pull request before
  merging" (Settings → Branches on GitHub) would make the reviewed-PR path mandatory instead of a
  convention. This is a repo setting, not a code change, so it's called out here for a deliberate
  decision rather than flipped automatically.
- **The remote is currently public**, not private. The original plan (`mvp-launch-plan.md`)
  assumed a private remote. Nothing in this repo is secret today (API keys and the guest password
  are Firebase Function secrets, never committed — see "Configuration" above), but visibility is
  a decision worth making explicitly rather than inheriting by default.
