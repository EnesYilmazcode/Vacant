// Offline. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { collectMeetings, meetingKey, projectMeeting } from '../fetch-rooms.mjs';

const section = (over = {}) => ({ classNumber: 12345, startDate: '2026-08-25', ...over });
const meeting = (over = {}) => ({
  meetingNumber: 1,
  facilityId: 'DL0357',
  startTime: '8:00 am',
  endTime: '8:55 am',
  standingMeetingPattern: 'MW',
  ...over,
});

test('the key is stable across identical reads, which is what makes the union work', () => {
  assert.equal(meetingKey(section(), meeting()), meetingKey(section(), meeting()));
});

test('every one of the seven fields changes the key', () => {
  const base = meetingKey(section(), meeting());
  assert.notEqual(base, meetingKey(section({ classNumber: 1 }), meeting()));
  assert.notEqual(base, meetingKey(section({ startDate: '2026-01-01' }), meeting()));
  assert.notEqual(base, meetingKey(section(), meeting({ meetingNumber: 2 })));
  assert.notEqual(base, meetingKey(section(), meeting({ facilityId: 'CL0177' })));
  assert.notEqual(base, meetingKey(section(), meeting({ startTime: '9:00 am' })));
  assert.notEqual(base, meetingKey(section(), meeting({ endTime: '9:55 am' })));
  assert.notEqual(base, meetingKey(section(), meeting({ standingMeetingPattern: 'TR' })));
});

test('a section taught in two rooms yields two keys, not one', () => {
  // Collapsing these loses a whole room from the grid.
  const a = meetingKey(section(), meeting({ facilityId: 'DL0357' }));
  const b = meetingKey(section(), meeting({ facilityId: 'CL0177' }));
  assert.notEqual(a, b);
});

test('two meeting rows in the same room at different times yield two keys', () => {
  const a = meetingKey(section(), meeting({ meetingNumber: 1, startTime: '8:00 am' }));
  const b = meetingKey(section(), meeting({ meetingNumber: 2, startTime: '10:00 am' }));
  assert.notEqual(a, b);
});

test('nulls are represented rather than collapsed', () => {
  // A null facilityId and a null pattern are common. If they stringified to the
  // same thing as an adjacent field, unrelated meetings would dedupe together.
  const k = meetingKey(section(), meeting({ facilityId: null, standingMeetingPattern: null }));
  assert.equal(k.split('|').length, 7);
  assert.notEqual(k, meetingKey(section(), meeting({ facilityId: null, startTime: null })));
});

// --- the subject field, issue #55 ---

// Shaped like a live search page: data.courses rows are { course, sections },
// and the two subject fields disagree.
const page = () => ({
  data: {
    courses: [
      {
        course: { subject: 'CSE', catalogNumber: '2221' },
        sections: [
          {
            classNumber: 1,
            subject: 'Computer Science & Engineering',
            catalogNumber: '2221',
            startDate: '2026-08-25',
            meetings: [meeting()],
          },
        ],
      },
    ],
  },
});

test('the subject stored is the course code, not the display name', () => {
  const meetings = new Map();
  assert.equal(collectMeetings(page(), meetings), 1);
  const projected = [...meetings.values()].map(projectMeeting);
  assert.equal(projected.length, 1);
  assert.equal(projected[0].subject, 'CSE');
  assert.notEqual(projected[0].subject, 'Computer Science & Engineering');
  assert.equal(projected[0].catalogNumber, '2221');
});

test('a page with no course object still projects rather than throwing', () => {
  const p = page();
  delete p.data.courses[0].course;
  const meetings = new Map();
  collectMeetings(p, meetings);
  assert.equal([...meetings.values()].map(projectMeeting)[0].subject, null);
});

test('instructors are stripped as the page is read, not later', () => {
  const p = page();
  p.data.courses[0].sections[0].instructors = [{ email: 'a@osu.edu' }];
  p.data.courses[0].sections[0].meetings[0].instructors = [{ email: 'b@osu.edu' }];
  const meetings = new Map();
  collectMeetings(p, meetings);
  assert.equal(JSON.stringify([...meetings.values()]).includes('osu.edu'), false);
});
