import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

initializeApp();
const anthropicApiKey = defineSecret("ANTHROPIC_API_KEY");
// The shared read-only "site password" for guest access. Kept as a deploy-time secret so the
// literal never lives in source control or the client bundle. Set it with:
//   firebase functions:secrets:set GUEST_PASSWORD
// and locally via GUEST_PASSWORD in functions/.secret.local (see .secret.local.example).
const guestPassword = defineSecret("GUEST_PASSWORD");

function extractJSON(text: string): any {
  let t = text.trim().replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();
  const start = t.indexOf("{");
  const startArr = t.indexOf("[");
  const s = start === -1 ? startArr : (startArr === -1 ? start : Math.min(start, startArr));
  if (s > 0) t = t.slice(s);
  const lastCurly = t.lastIndexOf("}");
  const lastSq = t.lastIndexOf("]");
  const e = Math.max(lastCurly, lastSq);
  if (e > -1 && e < t.length - 1) t = t.slice(0, e + 1);
  return JSON.parse(t);
}

async function callClaude(apiKey: string, promptText: string, maxTokens: number): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: promptText }],
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${errText}`);
  }
  const data: any = await res.json();
  return (data.content || []).map((b: any) => b.text || "").join("\n");
}

function buildDescriptionPrompt(
  title: string,
  postType: string,
  category: string,
  eventDate: string,
  notes: string
): string {
  const eventLine = eventDate ? `\nDate: ${eventDate}` : "";
  const notesBlock = notes.trim()
    ? `The author already jotted down some rough notes — polish and expand these into a warm, conversational paragraph. Do not invent facts, names, or details beyond what's in these notes:\n"""${notes.trim()}"""`
    : `The author hasn't written anything yet. Write a short, warm, inviting paragraph based only on the title/category/type below — keep it generic (no invented names, numbers, or specific details) since this is just a starting draft they'll personalize.`;
  return `You are helping a family member write a short description for a post in their private family newsletter.

Post title: ${title}
Type: ${postType}
Category: ${category}${eventLine}

${notesBlock}

Write ONE short paragraph (2-4 sentences), warm and conversational in tone, suitable to post as-is or lightly edit. Respond with ONLY the paragraph text — no preamble, no quotes, no markdown, no labels.`;
}

function buildGeneratePrompt(posts: unknown[], period: string, familyName: string): string {
  const periodWord = period === "monthly" ? "month" : "week";
  return `You are the AI editor of "${familyName} Weekly", a private family newsletter. Below is JSON of posts submitted for this ${periodWord}'s issue. Use ONLY facts present in these posts — never invent details, names, or events that are not here. Every "Upcoming Event" post given to you already falls within this ${periodWord}, so include all of them in upcomingEvents.

Posts:
${JSON.stringify(posts, null, 2)}

Rules:
- Pick exactly one "hero story": the most emotionally significant or family-impactful post (new baby, wedding, graduation, reunion, major trip, etc. — otherwise pick the most noteworthy). Never pick a "Classifieds" post as the hero story — those are just items being given away or sold.
- Write a short, punchy "heroHeadline" for the hero story (do not write a summary — the post's own caption will be shown verbatim).
- Write a warm "weeklySummary" (1 paragraph, conversational, mentions 2-3 highlights by name) — use this field name even for a monthly issue.
- Group remaining posts of type "Upcoming Event" into upcomingEvents, "General Announcement" into familyUpdates, "Event Recap" into eventRecaps, "Classifieds" into classifieds, each with a short headline/title only (no summary — each post's own caption will be shown verbatim). Do not repeat the hero post in these groups.
- Write a 1-sentence warm "closing".
- Every headline must be traceable to a real submitted post. Reference the original post id in "postId" fields.

Respond with ONLY raw JSON, no markdown fences, no preamble, in exactly this shape:
{
  "heroPostId": "id of the hero post",
  "heroHeadline": "...",
  "weeklySummary": "1 paragraph",
  "upcomingEvents": [{"postId":"...", "title":"...", "date":"YYYY-MM-DD", "location":""}],
  "familyUpdates": [{"postId":"...", "headline":"..."}],
  "eventRecaps": [{"postId":"...", "headline":"..."}],
  "classifieds": [{"postId":"...", "headline":"..."}],
  "closing": "1 sentence"
}`;
}

export const runAIEditor = onCall({ secrets: [anthropicApiKey], cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }
  if (request.auth.token.firebase?.sign_in_provider === "anonymous") {
    throw new HttpsError("permission-denied", "Sign in to use Javier AI.");
  }

  const { type, payload } = request.data || {};
  const apiKey = anthropicApiKey.value();

  if (type === "draft_description") {
    const { title, postType, category, eventDate, notes } = payload || {};
    if (!title || !String(title).trim()) {
      throw new HttpsError("invalid-argument", "title is required.");
    }
    console.log(`runAIEditor: draft_description start, uid=${request.auth.uid}`);
    try {
      const text = await callClaude(
        apiKey,
        buildDescriptionPrompt(
          String(title || ""), String(postType || ""), String(category || ""),
          String(eventDate || ""), String(notes || "")
        ),
        400
      );
      console.log("runAIEditor: draft_description success");
      return { description: text.trim() };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`runAIEditor: draft_description failed - ${message}`);
      throw new HttpsError("internal", "Javier AI hit a snag.", message);
    }
  }

  if (type !== "generate") {
    throw new HttpsError("invalid-argument", "type must be 'generate' or 'draft_description'.");
  }

  const userSnap = await getFirestore().collection("users").doc(request.auth.uid).get();
  if (!userSnap.exists || userSnap.data()?.isAdmin !== true) {
    throw new HttpsError("permission-denied", "Only admins can generate newsletters.");
  }

  const { posts, period, familyName } = payload || {};
  if (!Array.isArray(posts) || !posts.length) {
    throw new HttpsError("invalid-argument", "posts array required.");
  }

  // Scale the token budget with post count so larger issues don't get their JSON cut off mid-response.
  const maxTokens = Math.min(8192, 1200 + posts.length * 200);
  console.log(`runAIEditor: generate start, uid=${request.auth.uid}, posts=${posts.length}, period=${period}, maxTokens=${maxTokens}`);
  try {
    const text = await callClaude(apiKey, buildGeneratePrompt(posts, period, familyName || "Family"), maxTokens);
    const json = extractJSON(text);
    console.log("runAIEditor: generate success");
    return json;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`runAIEditor: generate failed - ${message}`);
    throw new HttpsError("internal", "The AI editor hit a snag.", message);
  }
});

// Checks the shared guest "site password" without ever exposing it to the client. Called
// unauthenticated (the guest has no account yet); on success the client proceeds to an
// anonymous sign-in, exactly as before. This only gates the guest login UI — Firestore
// rules are what actually enforce read-only access for anonymous users.
export const verifyGuestPassword = onCall({ secrets: [guestPassword], cors: true }, async (request) => {
  const { password } = request.data || {};
  if (typeof password !== "string" || !password) {
    throw new HttpsError("invalid-argument", "Password required.");
  }
  const expected = guestPassword.value();
  if (!expected || password !== expected) {
    throw new HttpsError("permission-denied", "Incorrect password.");
  }
  return { ok: true };
});
