// Deterministic room-day calendar rendering. Live application state is supplied
// by the controller so closed, unknown, future, and current days are testable.
import { classesOn } from './day.js';
import { clock } from './state.js';
import { hourLabel } from './room-timeline.js';

export const HOUR_PX = 46;

const SHORT_DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SHORT_MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const escapeHtml = (value) => String(value ?? '').replace(
  /[&<>"]/g,
  (character) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' }[character]};`,
);

export function dayGridHtml(room, buildingName, date, schedule, { hours, nowMin, isToday }) {
  const label = `${SHORT_DAY[date.getDay()]}, ${SHORT_MONTH[date.getMonth()]} ${date.getDate()}`;
  const head = `<div class="dnav">
      <button type="button" class="dstep" data-day="-1" aria-label="Previous day">
        <svg class="ico flip" aria-hidden="true"><use href="#i-chev"/></svg></button>
      <span>${escapeHtml(label)}</span>
      <button type="button" class="dstep" data-day="1" aria-label="Next day">
        <svg class="ico" aria-hidden="true"><use href="#i-chev"/></svg></button>
    </div>`;

  if (hours === null) return `${head}<p class="unknown">${escapeHtml(buildingName)} is closed.</p>`;

  const classes = classesOn(room, date, schedule.sessions, schedule.courses);
  const doors = Array.isArray(hours);
  if (!doors && !classes.length) {
    return `${head}<p class="unknown">No class today, and no published hours.</p>`;
  }

  const first = Math.min(...(doors ? [hours[0]] : []), ...classes.map((item) => item.from));
  const last = Math.max(...(doors ? [hours[1]] : []), ...classes.map((item) => item.to));
  const top = Math.floor(first / 60) * 60;
  const end = Math.ceil(last / 60) * 60;
  const span = Math.max(60, end - top);
  const percent = (minute) => ((minute - top) / span) * 100;

  const marks = [];
  for (let minute = top; minute <= end; minute += 60) {
    marks.push(`<li style="top:${percent(minute).toFixed(3)}%"><span>${escapeHtml(hourLabel(minute))}</span></li>`);
  }

  const blocks = classes.map((item) => {
    const height = percent(item.to) - percent(item.from);
    const name = item.course ?? 'In use';
    const when = `${clock(item.from)} - ${clock(item.to)}`;
    return `<div class="blk${height < 4.5 ? ' tight' : ''}" style="top:${percent(item.from).toFixed(3)}%;height:${height.toFixed(3)}%"
      aria-label="${escapeHtml(`${name}, ${when}`)}"><b>${escapeHtml(name)}</b><span>${escapeHtml(when)}</span></div>`;
  });

  const nowLine = isToday && nowMin >= top && nowMin <= end
    ? `<div class="nowline" style="top:${percent(nowMin).toFixed(3)}%" aria-hidden="true"></div>`
    : '';
  const pixels = Math.round((span / 60) * HOUR_PX);
  return `${head}<div class="day" style="height:${pixels}px;--hours:${span / 60}">
      <ul class="hrs">${marks.join('')}</ul>
      <div class="cols">${blocks.join('')}${nowLine}</div>
    </div>`;
}
