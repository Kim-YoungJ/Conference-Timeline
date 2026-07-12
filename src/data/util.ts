import type { Conference, ConferenceYear, ScheduleItem } from './types';

export function dday(iso: string): number {
  return Math.ceil((Date.parse(iso) - Date.now()) / 86400_000);
}

// ── conference date-range parsing ("Jun 1-5, 2026", "May 29- June 2, 2023") ──
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const monthNum = (name?: string) => (name ? MONTHS[name.slice(0, 3).toLowerCase()] : undefined);

export function parseDateTextRange(text: string, fallbackYear: number): { start: string; end: string } | null {
  if (!text) return null;
  // drop weekday parentheticals ("Oct 27 (Tue) - 30 (Fri), 2026") before parsing
  const t = text.replace(/\([^)]*\)/g, ' ').replace(/[–—]/g, '-');
  const year = parseInt(t.match(/(\d{4})/)?.[1] ?? '', 10) || fallbackYear;
  const iso = (y: number, m: number, d: number) =>
    `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T00:00:00.000Z`;
  const range = t.match(/([A-Za-z]+)\.?\s*(\d{1,2})\s*-\s*(?:([A-Za-z]+)\.?\s*)?(\d{1,2})/);
  if (range) {
    const m1 = monthNum(range[1]);
    const m2 = monthNum(range[3]) ?? m1;
    if (!m1 || !m2) return null;
    const endYear = m2 < m1 ? year + 1 : year; // "Dec 28 - Jan 2"
    return { start: iso(year, m1, parseInt(range[2], 10)), end: iso(endYear, m2, parseInt(range[4], 10)) };
  }
  const single = t.match(/([A-Za-z]+)\.?\s*(\d{1,2})/);
  if (single) {
    const m = monthNum(single[1]);
    if (!m) return null;
    const d = iso(year, m, parseInt(single[2], 10));
    return { start: d, end: d };
  }
  return null;
}

// full schedule for display (includes TBD rows); synthesized from legacy fields when absent
export function scheduleItems(y: ConferenceYear): ScheduleItem[] {
  if (y.schedule?.length) return y.schedule;
  const items: ScheduleItem[] = [];
  if (y.abstractDeadline) items.push({ label: 'Abstract deadline', date: y.abstractDeadline });
  if (y.deadline && y.deadline !== y.abstractDeadline) items.push({ label: 'Paper deadline', date: y.deadline });
  else if (!y.deadline && !y.abstractDeadline) items.push({ label: 'Paper deadline', date: null });
  const range = parseDateTextRange(y.dateText, y.year);
  if (range) {
    items.push({ label: 'Conference start', date: range.start });
    if (range.end !== range.start) items.push({ label: 'Conference end', date: range.end });
  }
  return items;
}

// dated milestones sorted ascending — drives state and D-day
export function milestones(y: ConferenceYear): (ScheduleItem & { date: string })[] {
  return scheduleItems(y)
    .filter((s): s is ScheduleItem & { date: string } => !!s.date)
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

export function nextMilestone(y: ConferenceYear): (ScheduleItem & { date: string }) | null {
  return milestones(y).find((m) => Date.parse(m.date) > Date.now()) ?? null;
}

const TZ_LABELS: Record<string, number> = {
  aoe: -12, utc: 0, gmt: 0,
  kst: 9, jst: 9, 'china standard time': 8,
  pst: -8, pdt: -7, mst: -7, mdt: -6, cst: -6, cdt: -5, est: -5, edt: -4,
  cet: 1, cest: 2, bst: 1,
  pt: -8, mt: -7, ct: -6, et: -5,
};

// free-text names conferences actually use ("Pacific Time (PT)", "Anywhere on Earth")
const TZ_PHRASES: [RegExp, number][] = [
  [/anywhere on earth|aoe/i, -12],
  [/pacific/i, -8],
  [/mountain/i, -7],
  [/central europe/i, 1],
  [/central/i, -6],
  [/eastern/i, -5],
  [/korea|seoul/i, 9],
  [/japan|tokyo/i, 9],
  [/china|beijing/i, 8],
  [/india/i, 5.5],
];

// "UTC-8" → -8, "UTC+5:30" → 5.5, "AoE" → -12, "Pacific Time (PT)" → -8; null if unrecognized
export function tzOffsetHours(tz?: string): number | null {
  if (!tz) return null;
  const m = tz.match(/(?:UTC|GMT)\s*([+-])(\d{1,2})(?::(\d{2})|\.(\d+))?/i);
  if (m) {
    const sign = m[1] === '-' ? -1 : 1;
    const h = parseInt(m[2], 10) + (m[3] ? parseInt(m[3], 10) / 60 : 0) + (m[4] ? parseFloat(`0.${m[4]}`) : 0);
    return sign * h;
  }
  const label = TZ_LABELS[tz.trim().toLowerCase()];
  if (label !== undefined) return label;
  for (const [re, off] of TZ_PHRASES) if (re.test(tz)) return off;
  return null;
}

// show the deadline in the venue's announced timezone with a label.
// missing/unrecognized timezone: show the stored wall time as-is (UTC view,
// which equals the announced time for data parsed without an offset) + label
export function fmtDeadline(iso: string, tz?: string): string {
  const offset = tzOffsetHours(tz) ?? 0;
  const shifted = new Date(Date.parse(iso) + offset * 3600_000);
  const s = shifted.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  return `${s} (${tz ?? 'unknown'})`;
}

// schedule row date: raw site text if given; date-only for day-precision entries
export function fmtSchedule(item: ScheduleItem, tz?: string): string {
  if (item.display) return item.display;
  if (!item.date) return 'TBD';
  if (item.date.endsWith('T00:00:00.000Z')) return item.date.slice(0, 10);
  return fmtDeadline(item.date, tz);
}

// year edition to feature for a conference: earliest upcoming milestone,
// else an edition whose schedule is still TBD, else the latest finished one
export function pickDisplayYear(conf: Conference): ConferenceYear {
  const upcoming = conf.years
    .map((y) => ({ y, next: nextMilestone(y) }))
    .filter((s): s is { y: ConferenceYear; next: ScheduleItem & { date: string } } => s.next !== null)
    .sort((a, b) => Date.parse(a.next.date) - Date.parse(b.next.date));
  if (upcoming.length) return upcoming[0].y;
  const tbd = conf.years.filter((y) => milestones(y).length === 0);
  if (tbd.length) return tbd[tbd.length - 1];
  return conf.years[conf.years.length - 1];
}

export type DeadlineState = 'urgent' | 'soon' | 'ok' | 'past' | 'tbd';

// 'past' only when EVERY scheduled item (deadlines and the event itself) has passed
export function deadlineState(y: ConferenceYear): DeadlineState {
  const ms = milestones(y);
  if (ms.length === 0) return 'tbd';
  const next = ms.find((m) => Date.parse(m.date) > Date.now());
  if (!next) return 'past';
  const d = dday(next.date);
  if (d <= 7) return 'urgent';
  if (d <= 30) return 'soon';
  return 'ok';
}
