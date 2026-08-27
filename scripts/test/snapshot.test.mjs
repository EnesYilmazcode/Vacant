// Offline. Fixtures only, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { countSections, stripInstructors } from '../snapshot-term.mjs';

// Shaped exactly like a live search page, including the trap: instructors hang
// off meetings, not off sections. Issue #2 documented section.instructors, which
// is empty on every page measured, so stripping only that path publishes every
// address in the archive.
const page = () => ({
  data: {
    totalItems: 2043,
    courses: [
      {
        course: { subject: 'MATH' },
        sections: [
          {
            classNumber: 1,
            meetings: [
              { facilityId: 'DL0357', instructors: [{ email: 'buckeye.1@osu.edu', name: 'A' }] },
              { facilityId: 'DL0357', instructors: [{ email: 'buckeye.2@osu.edu', name: 'B' }] },
            ],
          },
          { classNumber: 2, meetings: [{ facilityId: 'CL0177' }] },
        ],
      },
      {
        course: { subject: 'CHEM' },
        sections: [
          {
            classNumber: 3,
            instructors: [{ email: 'legacy@osu.edu' }],
            meetings: [{ facilityId: 'CE0100', instructors: [{ email: 'buckeye.3@osu.edu' }] }],
          },
        ],
      },
    ],
  },
});

test('the strip removes meeting-level instructors, which is where the PII actually is', () => {
  const p = page();
  const removed = stripInstructors(p);
  assert.equal(removed, 4, '3 meeting-level plus 1 legacy section-level');
  assert.ok(!/@osu\.edu/i.test(JSON.stringify(p)), 'no address survives serialisation');
});

test('stripping only section.instructors would have left the addresses behind', () => {
  const p = page();
  for (const c of p.data.courses) for (const s of c.sections) delete s.instructors;
  assert.match(
    JSON.stringify(p),
    /@osu\.edu/,
    'this is the bug the issue as written would have shipped',
  );
});

test('the strip leaves every non-instructor field verbatim', () => {
  const p = page();
  stripInstructors(p);
  assert.equal(p.data.totalItems, 2043);
  assert.equal(p.data.courses[0].sections[0].meetings[0].facilityId, 'DL0357');
  assert.equal(p.data.courses[0].sections.length, 2);
  assert.equal(p.data.courses[1].course.subject, 'CHEM');
});

test('the strip is idempotent and safe on an empty or malformed page', () => {
  const p = page();
  stripInstructors(p);
  assert.equal(stripInstructors(p), 0);
  assert.equal(stripInstructors({}), 0);
  assert.equal(stripInstructors({ data: {} }), 0);
  assert.equal(stripInstructors({ data: { courses: [{}] } }), 0);
  assert.equal(stripInstructors({ data: { courses: [{ sections: [{}] }] } }), 0);
});

test('countSections counts sections, not courses', () => {
  assert.equal(countSections(page()), 3);
  assert.equal(countSections({}), 0);
});

test('page filenames zero pad so p02 sorts before p10', () => {
  const name = (p) => `1xxx-p${String(p).padStart(2, '0')}.json.gz`;
  const sorted = [10, 2, 1, 32].map(name).sort();
  assert.deepEqual(sorted, [name(1), name(2), name(10), name(32)]);
});
