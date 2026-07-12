// JSON import: user asks Claude Desktop (subscription, web search) to fill the
// template below, then imports the resulting file — no API key, no per-call cost.
import type { Conference, ConferenceYear, ScheduleItem } from './types';
import { tzOffsetHours } from './util';
import cityCoords from './seed/city-coords.json';

export function lookupCoords(place: string): { lat: number; lng: number } | undefined {
  const table = cityCoords as unknown as Record<string, [number, number]>;
  const parts = place.split(',').map((s) => s.replace(/\(.*?\)/g, '').trim().toLowerCase());
  const city = parts[0] ?? '';
  // "excel london" → also try each word; then country (last part) as fallback
  const candidates = [city, ...city.split(/\s+/), parts[parts.length - 1]];
  for (const key of candidates) {
    const hit = table[key];
    if (hit) return { lat: hit[0], lng: hit[1] };
  }
  return undefined;
}

export function buildClaudePrompt(names: string): string {
  const list = names
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return `Search the web for the latest (upcoming edition) info on the conferences below and answer ONLY in the JSON format shown.
One array element per conference; output only the JSON array inside a code block, no other explanation.
Dates must be ISO format with a timezone offset (e.g. 2026-09-15T23:59:00-08:00); use null if unknown.
In schedule, include the full Important Dates table from the official site, labels as-is, in chronological order (mark extended deadlines as extended).
Always end with "Conference start"/"Conference end" as the last two items; event dates as YYYY-MM-DD without a time.

[
  {
    "title": "Conference acronym (e.g. ICRA)",
    "fullName": "Full conference name",
    "years": [
      {
        "year": 2027,
        "link": "official site URL",
        "timezone": "deadline timezone as announced by the conference (e.g. AoE, UTC-8, KST)",
        "dateText": "event dates (e.g. Jun 1-5, 2027)",
        "place": "City, Country (e.g. Vienna, Austria)",
        "schedule": [
          { "label": "Abstract submission", "date": "ISO date or null" },
          { "label": "Full paper deadline", "date": "ISO date or null" },
          { "label": "Notification", "date": "ISO date or null" },
          { "label": "Camera-ready", "date": "ISO date or null" },
          { "label": "Conference start", "date": "ISO date" },
          { "label": "Conference end", "date": "ISO date" }
        ]
      }
    ]
  }
]

Conferences to research:
${list.map((n) => `- ${n}`).join('\n')}`;
}

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `custom-${Date.now()}`;
}

function toIso(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

// "2026-09-15T23:59:00-08:00" → "UTC-8" (fallback when Claude omits the timezone field)
function offsetLabel(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  if (/Z$/.test(v)) return 'UTC';
  const m = v.match(/([+-])(\d{2}):?(\d{2})$/);
  if (!m) return undefined;
  const h = parseInt(m[2], 10);
  return `UTC${m[1]}${h}${m[3] !== '00' ? `:${m[3]}` : ''}`;
}

// throws Error with a readable message on invalid input
export function parseImport(text: string): Conference[] {
  // tolerate a ```json ... ``` code block pasted straight from Claude
  const stripped = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  let data: unknown;
  try {
    data = JSON.parse(stripped);
  } catch {
    throw new Error('Failed to parse JSON — check that the file is valid JSON.');
  }
  const list = Array.isArray(data) ? data : [data];
  return list.map((raw, i) => {
    const c = raw as Record<string, unknown>;
    const title = typeof c.title === 'string' ? c.title.trim() : '';
    if (!title) throw new Error(`Item ${i + 1} is missing a title.`);
    const slug = typeof c.slug === 'string' && c.slug ? c.slug : slugify(title);
    const yearsRaw = Array.isArray(c.years) ? c.years : [];
    if (yearsRaw.length === 0) throw new Error(`"${title}" is missing a years array.`);
    const years: ConferenceYear[] = yearsRaw.map((yr) => {
      const y = yr as Record<string, unknown>;
      // full schedule table (new format); legacy deadline/abstractDeadline still accepted
      const schedule: ScheduleItem[] | undefined = Array.isArray(y.schedule)
        ? (y.schedule as Record<string, unknown>[])
            .filter((s) => typeof s.label === 'string')
            .map((s) => ({ label: s.label as string, date: toIso(s.date) }))
        : undefined;
      const schedDeadlines = (schedule ?? [])
        .filter(
          (s) =>
            s.date &&
            /deadline|submission|paper|마감/i.test(s.label) && // 마감/초록 kept so legacy Korean-labeled data still parses
            !/abstract|초록|camera|final|revised/i.test(s.label)
        )
        .map((s) => s.date!);
      const deadline = toIso(y.deadline) ?? schedDeadlines[schedDeadlines.length - 1] ?? null;
      const year =
        typeof y.year === 'number'
          ? y.year
          : deadline
            ? new Date(deadline).getFullYear()
            : new Date().getFullYear();
      const place = typeof y.place === 'string' ? y.place : '';
      const coords =
        typeof y.lat === 'number' && typeof y.lng === 'number'
          ? { lat: y.lat, lng: y.lng }
          : lookupCoords(place);
      // derive tz label from a raw (pre-conversion) date string so the offset survives
      const rawSchedDate = Array.isArray(y.schedule)
        ? (y.schedule as Record<string, unknown>[]).map((s) => s.date).find((d) => typeof d === 'string' && d)
        : undefined;
      const isoLabel = offsetLabel(y.deadline) ?? offsetLabel(rawSchedDate);
      const givenLabel = typeof y.timezone === 'string' && y.timezone ? y.timezone : undefined;
      // the ISO offset is DST-exact; if the named timezone disagrees (or is unknown), show both
      const timezone = givenLabel
        ? isoLabel && tzOffsetHours(givenLabel) !== tzOffsetHours(isoLabel)
          ? `${isoLabel} (${givenLabel})`
          : givenLabel
        : isoLabel;
      return {
        id: `${slug}-${year}`,
        year,
        link: typeof y.link === 'string' ? y.link : '',
        deadline,
        abstractDeadline: toIso(y.abstractDeadline) ?? undefined,
        schedule: schedule?.length ? schedule : undefined,
        timezone,
        dateText: typeof y.dateText === 'string' ? y.dateText : '',
        place,
        ...coords,
      };
    });
    return {
      slug,
      title,
      fullName: typeof c.fullName === 'string' && c.fullName ? c.fullName : title,
      rank: typeof c.rank === 'string' ? c.rank : undefined,
      source: 'custom' as const,
      years: years.sort((a, b) => a.year - b.year),
    };
  });
}
