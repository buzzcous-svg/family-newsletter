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
| Backend | One 2nd-gen Cloud Functions codebase, `functions/` (TypeScript, Node 20): `runAIEditor` (Anthropic proxy), `verifyGuestPassword`, and `scheduledFirestoreExport` (daily Firestore backup — see "Firestore backups" below). |
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

## Firestore backups

A scheduled Cloud Function, `scheduledFirestoreExport` (`functions/src/index.ts`), exports every
Firestore collection to Cloud Storage once a day (`America/Los_Angeles`, via
`onSchedule("every 24 hours", ...)`), giving this app a restore path beyond Firestore's own
point-in-time recovery window.

**The function's code is deploy-ready, but three one-time, human setup steps are required before
it actually runs successfully in production — none of these are things a code change can do on
its own:**

1. **Create a dedicated GCS bucket** for backups (do **not** reuse the app's default Storage
   bucket — that bucket is world-readable by URL per `storage.rules`, and backups must not be).
   E.g.:
   ```bash
   gcloud storage buckets create gs://javierweekly-1fc65-firestore-backups \
     --location=us-central1 --uniform-bucket-level-access
   ```
2. **Set a retention/lifecycle policy** on that bucket so exports don't accumulate forever — e.g.
   delete exports older than 30 days:
   ```bash
   cat > /tmp/backup-lifecycle.json <<'EOF'
   {"rule": [{"action": {"type": "Delete"}, "condition": {"age": 30}}]}
   EOF
   gcloud storage buckets update gs://javierweekly-1fc65-firestore-backups \
     --lifecycle-file=/tmp/backup-lifecycle.json
   ```
3. **Grant the Cloud Functions runtime service account export + write access**: the
   `Cloud Datastore Import Export Admin` IAM role (`roles/datastore.importExportAdmin`) on the
   project, plus `Storage Object Admin` (or equivalent write access) on the backup bucket.

Then set the bucket as a deploy parameter and deploy:

```bash
# Firebase prompts for FIRESTORE_BACKUP_BUCKET on deploy if it isn't already set; or set it
# non-interactively via a functions/.env.<project-id> file:
echo 'FIRESTORE_BACKUP_BUCKET=gs://javierweekly-1fc65-firestore-backups' >> functions/.env.javierweekly-1fc65
firebase deploy --only functions
```

If `FIRESTORE_BACKUP_BUCKET` isn't set, the function logs an error and skips the export rather
than failing loudly with no destination.

**Restoring from a backup:**

```bash
gcloud firestore import gs://javierweekly-1fc65-firestore-backups/<export-folder>
```

(list available exports first with `gcloud storage ls gs://javierweekly-1fc65-firestore-backups/`).
An import merges into the live database rather than replacing it outright — for a full restore,
export/back up current data first, then clear the collections you're restoring before importing.

**Verifying it's actually running:** after the first deploy, check Cloud Functions logs
(`firebase functions:log --only scheduledFirestoreExport`) the day after deploy, or check the
Cloud Storage bucket directly for a new dated export folder.
