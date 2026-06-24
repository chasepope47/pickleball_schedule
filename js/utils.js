import { RATINGS, AUTH_ERRORS } from './constants.js';

export function getMondayOf(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return d;
}

export function isoDate(d) { return d.toISOString().slice(0, 10); }

export const WEEK_MONDAY = getMondayOf(new Date());
export const WEEK_KEY    = isoDate(WEEK_MONDAY);

export const todayDayIdx = (() => { const d = new Date().getDay(); return d === 0 ? 6 : d - 1; })();

export function dayDate(idx) {
  const d = new Date(WEEK_MONDAY);
  d.setDate(d.getDate() + idx);
  return d;
}

export function slotDateTime(dayIdx, h) {
  const d = dayDate(dayIdx);
  d.setHours(h, 0, 0, 0);
  return d;
}

export function fmtHour(h) {
  const p = h < 12 ? 'AM' : 'PM';
  const d = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${d}:00 ${p}`;
}

export function slotLabel(h) { return `${fmtHour(h)} – ${fmtHour(h + 1)}`; }

export function getInitials(firstName, lastName) {
  return `${(firstName?.[0] || '?')}${(lastName?.[0] || '?')}`.toUpperCase();
}

export function ratingOptions(selected) {
  return RATINGS.map(([v, l]) =>
    `<option value="${v}" ${v == selected ? 'selected' : ''}>${l}</option>`
  ).join('');
}

export function adjustRating(current, won) {
  const delta = won ? 0.1 : -0.1;
  const raw   = (parseFloat(current) || 3.0) + delta;
  return Math.round(Math.min(5.0, Math.max(2.0, raw)) * 10) / 10;
}

export function getHoliday() {
  const now = new Date();
  const key = `${now.getMonth() + 1}/${now.getDate()}`;
  const days = {
    '1/1':   { id: 'holiday-newyear',     name: "New Year's Day" },
    '2/14':  { id: 'holiday-valentine',   name: "Valentine's Day" },
    '3/17':  { id: 'holiday-stpatrick',   name: "St. Patrick's Day" },
    '7/4':   { id: 'holiday-july4',       name: 'Independence Day' },
    '10/31': { id: 'holiday-halloween',   name: 'Halloween' },
    '11/11': { id: 'holiday-veterans',    name: 'Veterans Day' },
    '12/24': { id: 'holiday-xmaseve',     name: 'Christmas Eve' },
    '12/25': { id: 'holiday-xmas',        name: 'Christmas' },
    '12/31': { id: 'holiday-newyearseve', name: "New Year's Eve" },
  };
  return days[key] || null;
}

export function resizeImage(file, size, quality, callback) {
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx   = canvas.getContext('2d');
    const ratio = Math.max(size / img.width, size / img.height);
    const sw    = size / ratio, sh = size / ratio;
    const sx    = (img.width - sw) / 2, sy = (img.height - sh) / 2;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, size, size);
    URL.revokeObjectURL(url);
    callback(canvas.toDataURL('image/jpeg', quality));
  };
  img.src = url;
}

export function authMsg(code) {
  return AUTH_ERRORS[code] || `Error (${code}). Please try again.`;
}

export function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
