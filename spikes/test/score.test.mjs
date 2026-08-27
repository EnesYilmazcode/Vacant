// Defect 2. The report scored the app wrong for the rows where it refused to
// guess, and reported a headline percentage over a sample the product mostly
// cannot show.
//
// Frozen to Saturday 2026-08-29 03:00 every pick lands in a building with no
// published hours. Recording all twenty as "building door locked" printed
// "wrong 20 / 20 (100% of what was visited)" for twenty honest refusals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { APP_SHOWN_CAP, OUTCOME_ORDER, OUTCOMES, verdictFor, tally, visibility, stratumOf } from '../score.js';

const at = (p) => fileURLToPath(new URL(p, import.meta.url));

const row = (hoursKnown, outcome, appRank = 1) => ({
  hoursKnown,
  appRank,
  shownByApp: appRank <= APP_SHOWN_CAP,
  visit: outcome ? { outcome } : null,
});

test('js/app.js still cuts the list where score.js says it does', () => {
  const app = readFileSync(at('../../js/app.js'), 'utf8');
  assert.ok(
    app.includes(`state.results = usable.slice(0, ${APP_SHOWN_CAP});`),
    `js/app.js no longer slices its list at ${APP_SHOWN_CAP}. APP_SHOWN_CAP in spikes/score.js decides which walked rows are reported as rows a user could have tapped.`,
  );
  assert.ok(
    !/paginat|loadMore|showMore/i.test(app),
    'js/app.js looks like it grew pagination. If rows past the cut are reachable now, the visibility split in the walk report is measuring the wrong thing.',
  );
});

test('a locked door falsifies nothing where hours are not published', () => {
  assert.equal(verdictFor(false, 'locked-outer'), 'unclaimed');
  assert.equal(verdictFor(false, 'locked-inner'), 'unclaimed');
  // The same door where a close time was published is a contradiction.
  assert.equal(verdictFor(true, 'locked-outer'), 'contradicted');
});

test('a locked room door is never a contradiction, in either stratum', () => {
  // The index carries no room-lock data for any building, so the app never
  // claimed it.
  assert.equal(verdictFor(true, 'locked-inner'), 'unclaimed');
  assert.equal(verdictFor(false, 'locked-inner'), 'unclaimed');
});

test('occupied and missing contradict the app in both strata', () => {
  for (const hoursKnown of [true, false]) {
    assert.equal(verdictFor(hoursKnown, 'occupied'), 'contradicted');
    assert.equal(verdictFor(hoursKnown, 'missing'), 'contradicted');
    assert.equal(verdictFor(hoursKnown, 'empty'), 'confirmed');
  }
});

test('every outcome the page can record has a verdict', () => {
  for (const outcome of OUTCOME_ORDER) {
    assert.ok(OUTCOMES[outcome], `${outcome} has no words`);
    for (const hoursKnown of [true, false]) {
      assert.ok(['confirmed', 'contradicted', 'unclaimed'].includes(verdictFor(hoursKnown, outcome)));
    }
  }
  assert.throws(() => verdictFor(true, 'shrugged'), /unknown outcome/);
});

test('the Saturday 03:00 walk: twenty locked doors, zero contradictions', () => {
  const rows = Array.from({ length: 20 }, (_, i) => row(false, 'locked-outer', i + 1));
  const [published, unpublished] = tally(rows);
  assert.equal(published.picked, 0);
  assert.equal(unpublished.picked, 20);
  assert.equal(unpublished.visited, 20);
  assert.equal(unpublished.counts['locked-outer'], 20);
  // The number that used to read 20 / 20.
  assert.equal(unpublished.contradicted, 0);
  assert.equal(unpublished.unclaimed, 20);
  // Still twenty rooms nobody could use. That is a different sentence.
  assert.equal(unpublished.unusable, 20);
});

test('the two strata are counted apart and never summed', () => {
  const rows = [
    row(true, 'empty'), row(true, 'locked-outer'), row(true, 'occupied'),
    row(false, 'locked-outer'), row(false, 'empty'), row(false, 'occupied'),
    row(false, null),
  ];
  const [published, unpublished] = tally(rows);
  assert.equal(published.picked, 3);
  assert.equal(published.visited, 3);
  assert.equal(published.contradicted, 2);
  assert.equal(published.confirmed, 1);

  assert.equal(unpublished.picked, 4);
  assert.equal(unpublished.visited, 3, 'an unvisited row is picked but not recorded');
  assert.equal(unpublished.contradicted, 1, 'occupied only; the locked door is not the app being wrong');
  assert.equal(unpublished.unclaimed, 1);
  assert.equal(unpublished.confirmed, 1);
});

test('stratum follows published hours, not why the room was picked', () => {
  assert.equal(stratumOf(true), 'published');
  assert.equal(stratumOf(false), 'unpublished');
});

test('visibility separates the picks the app could show from the ones it could not', () => {
  const rows = [row(true, 'empty', 3), row(true, 'empty', 40), row(false, 'empty', 41), row(false, null, 627)];
  const v = visibility(rows);
  assert.equal(v.cap, APP_SHOWN_CAP);
  assert.equal(v.shown, 2, 'rank 40 is the last row the app shows');
  assert.equal(v.below, 2);
  assert.equal(v.unranked, 0);

  // A walk stored before the rank was recorded must not be counted either way.
  const old = visibility([{ hoursKnown: true, visit: null }]);
  assert.equal(old.ranked, 0);
  assert.equal(old.unranked, 1);
  assert.equal(old.shown, 0);
});
