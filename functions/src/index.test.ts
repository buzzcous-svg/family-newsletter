import assert from "node:assert/strict";
import { test } from "node:test";
import { scheduledFirestoreExport } from "./index";

test("scheduledFirestoreExport skips without throwing when FIRESTORE_BACKUP_BUCKET is unset", async () => {
  // No FIRESTORE_BACKUP_BUCKET env var is set in this test process, so the `defineString`
  // param resolves to its documented default (""), exercising the early-return guard rather
  // than attempting a real export. This is the behavior that keeps a missing bucket from
  // crashing the scheduled run at 3am with no way to see why.
  await assert.doesNotReject(() => (scheduledFirestoreExport as unknown as { run: () => Promise<void> }).run());
});
