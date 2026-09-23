// Loads the actual recurring-post date-math straight out of public/family-newsletter.html
// (a monolithic script with no build step / module exports) so this exercises the real
// implementation rather than a hand-copied reimplementation that could drift from it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'family-newsletter.html'), 'utf8');

function extract(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start);
  assert.ok(start !== -1 && end !== -1, `markers not found: ${startMarker} / ${endMarker}`);
  return html.slice(start, end);
}

const source =
  extract("const dateToISO = ", "const fmtDate = ") +
  extract("const RECURRENCE_FREQUENCIES = ", "function img(seed)");

const { isRecurringPost, eventOccursOnDate, nextOccurrenceISO } = new Function(
  `${source}\nreturn { isRecurringPost, eventOccursOnDate, nextOccurrenceISO };`
)();

const upcomingEvent = (eventDate, recurring) => ({ postType: 'Upcoming Event', eventDate, recurring });

test('isRecurringPost requires an Upcoming Event with recurring.enabled and a known frequency', () => {
  assert.equal(isRecurringPost(upcomingEvent('2026-01-15', { enabled: true, frequency: 'monthly' })), true);
  assert.equal(isRecurringPost(upcomingEvent('2026-01-15', { enabled: false, frequency: 'monthly' })), false);
  assert.equal(isRecurringPost(upcomingEvent('2026-01-15', null)), false);
  assert.equal(isRecurringPost({ postType: 'General Announcement', eventDate: '2026-01-15', recurring: { enabled: true, frequency: 'monthly' } }), false);
});

test('eventOccursOnDate: non-recurring event matches only its own date', () => {
  const p = upcomingEvent('2026-01-15', null);
  assert.equal(eventOccursOnDate(p, '2026-01-15'), true);
  assert.equal(eventOccursOnDate(p, '2026-02-15'), false);
});

test('eventOccursOnDate: monthly recurrence matches the same day-of-month in later months, never before the anchor', () => {
  const p = upcomingEvent('2026-01-15', { enabled: true, frequency: 'monthly' });
  assert.equal(eventOccursOnDate(p, '2026-01-15'), true);
  assert.equal(eventOccursOnDate(p, '2026-03-15'), true);
  assert.equal(eventOccursOnDate(p, '2025-12-15'), false, 'before the anchor date should never match');
  assert.equal(eventOccursOnDate(p, '2026-02-16'), false);
});

test('eventOccursOnDate: a 31st-anchored monthly event does not falsely match in 30-day months', () => {
  const p = upcomingEvent('2026-01-31', { enabled: true, frequency: 'monthly' });
  assert.equal(eventOccursOnDate(p, '2026-04-31'), false, 'April has no 31st');
  assert.equal(eventOccursOnDate(p, '2026-03-31'), true);
});

test('eventOccursOnDate: yearly recurrence matches month+day in later years only', () => {
  const p = upcomingEvent('2025-06-10', { enabled: true, frequency: 'yearly' });
  assert.equal(eventOccursOnDate(p, '2026-06-10'), true);
  assert.equal(eventOccursOnDate(p, '2026-06-11'), false);
  assert.equal(eventOccursOnDate(p, '2024-06-10'), false, 'before the anchor date should never match');
});

test('nextOccurrenceISO: non-recurring past event has no next occurrence', () => {
  const p = upcomingEvent('2026-01-01', null);
  assert.equal(nextOccurrenceISO(p, new Date(2026, 5, 1)), null);
});

test('nextOccurrenceISO: future (non-recurring) event returns its own date', () => {
  const p = upcomingEvent('2026-12-25', null);
  assert.equal(nextOccurrenceISO(p, new Date(2026, 0, 1)), '2026-12-25');
});

test('nextOccurrenceISO: monthly recurrence rolls forward to the next matching month', () => {
  const p = upcomingEvent('2026-01-15', { enabled: true, frequency: 'monthly' });
  assert.equal(nextOccurrenceISO(p, new Date(2026, 5, 20)), '2026-07-15');
});

test('nextOccurrenceISO: yearly recurrence anchored on Feb 29 skips non-leap years', () => {
  const p = upcomingEvent('2024-02-29', { enabled: true, frequency: 'yearly' });
  // From just after the 2024 occurrence, 2025/2026/2027 aren't leap years — next real Feb 29 is 2028.
  assert.equal(nextOccurrenceISO(p, new Date(2024, 2, 1)), '2028-02-29');
});
