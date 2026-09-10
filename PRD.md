# Family Newsletter — Product Requirements Document

**Version:** 1.1
**Last updated:** 2026-09-10
**Changelog:** v1.1 — repo moved to GitHub (public); secrets scrubbed from source: guest password → `GUEST_PASSWORD` Function secret, admin list → `settings/app.adminEmails`. Affects §5, §9, FR-AUTH-07/09, NFR-SEC-05, TD-2, WS-1.4.
**Status:** Live MVP in production; hardening + roadmap phase
**Primary reader:** TPM agent (owns planning, sequencing, risk tracking, and status)
**Live deployment:** https://javierweekly-1fc65.web.app
**Firebase project:** `javierweekly-1fc65`

---

## 1. How to use this document (note to the TPM)

This PRD is the single source of truth for scope and intent. It describes:

- What the product is and who it's for (§2–§5)
- What already exists in the codebase today, and its quality (§6–§9)
- Requirements, each tagged with a status: **DONE** / **PARTIAL** / **TODO** (§10–§11)
- Known tech debt, risks, and decisions that need a human owner (§12–§15)
- A proposed workstream + milestone breakdown for you to own and refine (§16)

Requirement IDs (e.g. `FR-FEED-03`) are stable handles — use them in your plan, issues, and status updates. When you propose changes to scope, reference the ID and note the change here.

**Ground truth is the code, not this doc.** The app is a single file: `public/family-newsletter.html` (~2,750 lines, vanilla JS, no build step). The backend is one Cloud Function: `functions/src/index.ts`. Security is enforced in `firestore.rules` and `storage.rules`. If this doc and the code disagree, flag it.

---

## 2. Product overview

Family Newsletter is a private, invite-only web app where an extended family posts updates, photos, and upcoming events into a shared feed, and a family "editor" (admin) periodically compiles those posts into a designed weekly or monthly newsletter issue — with AI assistance for drafting copy and assembling the issue.

It replaces the ad-hoc group-text / email-thread pattern most families use, giving them:

- A **persistent, searchable feed** instead of a scrolling chat
- A **calendar** of upcoming family events
- A **keepsake newsletter** — a real magazine-style issue, viewable on the web or as a copy-paste HTML email

The product is currently a **single-family deployment** (the "Javier" family). Multi-family / multi-tenant is explicitly future scope (§14).

---

## 3. Goals and non-goals

### 3.1 Goals

| # | Goal |
|---|---|
| G1 | Make it effortless for any family member to contribute an update, photo, or event in under a minute. |
| G2 | Let an admin produce a polished newsletter issue in minutes, not hours, using AI to do the first draft of assembly and copy. |
| G3 | Keep the family's content genuinely private — invite-only, no public indexing, no data sold or shared. |
| G4 | Work well for non-technical users of all ages (large tap targets, plain language, screen-reader support). |
| G5 | Run at near-zero cost for a family-sized audience (tens of users, low write volume). |

### 3.2 Non-goals (for the current phase)

- Not a social network — no follower graph, no algorithmic feed, no public profiles.
- Not a real-time chat / messaging product.
- Not a photo-storage / album product (media is attached to posts, not organized independently).
- Not automating email *delivery* yet — the admin still sends the issue manually (§10.6).
- Not multi-tenant yet — one family per deployment.

---

## 4. Success metrics

