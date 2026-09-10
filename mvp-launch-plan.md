# Getting Family Newsletter Live — MVP Launch Plan

Based on where the prototype is now, here's the fastest realistic path to a real, hosted app with a real database and real login. This assumes the lightweight stack we discussed: plain HTML/JS talking directly to the Firebase SDK (no React/Next/TypeScript, no build step).

**Decisions baked into this plan (all reversible later):**
- **Auth: email/password only.** No Google sign-in — one less thing to configure, and it's a 10-minute addition later if you ever want it.
- **Newsletter generation stays manual**, exactly like the prototype — no scheduled Cloud Function needed. This alone removes one of the more fiddly pieces of a "full" Firebase build.
- **One Cloud Function**, not several — a single callable function handles both "Improve writing" and "Generate newsletter," since both are just prompts to the AI API. Keeping your AI API key off the client is the one piece of backend logic you can't do in plain JS.

---

## The honest time estimate

| If you work... | Time to live |
|---|---|
| Focused, mostly full-time | **3–4 days** |
| Evenings/weekends | **1.5–2 weeks** |

The UI/UX work is essentially done — that's usually the slowest part of a v1, and you've already skipped it. What's left is plumbing: swapping the prototype's in-memory JavaScript array for real Firestore reads/writes, and adding a real login screen. I'd do this in **Claude Code** rather than back-and-forth in chat, since it's a multi-file build now (rules files, a Cloud Function, the main app file) — happy to help you kick that off when you're ready.

---

## Step-by-step

### 1. Firebase project + Auth — 15–20 min
- Create the project at [console.firebase.google.com](https://console.firebase.google.com)
- **Build → Authentication → Sign-in method → enable Email/Password**
- That's it for this step — no OAuth consent screens, no redirect URIs to configure.

### 2. Firestore data model + security rules — 45–60 min
Three collections, matching what the prototype already has in memory:
```
/users/{uid}            — firstName, lastName, email, isAdmin
/posts/{postId}          — everything currently in state.posts
/newsletters/{issueId}   — everything currently in state.newsletters
```
Rules are the part worth taking slowly, since this is what actually enforces "only I can edit/delete my own posts" — right now that's just a JS `if` check with no teeth. Budget real time here even though it's a short file:
```
match /posts/{postId} {
  allow read: if request.auth != null;
  allow create: if request.auth != null;
  allow update, delete: if request.auth.uid == resource.data.authorId
                         || get(/databases/$(database)/documents/users/$(request.auth.uid)).data.isAdmin == true;
}
```

### 3. Storage rules — 15–20 min
Photos/videos move from in-memory base64 (prototype) to real Storage. Rules just need to require sign-in and cap file size:
```
match /uploads/{allPaths=**} {
  allow read: if true;
  allow write: if request.auth != null && request.resource.size < 25 * 1024 * 1024;
}
```

### 4. Wire the frontend to Firebase — 1–2 days (the bulk of the work)
This is the real lift, and it's mechanical rather than creative — the hard design decisions are already made:
- Add the Firebase SDK via `<script type="module">` from Google's CDN — no npm install.
- Replace every place the app reads `state.posts` with a Firestore `onSnapshot()` listener, so the feed updates live for everyone.
- Replace `state.posts.push(...)` / edits / deletes with `addDoc` / `updateDoc` / `deleteDoc`.
- Replace the file-upload-to-base64 code with a real `uploadBytes()` call to Storage, storing the resulting URL instead of the data URL.
- Add a simple login/sign-up screen (email + password fields, `signInWithEmailAndPassword` / `createUserWithEmailAndPassword`), and gate the rest of the app behind `onAuthStateChanged`.
- Replace the hardcoded `Jamie Alvarez` user object with the real signed-in user's profile doc.

### 5. The one Cloud Function (AI proxy) — 3–4 hrs including testing
```bash
firebase init functions   # choose TypeScript, 2nd gen
firebase functions:secrets:set ANTHROPIC_API_KEY
```
One callable function, `runAIEditor`, that takes a prompt type (`"improve"` or `"generate"`) and the relevant data, calls the AI API server-side using the secret, and returns the result. The client calls it instead of hitting the AI API directly — this is the only reason a "backend" exists at all in this build.

### 6. Test before you touch production — 2–4 hrs
```bash
firebase emulators:start
```
Run through the real flows once — sign up, post, edit, delete, upload a photo, generate an issue — against the emulator, not live data. Catching a bad security rule here costs you nothing; catching it in production costs you a support headache from an actual family member.

### 7. Deploy — 15–30 min
```bash
firebase deploy
```
Since there's no build step, this is close to instant once the code's ready. You'll get a live `.web.app` URL immediately.

### 8. Custom domain — optional, 30 min active + up to 24–48 hrs passive
Firebase Console → Hosting → Add custom domain, then update DNS at your registrar. The DNS propagation wait is passive time, not work time — you're not blocked on anything else.

---

## What I'd explicitly leave out of v1

To keep this at "quickest to live," I'd skip these even though they're in the original PRD — none of them block a working, usable app:
- Reactions/comments (marked "future" in the PRD anyway)
- Tag-and-notify
- Anything beyond the manual "Generate newsletter" button — no scheduled emails
- Google sign-in

## One billing note, repeated because it matters
Cloud Functions require Firebase's **Blaze (pay-as-you-go)** plan — Spark (free tier) doesn't support them, even for a single function used a few times a week. Blaze's free tier is generous enough that a family-sized app should run close to free, but you'll need a credit card on the project before step 5.

---

## Suggested next step

Steps 4–6 are genuinely faster with an agent that can write and test across multiple files at once. I'd move this into **Claude Code**, hand it the current prototype plus this plan, and build it out file by file — that turns "1–2 days" into something closer to a single focused session with you reviewing along the way.
