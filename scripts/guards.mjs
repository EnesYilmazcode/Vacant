// Copied verbatim from EnesYilmazcode/Finder scripts/guards.mjs (MIT), with one
// change: MAX_DROP is 0.05 rather than 0.1. Keep it that way. A diff against
// Finder's copy should show this comment and that constant and nothing else.
//
// The refusal rules the four snapshotters share.
//
// An absolute floor only catches a total collapse. What actually goes wrong is a
// partial one: upstream rate limits half a run, the count still clears the floor,
// and the site quietly loses a third of its rows. So a run is measured against
// what is already committed, and the floor covers the first run with nothing to
// compare against.

// The committed history is flat: three ratings snapshots in a row at 7367, and
// term 1268 went 17680 to 17688 to 17692 sections over the same nights. Nothing
// has moved down yet, so a tenth is a deliberate guess rather than a tuned
// number, loose enough that real churn cannot trip it. Only the last committed
// run is compared against, so a slow bleed of a few percent a night still gets
// through.
const MAX_DROP = 0.05;

// FORCE_WRITE=1 is there so a real upstream shrink can be shipped, not so a
// collapse or a broken parse can be, so only the drop yields to it. Both are
// exported because a script has checks of its own that belong in the same
// message, and they fall on either side of that line.
export const forceable = (reason) => ({ reason, forceable: true });
export const fatal = (reason) => ({ reason, forceable: false });

// A short answer from searchableTermsV2 is not a shrink. It deletes committed
// files for terms this run never asked about, so FORCE_WRITE=1 does not reach
// it: that flag is for shipping one term's real shrink. Terms do roll over, so
// there has to be a way to accept one, and this is it.
export function termListRefusal(count, previous, allow = process.env.ALLOW_TERM_DROP === '1') {
  const short = countRefusal('searchable terms', count, 1, previous);
  if (!short) return null;
  // An empty answer trips the floor, which is nobody's rollover.
  if (!short.forceable) return short;
  if (allow) return null;
  return fatal(`${short.reason}; set ALLOW_TERM_DROP=1 once a term really has rolled over`);
}

// A count against its floor and against the last committed run. `previous` is 0
// or null on a first run, which leaves only the floor.
export function countRefusal(label, count, floor, previous) {
  if (count < floor) {
    // Naming the committed count matters most here: a term that went to zero
    // trips the floor, and the floor alone does not say what was lost.
    const held = previous ? `, and ${previous} is already committed` : '';
    return fatal(`${label}: got ${count}, the floor is ${floor}${held}`);
  }
  if (!previous) return null;

  const allowed = Math.ceil(previous * (1 - MAX_DROP));
  if (count < allowed) {
    const drop = ((1 - count / previous) * 100).toFixed(1);
    return forceable(`${label}: got ${count}, down ${drop}% from the ${previous} already committed, anything under ${allowed} is a collapse`);
  }
  return null;
}

// The share of rows a parser could not read, over a whole run.
export function residueRefusal(label, parsed, failed, maxRate) {
  const seen = parsed + failed;
  if (!seen) return null;

  const rate = failed / seen;
  if (rate <= maxRate) return null;
  return fatal(`${label}: ${failed} of ${seen} rows did not parse (${(rate * 100).toFixed(2)}%), over ${(maxRate * 100).toFixed(2)}%`);
}

// The same for one file rather than the run. A file that read nothing at all has
// broken. Past that it takes more than one bad row, because most of Barrett's
// subject files are short enough that one odd line is over any useful rate.
export function subjectResidueRefusal(label, parsed, failed, maxRate) {
  if (!failed) return null;
  if (!parsed) return fatal(`${label}: nothing parsed, all ${failed} rows failed`);
  if (failed < 2) return null;
  return residueRefusal(label, parsed, failed, maxRate);
}

// What to abort with, or null when the run may write.
export function refusalMessage(refusals, force = process.env.FORCE_WRITE === '1') {
  const reasons = refusals.filter(Boolean);
  if (!reasons.length) return null;

  if (force) {
    for (const r of reasons) if (r.forceable) console.warn(`FORCE_WRITE=1, writing anyway: ${r.reason}`);
  }
  const left = force ? reasons.filter((r) => !r.forceable) : reasons;
  if (!left.length) return null;

  const lines = left.map((r) => r.reason);
  // Only worth suggesting when it would actually get past everything listed.
  if (!force && left.every((r) => r.forceable)) lines.push('Set FORCE_WRITE=1 to write this anyway.');
  return lines.join('\n');
}