These are directional (a family-sized app won't produce statistically meaningful funnels). The TPM should instrument what's cheap and track trends, not absolutes.

| Metric | Target signal |
|---|---|
| Contribution breadth | ≥ 60% of invited members post at least once per issue cycle |
| Issue cadence | An issue is generated on a regular rhythm (weekly or monthly) without lapsing > 1 cycle |
| Time-to-publish | Admin goes from "Generate" to a sent issue in < 15 min including edits |
| AI usefulness | Admin keeps the AI-assembled issue with only light edits (no full rewrites) in ≥ 70% of issues |
| Cost | Firebase + Anthropic spend stays within free-tier / < $5 per month |
| Errors | Zero security-rule violations in production logs; < 1% failed uploads |

---

## 5. Personas and roles

| Role | Who | Capabilities |
|---|---|---|
| **Admin** ("family editor") | 1–3 designated people. Defined by `settings/app.adminEmails` (a lowercased email array), editable from Profile → Admin settings. Client and `firestore.rules` both read that one doc. | Everything a member can do, plus: generate newsletters, edit/delete any post, edit/delete any issue, set the family name, edit the admin list, manage the invite list, view all member emails. |
| **Member** | Any invited family member with an email/password account. | Create/edit/delete their **own** posts; add photos/videos to anyone's **Event Recap** posts; read the feed, calendar, and all issues; edit their own profile name. |
| **Guest** | Anyone who knows the shared site password. It is verified server-side by the `verifyGuestPassword` Function (secret `GUEST_PASSWORD`); on success the client starts an anonymous session. | **Read-only**: feed, calendar, issues. Cannot post, edit, comment, or see the profile/admin area. Prompted to log in for write actions. Note: anonymous sign-in itself is not otherwise restricted, so this gates the UI, not the data — Firestore rules do that. |
| **Uninvited visitor** | Has the app URL but no account and no site password. | Sees only the login / sign-up screen. Sign-up with a non-invited email is rejected and the auth account is deleted. |

**Role transitions:** Admin status self-heals on every sign-in against `settings/app.adminEmails`. Promote/demote = edit that list in Profile → Admin settings; it takes effect on that person's next sign-in, no redeploy. Removing an email does **not** clear an already-set `users/{uid}.isAdmin` flag, so an existing admin keeps access until that flag is also cleared (no self-serve "demote now" yet).

---

## 6. Current architecture

| Layer | Choice | Notes |
|---|---|---|
| Frontend | Single static HTML file, vanilla ES modules, **no build step, no framework**. Firebase Web SDK v10.13.2 from `gstatic` CDN. | Hand-rolled `state` object + full-tree `render()` on every change and every Firestore snapshot. Deliberately lightweight; see `mvp-launch-plan.md`. |
| Hosting | Firebase Hosting, SPA rewrite all paths → `/family-newsletter.html`, `Cache-Control: no-cache`. | |
| Auth | Firebase Auth: Email/Password + Anonymous (guests). No OAuth. | |
| Database | Cloud Firestore, real-time `onSnapshot` listeners on whole collections (no pagination). | Collections: `users`, `invites`, `posts`, `newsletters`, `settings/app`. |
| File storage | Firebase Storage under `uploads/{uid}/…`. 25 MB cap, `image/*` or `video/*` only. Public read. | |
| Backend | One 2nd-gen callable Cloud Function `runAIEditor` (Node 20, `firebase-functions` v6). Requires Blaze plan. | Proxies the Anthropic API so the key never touches the client. |
| AI | Anthropic Messages API, model `claude-sonnet-5`. Key in Secret Manager (`ANTHROPIC_API_KEY`); local dev via `functions/.secret.local`. | Two prompt modes: `draft_description`, `generate`. |
| Local dev | Full Firebase Emulator Suite (auth 9099, firestore 8080, storage 9199, functions 5001, hosting 5000, UI 4000). Bundled JRE in `.tooling/`. | |
| Source control | **None — the project is not a git repository.** | See RISK-1. |
| CI/CD | None. Deploy is manual `firebase deploy`. | |
| Tests | None automated. | |

### 6.1 `runAIEditor` contract

Callable, auth required, anonymous users rejected.

- **`type: "draft_description"`** — input `{title, postType, category, eventDate, notes}`. Returns `{description}`. Any signed-in real user may call it. Warm, 2–4 sentence paragraph; the prompt forbids inventing facts beyond the user's notes.
- **`type: "generate"`** — **admin only** (re-checked against Firestore `users/{uid}.isAdmin`). Input `{posts[], period, familyName}`. Returns issue JSON: `{heroPostId, heroHeadline, weeklySummary, upcomingEvents[], familyUpdates[], eventRecaps[], classifieds[], closing}`. Token budget scales with post count. Response parsed with a best-effort `extractJSON()` (strips code fences, slices to outermost braces).
- The client **never** trusts the AI for post captions — section item summaries are always overwritten with the original post's `description` verbatim. A Classifieds post can never become the hero (client-side guard even if the model ignores the instruction).

---

## 7. Data model (as built)

> Field lists are derived from write sites in the code, not a formal schema. There is no server-side schema validation beyond security rules.

### `users/{uid}`
`firstName`, `lastName`, `email` (must equal the auth token email), `isAdmin` (bool; must equal bootstrap-email check at write time), `profilePhoto` (nullable; read by UI, no upload path wired yet).

### `invites/{emailLowercased}`
`email`, `invitedAt` (ISO date), `invitedBy` (admin email), `usedAt` (nullable), `usedByUid` (nullable). Doc ID is the invited email. `get` is public (so signup can check); `list` is admin-only. The invited user may flip `usedAt` + `usedByUid` on their own invite exactly once.

### `posts/{autoId}`
`authorId`, `authorName` (denormalized `First Last`), `title`, `description`, `postType` (`Upcoming Event` | `General Announcement` | `Event Recap` | `Classifieds`), `category` (one of 15 emoji-keyed categories), `eventDate` (ISO date or null; required for Upcoming Event / Event Recap), `media[]` (`{id, type: 'image'|'video', url}`), `featuredMediaId` (nullable), `createdAt` (ISO date), `createdAtMs` (epoch ms, for stable sort; older docs fall back to `createdAt`), `updatedAt` (optional), `newsletterIds[]` (which issues this post appears in — maintained by hand in batch writes).

**Cross-post rule:** any signed-in real user may update **only** `media` + `featuredMediaId` on someone else's post **if** `postType === 'Event Recap'`. Everything else: author or admin only.

### `newsletters/{autoId}`
`issueNo`, `date` (ISO), `period` (`weekly` | `monthly`), `periodStart`, `periodEnd`, `title`, `heroPostId` (nullable), `heroImage` (URL; falls back to `picsum.photos` seed), `heroHeadline`, `heroSummary` (post description verbatim), `weeklySummary`, `upcomingEvents[]` (`{postId, title, date, location, summary}`), `familyUpdates[]` / `eventRecaps[]` / `classifieds[]` (`{postId, headline, summary}`), `closing`. Admin-only for all writes.

### `settings/app`
`familyName` (string). Admin-only write, any signed-in read.

---

## 8. What exists today — feature inventory

| Area | Built and working |
|---|---|
| **Auth** | Email/password login + signup; invite-only enforcement (client + rules); bootstrap-admin auto-grant/self-heal; guest access via shared site password → anonymous auth; uninvited-signup rejection with auth-account cleanup; friendly error mapping. |
| **Home feed** | Magazine-style post list; filter chips (All / 4 types); sort (recent / earliest); "Happening Today" highlight + pinning to top; per-post edit/delete for owner+admin; "Add more photos" for Event Recaps by non-owners; category pill; reading-time estimate; empty states. |
| **Post detail** | Modal with media carousel (keyboard + arrow nav), category, byline, date, reading time, full description. |
| **Create / edit post** | Title, type, category, conditional event-date field, description, multi-file photo/video upload with progress, per-image "featured" star, remove media, edit existing post (prefilled), validation. |
| **Javier AI (description)** | "✨ Javier AI" button drafts/expands the description from title + type + category + notes via `runAIEditor`. |
| **Calendar** | Month grid, prev/next navigation, posts placed on their event date (or created date), click a day-entry to open the post, "today" cell highlight. |
| **Newsletters — list** | Grid of issue cards (hero image, period, date, story count); admin "Generate newsletter" bar with weekly/monthly modal showing candidate post counts; admin delete-issue (also strips `newsletterIds` back-refs via batch). |
| **Newsletters — generate** | Rolling ±7-day ("week") or ±31-day ("month") window centered on today; sends compact post list to `runAIEditor`; builds issue doc; empty-shell issue if no posts in window; batch-writes issue + post back-refs; opens the new issue. |
| **Newsletters — issue view (web)** | Header, hero block with media thumbnails, weekly summary, four section grids (Upcoming Events / Family Updates / Recaps / Classifieds), closing line. Click any story → post detail. |
| **Newsletters — issue view (email)** | Table-based HTML email render; per-image background gradient sampled from the photo's own colors on a canvas (with cropped-photo fallback for email clients / CORS-tainted images); "Copy email" writes rich HTML + plain-text alternative to the clipboard; "View Full Newsletter" deep link (`?issue=<id>`). |
| **Newsletters — issue edit (admin)** | Inline edit of title, hero (post picker + headline + summary), weekly summary, closing; per-section add / remove / reorder items with a candidate-post dropdown (a post used anywhere in the issue is excluded everywhere); every edit persists to Firestore immediately. |
| **Profile** | Edit first/last name. **Admin:** set family name; add invite by email (no email is actually sent — admin notifies out-of-band); list members + pending invites; remove invite (with "they already signed up" warning); copy one / copy all member emails. Sign out. |
| **Real-time** | All views live-update via `onSnapshot`; issue deep-link resolves once newsletters load. |
| **Accessibility** | Skip-link; sticky-header scroll-padding (measured once, re-measured on resize); `role="dialog"` + focus-trap + focus-restore on all 4 modals; keyboard-activatable non-native controls; documented WCAG contrast choices; `aria-live` toast; `aria-current` on active tab. |

---

## 9. Environments and access the TPM will need

| Item | Detail / who holds it |
|---|---|
| Firebase project owner | Project `javierweekly-1fc65`. Needs Blaze billing active (required for Functions). Owner: project holder (buzzco.us@gmail.com / stevenlazatin). |
| Anthropic API key | Stored in Secret Manager as `ANTHROPIC_API_KEY`. Local: `functions/.secret.local` (gitignored). |
| Deploy | Manual `firebase deploy` from a machine logged into `firebase-tools`. |
| Admin emails | `settings/app.adminEmails` in Firestore, edited via Profile → Admin settings. Must be seeded once after the scrub (see README "Configuration"). Not in source. |
| Site (guest) password | Firebase Function secret `GUEST_PASSWORD` (`firebase functions:secrets:set GUEST_PASSWORD`); local dev via `functions/.secret.local`. Not in source or the client bundle. |
| Local tooling | Firebase CLI `^13.29`, Node 20 for functions, bundled JRE in `.tooling/` for the emulators. |

---

## 10. Functional requirements

Status legend: **DONE** = implemented and in production · **PARTIAL** = partly implemented / has known gaps · **TODO** = not started.

### 10.1 Accounts & access

| ID | Requirement | Status |
|---|---|---|
| FR-AUTH-01 | Users sign in with email + password. | DONE |
| FR-AUTH-02 | Signup is invite-only; a non-invited email cannot create a usable account, enforced in security rules (not just UI). | DONE |
| FR-AUTH-03 | Admins are defined by a bootstrap email list and re-synced on every sign-in. | DONE |
| FR-AUTH-04 | Guests may enter with a shared site password for read-only access. | DONE |
| FR-AUTH-05 | Admins can invite a user by email from the Profile screen. | DONE |
| FR-AUTH-06 | The invite flow should optionally send the invitee an actual email (currently manual/out-of-band). | TODO |
| FR-AUTH-07 | Provide an in-app way to promote/demote admins without editing code. | PARTIAL — an "Admin emails" list in Profile → Admin settings adds/removes admins with no redeploy. Still missing: immediate demote (clearing a live `isAdmin` flag) and a proper member-picker UI. |
| FR-AUTH-08 | Password reset ("forgot password") flow. | TODO |
| FR-AUTH-09 | Rotatable guest access that isn't a string embedded in client JS. | DONE — guest password is now the `GUEST_PASSWORD` Function secret, checked by `verifyGuestPassword`; rotate with `firebase functions:secrets:set`. |
| FR-AUTH-10 | Account deletion / "remove this member" (revokes access, handles their content). | TODO |

### 10.2 Home feed

| ID | Requirement | Status |
|---|---|---|
| FR-FEED-01 | Show all posts newest-first by default, with an earliest-first toggle. | DONE |
| FR-FEED-02 | Filter by post type (All, Upcoming Event, Event Recap, General Announcement, Classifieds). | DONE |
| FR-FEED-03 | Pin "Happening Today" upcoming events to the top with a visible badge. | DONE |
| FR-FEED-04 | Each post row shows featured media, title, 2-line description, author, date, category. | DONE |
| FR-FEED-05 | Owner and admin see edit/delete on a post; others don't. | DONE |
| FR-FEED-06 | Sidebar shows latest issue promo + grouped upcoming events + a share CTA. | DONE |
| FR-FEED-07 | Feed loads the entire `posts` collection with no pagination. | PARTIAL — acceptable at family scale; revisit before multi-tenant or >~500 posts. |
| FR-FEED-08 | Full-text / keyword search across posts. | TODO |

### 10.3 Posts

| ID | Requirement | Status |
|---|---|---|
| FR-POST-01 | Create a post with title, type, category, optional event date, description. | DONE |
| FR-POST-02 | Attach multiple photos/videos; pick a featured image. | DONE |
| FR-POST-03 | Edit and delete own posts; admin can edit/delete any. | DONE |
| FR-POST-04 | Any member can add photos/videos to any **Event Recap** post without altering its text. | DONE |
| FR-POST-05 | AI-assisted description drafting from the user's notes. | DONE |
| FR-POST-06 | Client + rules validation: required title/type; event date required for dated types. | PARTIAL — enforced client-side and via rules for ownership; no server-side field/shape validation. |
| FR-POST-07 | Media has no server-side transcoding, thumbnailing, or EXIF stripping. | TODO — decide if needed (privacy: EXIF GPS; cost/perf: large originals served directly). |
| FR-POST-08 | Content reporting / moderation path. | TODO — likely unnecessary for one trusted family; confirm. |

### 10.4 Calendar

| ID | Requirement | Status |
|---|---|---|
| FR-CAL-01 | Month grid with prev/next, posts on their relevant date, today highlighted. | DONE |
| FR-CAL-02 | Click a calendar entry to open that post. | DONE |
| FR-CAL-03 | Week / agenda views. | TODO |
| FR-CAL-04 | Export to iCal / Google Calendar subscribe. | TODO |

### 10.5 Newsletter generation & editing

| ID | Requirement | Status |
|---|---|---|
| FR-NL-01 | Admin generates a weekly or monthly issue; a modal previews which posts each window would include. | DONE |
| FR-NL-02 | AI selects a hero story, writes the summary + closing, and buckets remaining posts into four sections. | DONE |
| FR-NL-03 | Post captions in an issue always use the author's original text verbatim (AI never rewrites them). | DONE |
| FR-NL-04 | A Classifieds post can never be the hero. | DONE |
| FR-NL-05 | Generating with no posts in the window still produces a valid empty issue. | DONE |
| FR-NL-06 | A post can appear in multiple issues; `newsletterIds` back-refs are kept in sync on generate, edit, and delete. | PARTIAL — logic exists but is maintained by hand across several batch sites; fragile (see TD-4). |
| FR-NL-07 | Admin can fully edit an issue: all prose fields, hero, and per-section add/remove/reorder. | DONE |
| FR-NL-08 | The "week"/"month" windows are rolling ±7 / ±31 days centered on today, not calendar-aligned. | PARTIAL — intentional but non-obvious; confirm this is the desired behavior (DECISION-3). |
| FR-NL-09 | Non-admins can read every issue. | DONE |
| FR-NL-10 | Issue generation is only ever manual (no schedule). | DONE (by design; automation is FR-NL-13). |
| FR-NL-11 | AI JSON response is parsed defensively; malformed output degrades gracefully. | PARTIAL — `extractJSON` is heuristic; a hard parse failure surfaces a toast and aborts. No retry/repair. |
| FR-NL-12 | Regenerate / re-run AI on an existing issue. | TODO |
| FR-NL-13 | Optional scheduled generation (e.g. "draft the weekly issue every Friday"). | TODO |

### 10.6 Newsletter delivery

| ID | Requirement | Status |
|---|---|---|
| FR-SEND-01 | Issue renders as a table-based HTML email with a plain-text alternative. | DONE |
| FR-SEND-02 | "Copy email" puts rich HTML + plain text on the clipboard for the admin to paste into their mail client. | DONE |
| FR-SEND-03 | Per-image background gradients sampled from photo colors, with fallbacks for email clients and CORS-tainted images. | DONE |
| FR-SEND-04 | Deep link from the email back to the full web issue. | DONE |
| FR-SEND-05 | Send the issue to the family list directly from the app (ESP integration: Resend / Postmark / SendGrid). | TODO — biggest single UX gap; admin currently pastes into Gmail by hand. |
| FR-SEND-06 | Track who received / opened an issue. | TODO |
| FR-SEND-07 | Per-member email preferences / unsubscribe. | TODO |

### 10.7 Profile & admin settings

| ID | Requirement | Status |
|---|---|---|
| FR-PROF-01 | Edit own first/last name. | DONE |
| FR-PROF-02 | Upload a profile photo. | PARTIAL — `profilePhoto` is rendered if present but there is no upload UI. |
| FR-PROF-03 | Admin sets the family name (drives titles + masthead). | DONE |
| FR-PROF-04 | Admin manages invites and views/copies member emails. | DONE |
| FR-PROF-05 | Admin dashboard: per-member post counts, last active, issue history. | TODO |

### 10.8 Cross-cutting

| ID | Requirement | Status |
|---|---|---|
| FR-X-01 | All data views update in real time. | DONE |
| FR-X-02 | Works on mobile (responsive down to ~360px). | DONE |
| FR-X-03 | Keyboard-operable; screen-reader-friendly modals, nav, and controls. | DONE (self-assessed; no formal audit — see NFR-A11Y-02). |
| FR-X-04 | Offline / poor-connection resilience beyond Firestore's built-in cache. | TODO |
| FR-X-05 | Localization / non-English families. | TODO |

---

## 11. Non-functional requirements

### 11.1 Security & privacy

| ID | Requirement | Status |
|---|---|---|
| NFR-SEC-01 | Every write path is enforced in `firestore.rules` / `storage.rules`, independent of the UI. | DONE |
| NFR-SEC-02 | The Anthropic key is never exposed to the client. | DONE |
| NFR-SEC-03 | Guests (anonymous auth) cannot write anything, even calling the SDK directly. | DONE |
| NFR-SEC-04 | Content is not publicly indexable; no data is shared with third parties beyond Anthropic (post text sent for issue generation) and Google (Firebase). | PARTIAL — true today; should be stated in a short privacy note for the family, and the Anthropic data flow disclosed. |
| NFR-SEC-05 | The guest password should be server-controlled and rotatable, not a client-side constant. | DONE — moved to a Function secret (FR-AUTH-09). |
| NFR-SEC-06 | Storage objects are world-readable by URL (`allow read: if true`). URLs are unguessable but permanent. | PARTIAL — accept or tighten to signed/authped reads (DECISION-4). |
| NFR-SEC-07 | Rate-limiting / abuse protection on `runAIEditor`. | TODO — low risk (auth-gated, small user base) but unbounded cost exposure. |
| NFR-SEC-08 | EXIF/GPS metadata stripped from uploaded photos. | TODO (ties to FR-POST-07). |
| NFR-SEC-09 | Dependency and rules review before each deploy. | TODO — no process today. |

### 11.2 Accessibility

| ID | Requirement | Status |
|---|---|---|
| NFR-A11Y-01 | Target WCAG 2.1 AA for all core flows. | PARTIAL — substantial work done and documented inline; not verified. |
| NFR-A11Y-02 | Run an actual audit (axe / Lighthouse / screen-reader pass) and log findings as issues. | TODO |

### 11.3 Performance

| ID | Requirement | Status |
|---|---|---|
| NFR-PERF-01 | First meaningful render < 2s on a mid-range phone on 4G. | PARTIAL — single file, CDN SDK; no measurement. LCP images (issue hero, promo) are eager, rest lazy. |
| NFR-PERF-02 | Full-tree re-render on every state change / snapshot is acceptable at family scale. | PARTIAL — true now; a known ceiling. Revisit if a family has hundreds of active posts. |
| NFR-PERF-03 | Media is served at original resolution/size. | PARTIAL — fine for a few users; a resize/CDN-transform step would cut bandwidth and improve mobile. |

### 11.4 Reliability & operability

| ID | Requirement | Status |
|---|---|---|
| NFR-OPS-01 | Source control with history and reviewable changes. | TODO — **the project is not in git** (RISK-1). |
| NFR-OPS-02 | Automated tests for security rules and the `runAIEditor` contract. | TODO — none exist. |
| NFR-OPS-03 | CI that runs rules tests + a build/typecheck of `functions` on every change. | TODO |
| NFR-OPS-04 | Staging environment separate from the family's live data. | TODO — emulators only; deploys go straight to prod. |
| NFR-OPS-05 | Error monitoring (client + function) beyond `console` and Cloud Logging. | TODO |
| NFR-OPS-06 | Documented deploy + rollback runbook. | TODO |
| NFR-OPS-07 | Firestore backup / export schedule. | TODO |

### 11.5 Cost

| ID | Requirement | Status |
|---|---|---|
| NFR-COST-01 | Stay within Firebase Blaze free allowances for a family-sized load. | PARTIAL — expected, unmonitored. Set a budget alert. |
| NFR-COST-02 | Anthropic spend bounded and visible. | PARTIAL — token budget is capped per call; no overall cap/alert. |

---

## 12. Known tech debt

| ID | Item | Impact | Notes |
|---|---|---|---|
| TD-1 | Not a git repository. | Critical | No history, no review, no safe rollback, no collaboration. Fix first. |
| TD-2 | ~~Admin list + guest password duplicated across `family-newsletter.html` and `firestore.rules`.~~ **Mostly resolved** (2026-09-10): guest password → `GUEST_PASSWORD` secret; admin list → `settings/app.adminEmails` read by both client and rules. | Low | Residual: rules now depend on that Firestore doc (a `get()` per user write) and on emails being stored lowercased; a wrong/missing doc silently disables auto-grant (existing admins unaffected). |
| TD-3 | No automated tests, no CI. | High | Every change to rules or the function is validated by hand in the emulator. |
| TD-4 | `posts.newsletterIds` ↔ `newsletters.*[].postId` consistency is maintained manually across ~5 batch-write sites. | Med | Easy to introduce an orphvaned back-ref; no reconciler. |
| TD-5 | `extractJSON()` heuristic parsing of AI output. | Med | Model formatting drift can break generation; no repair/retry loop. |
| TD-6 | Whole-collection `onSnapshot` + full re-render on every change. | Low now | Fine at current scale; a hard ceiling for growth. |
| TD-7 | Newsletter hero falls back to `picsum.photos` random images when no post image exists. | Low | A "real" issue can show a stock photo; may confuse. Consider a branded placeholder. |
| TD-8 | `SAMPLE_VIDEO` / `img()` / seed helpers and a "legacy, unused" card CSS block remain in the file. | Low | Dead-ish code; clean up when touching that area. |
| TD-9 | No `profilePhoto` upload path though the field is read in 3 places. | Low | Half-wired feature. |
| TD-10 | Single 2,750-line HTML file. | Low/Med | Intentional (see launch plan) but approaching the size where module splitting pays off. |

---

## 13. Risks

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| RISK-1 | No version control — a bad edit to the live file or rules is unrecoverable. | High | High | **Milestone 0:** `git init`, push to a private remote, protect the deploy path. |
| RISK-2 | Security rules regression ships unnoticed (no tests). | Med | High | Add `@firebase/rules-unit-testing` suite; gate deploy on it. |
| RISK-3 | Anthropic API change / model deprecation breaks description + generation. | Med | Med | Pin model, add contract test, handle non-JSON gracefully, alert on function error rate. |
| RISK-4 | Runaway `runAIEditor` cost (bug or misuse). | Low | Med | Budget alert + simple per-user daily call cap. |
| RISK-5 | Guest password leaks (it's in the client bundle). | High (already effectively public to anyone with the file) | Low–Med | Treat as "anyone with the link + string can read." Move to a rotatable server value if privacy matters more. |
| RISK-6 | Firestore data loss (fat-finger delete, bad migration). | Low | High | Scheduled export; test destructive changes in emulator; staging project. |
| RISK-7 | Single maintainer / bus factor. | Med | Med | The runbook + this PRD + git reduce it. |
| RISK-8 | EXIF GPS in shared photos exposes home locations within the family + anyone with a media URL. | Med | Med | Strip on upload (Cloud Function or client canvas re-encode). |

---

## 14. Out of scope now / future roadmap

Ordered roughly by likely value. None are committed.

1. **Direct email send** (FR-SEND-05) — ESP integration so the admin sends the issue from the app. *Highest-value single feature.*
2. **Reactions & comments** on posts (explicitly deferred in the original plan).
3. **Tag-and-notify** — @-mention a family member, they get an email/push.
4. **Scheduled issue drafting** (FR-NL-13) — a Cloud Scheduler + Function that assembles a draft on a cadence for the admin to review.
5. **Password reset & self-serve profile photo** (FR-AUTH-08, FR-PROF-02).
6. **Multi-family / multi-tenant** — the biggest architectural lift: tenant model, per-family admin bootstrap, data isolation in rules, onboarding flow, billing. Everything currently assumes one family.
7. **Google sign-in** (deferred; ~10-min add per the launch plan).
8. **Search** across posts and issues.
9. **Calendar export / subscribe** (FR-CAL-04).
10. **Native push / PWA install**.
11. **Localization**.

---

## 15. Open decisions (need a human owner — surface these early)

| ID | Decision | Why it matters |
|---|---|---|
| DECISION-1 | Is this staying single-family, or is multi-tenant a near-term goal? | Reshapes auth, rules, data model, and roughly every roadmap estimate. |
| DECISION-2 | Priority order for the roadmap — is "direct email send" the next thing, or hardening (git/CI/tests) first? | The PRD assumes **hardening first** (Milestone 0–1), then email send. Confirm. |
| DECISION-3 | Keep the rolling ±7 / ±31-day newsletter windows, or switch to calendar-aligned weeks/months? | Affects which posts land in an issue and how the admin reasons about cadence. |
| DECISION-4 | Storage objects: keep public-by-URL, or move to authenticated/signed reads? | Privacy vs. simplicity (email images need to load for logged-out recipients — public URLs make that trivial). |
| DECISION-5 | Disclose the Anthropic data flow to the family (post text leaves Google infra for issue generation)? Draft a one-paragraph privacy note? | Trust / consent. Low effort, worth doing. |
| DECISION-6 | Acceptable monthly spend ceiling + who owns the billing alert. | Bounds RISK-4 and NFR-COST. |
| DECISION-7 | Formal accessibility bar — "AA, audited" vs. "best effort, no audit"? | Determines whether NFR-A11Y-02 is a milestone or a nice-to-have. |

---

## 16. Proposed workstreams & milestones (TPM to own and refine)

This is a starting structure, not a fixed plan. Adjust sequencing against DECISION-2.

### Milestone 0 — Safety net (do first, ~0.5–1 day)

- WS-0.1 `git init`; commit current state; push to a private remote. (RISK-1 / TD-1 / NFR-OPS-01)
- WS-0.2 Firebase budget alert + Anthropic usage visibility. (RISK-4 / NFR-COST)
- WS-0.3 Write the deploy + rollback runbook from the steps in `mvp-launch-plan.md`. (NFR-OPS-06)
- WS-0.4 Turn on scheduled Firestore export. (RISK-6 / NFR-OPS-07)

**Exit:** every future change is reviewable and revertible; a blown deploy can be rolled back; spend can't surprise anyone.

### Milestone 1 — Correctness & confidence (~2–4 days)

- WS-1.1 Security-rules test suite (`@firebase/rules-unit-testing`): invite gating, admin paths, guest read-only, Event Recap media-only cross-write. (RISK-2 / NFR-OPS-02)
- WS-1.2 `runAIEditor` contract tests: both modes, auth/anon/admin gating, malformed-JSON handling. (TD-5 / NFR-OPS-02)
- WS-1.3 Minimal CI: rules tests + `functions` typecheck/build on push. (NFR-OPS-03)
- WS-1.4 ~~De-duplicate the admin list + guest password into one config source.~~ **Done 2026-09-10** (secret + `settings/app.adminEmails`). Follow-up: consider custom claims so rules don't need a per-write `get()`, and add an immediate-demote path. (TD-2 / FR-AUTH-07)
- WS-1.5 `newsletterIds` reconciler or a single helper that owns both sides of the back-ref. (TD-4 / FR-NL-06)

**Exit:** rules and the AI contract can't silently regress; admin/guest config lives in one place.

### Milestone 2 — Close the top UX gap: direct send (~3–6 days)

- WS-2.1 Choose an ESP (Resend / Postmark) — DECISION-4 interacts (image hosting). 
- WS-2.2 Cloud Function `sendIssue` (admin-only): renders the existing email HTML, sends to the member list, records `sentAt` / recipients on the issue.
- WS-2.3 UI: "Send to family" on a published issue, with a confirm step and a test-send-to-self.
- WS-2.4 Basic send log on the issue. (FR-SEND-05, FR-SEND-06 lite)

**Exit:** an admin publishes and sends an issue without leaving the app.

### Milestone 3 — Polish & hygiene (ongoing / opportunistic)

- WS-3.1 Accessibility audit + fixes. (NFR-A11Y-02)
- WS-3.2 EXIF stripping + optional image resize on upload. (FR-POST-07 / NFR-SEC-08)
- WS-3.3 Password reset flow. (FR-AUTH-08)
- WS-3.4 Profile photo upload. (FR-PROF-02 / TD-9)
- WS-3.5 Branded newsletter placeholder image; remove `picsum` fallback. (TD-7)
- WS-3.6 Dead-code cleanup. (TD-8)
- WS-3.7 Client + function error monitoring. (NFR-OPS-05)
- WS-3.8 Short privacy note for the family (incl. Anthropic disclosure). (DECISION-5 / NFR-SEC-04)

### Milestone 4+ — Roadmap features

Pull from §14 per DECISION-1 and DECISION-2. Multi-tenant, if chosen, is its own multi-milestone effort and should get a dedicated design doc before any code.

---

## 17. Appendix — file map

| Path | Purpose |
|---|---|
| `public/family-newsletter.html` | The entire frontend: markup, styles, state, rendering, handlers, Firebase wiring. |
| `functions/src/index.ts` | The `runAIEditor` callable function (description drafting + issue generation). |
| `functions/lib/` | Compiled output (gitignored). |
| `firestore.rules` | All Firestore authz — the real enforcement layer. |
| `storage.rules` | Upload authz: signed-in non-anon, 25 MB, images/videos only. |
| `firestore.indexes.json` | Empty — no composite indexes needed yet. |
| `firebase.json` | Hosting (SPA rewrite, no-cache), functions, emulator ports. |
| `.firebaserc` | Project alias → `javierweekly-1fc65`. |
| `cors.json` | Storage bucket CORS (GET from the two hosting domains + localhost:5000). |
| `mvp-launch-plan.md` | The original build plan; still an accurate description of the deploy steps and the deliberate scope cuts. |
| `functions/.secret.local(.example)` | Local values for the emulator: `ANTHROPIC_API_KEY`, `GUEST_PASSWORD`. `.example` is committed; `.secret.local` is gitignored. |
| `README.md` | Project overview, local-dev setup, **Configuration** (secrets + admin seeding), and deploy/rollback steps. |
| `.tooling/` | Bundled JRE for the Firestore emulator (gitignored). |

---

*End of PRD v1.1. The TPM should treat §15 (open decisions) and Milestone 0 as the immediate priorities, and update this document — with rationale — whenever scope or sequencing changes.*
