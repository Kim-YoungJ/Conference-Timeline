import { useEffect, useMemo, useRef, useState } from 'react';
import { openExternal } from '../data/env';
import { buildClaudePrompt, lookupCoords, parseImport } from '../data/importConf';
import type { Conference } from '../data/types';
import { dday, deadlineState, fmtSchedule, nextMilestone, pickDisplayYear, scheduleItems } from '../data/util';

interface Props {
  conferences: Conference[];
  tracked: string[];
  highlight?: string[]; // `conf:<slug>` keys just changed via MCP — flash + scroll to them
  onToggleTrack: (slug: string) => void;
  onSaveCustom: (conf: Conference) => void;
  onDeleteCustom: (slug: string) => void;
  onImport: (confs: Conference[]) => { added: number; updated: number };
  onCleanup: (beforeYear: number) => number;
}

interface FormState {
  slug?: string; // set when editing an existing custom conference
  title: string;
  place: string;
  dateText: string;
  deadline: string; // datetime-local value, '' = TBD
  link: string;
}

const EMPTY_FORM: FormState = { title: '', place: '', dateText: '', deadline: '', link: '' };

function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function TimelineView({
  conferences,
  tracked,
  highlight,
  onToggleTrack,
  onSaveCustom,
  onDeleteCustom,
  onImport,
  onCleanup,
}: Props) {
  const listRef = useRef<HTMLUListElement>(null);
  // when MCP changes arrive, bring the first flashed row into view
  useEffect(() => {
    if (highlight?.length)
      listRef.current?.querySelector('.just-updated')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlight]);

  const [filter, setFilter] = useState<'all' | 'tracked'>('all');
  const [query, setQuery] = useState('');
  const [form, setForm] = useState<FormState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null); // two-click delete; confirm() is unreliable in webviews
  const [notice, setNotice] = useState<string | null>(null);
  const [promptNames, setPromptNames] = useState<string | null>(null); // null = panel closed
  const fileRef = useRef<HTMLInputElement>(null);

  function flash(msg: string) {
    setNotice(msg);
    setTimeout(() => setNotice(null), 5000);
  }

  async function handleFile(file: File) {
    try {
      const confs = parseImport(await file.text());
      const { added, updated } = onImport(confs);
      flash(`Import complete: ${added} added, ${updated} updated`);
    } catch (e) {
      flash(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function copyPrompt() {
    if (!promptNames?.trim()) return;
    navigator.clipboard
      .writeText(buildClaudePrompt(promptNames))
      .then(() => {
        flash('Copied. Paste into Claude Desktop to research the conferences and get JSON back.');
        setPromptNames(null);
      })
      .catch(() => flash('Failed to copy to clipboard'));
  }

  function saveForm() {
    if (!form || !form.title.trim()) return;
    const existing = form.slug ? conferences.find((c) => c.slug === form.slug) : undefined;
    const slug = form.slug ?? `custom-${Date.now()}`;
    const deadline = form.deadline ? new Date(form.deadline).toISOString() : null;
    const year = deadline
      ? new Date(deadline).getFullYear()
      : parseInt(form.dateText.match(/\d{4}/)?.[0] ?? '', 10) || new Date().getFullYear();
    onSaveCustom({
      slug,
      title: form.title.trim(),
      fullName: existing?.fullName ?? form.title.trim(),
      rank: existing?.rank,
      source: 'custom',
      years: [
        {
          id: `${slug}-${year}`,
          year,
          link: form.link.trim(),
          deadline,
          // manual entry is typed in the user's local clock — label it with that offset
          timezone: deadline ? `UTC${-new Date().getTimezoneOffset() / 60 >= 0 ? '+' : ''}${-new Date().getTimezoneOffset() / 60}` : undefined,
          dateText: form.dateText.trim(),
          place: form.place.trim(),
          ...lookupCoords(form.place),
        },
      ],
    });
    setForm(null);
  }

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return conferences
      .filter((c) => (filter === 'tracked' ? tracked.includes(c.slug) : true))
      .filter((c) =>
        q ? [c.title, c.fullName, ...c.years.map((y) => y.place)].join(' ').toLowerCase().includes(q) : true
      )
      .map((conf) => ({ conf, year: pickDisplayYear(conf) }))
      .sort((a, b) => {
        // upcoming milestones asc → TBD → finished
        const order = (s: string) => (s === 'past' ? 2 : s === 'tbd' ? 1 : 0);
        const sa = deadlineState(a.year);
        const sb = deadlineState(b.year);
        if (order(sa) !== order(sb)) return order(sa) - order(sb);
        const na = nextMilestone(a.year);
        const nb = nextMilestone(b.year);
        if (!na || !nb) return 0;
        return Date.parse(na.date) - Date.parse(nb.date);
      });
  }, [conferences, tracked, filter, query]);

  return (
    <div className="timeline">
      <div className="toolbar">
        <div className="chips">
          <button className={filter === 'all' ? 'chip active' : 'chip'} onClick={() => setFilter('all')}>
            All ({conferences.length})
          </button>
          <button className={filter === 'tracked' ? 'chip active' : 'chip'} onClick={() => setFilter('tracked')}>
            ★ Tracked ({tracked.length})
          </button>
        </div>
        <input
          className="search"
          placeholder="Search by name or city…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button onClick={() => setForm(form ? null : EMPTY_FORM)}>{form ? 'Cancel' : '＋ Add conference'}</button>
        <button onClick={() => fileRef.current?.click()}>⬆ Import JSON</button>
        <button
          onClick={() => setPromptNames(promptNames === null ? '' : null)}
          title="Build a research prompt to paste into Claude Desktop"
        >
          📋 Claude prompt
        </button>
        <button
          onClick={() => {
            const removed = onCleanup(new Date().getFullYear());
            flash(removed > 0 ? `Deleted ${removed} past-year record(s).` : 'No past-year records to delete.');
          }}
          title={`Delete conference records from before ${new Date().getFullYear()}`}
        >
          🧹 Clean up past years
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = '';
          }}
        />
      </div>
      {promptNames !== null && (
        <div className="custom-form">
          <input
            className="prompt-names"
            autoFocus
            placeholder="Conference names to research — separate with commas (e.g. ICRA, AIAA SciTech, IAC)"
            value={promptNames}
            onChange={(e) => setPromptNames(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && copyPrompt()}
          />
          <button onClick={copyPrompt} disabled={!promptNames.trim()}>
            Copy prompt
          </button>
        </div>
      )}
      {notice && <p className="notice">{notice}</p>}
      {form && (
        <div className="custom-form">
          <input
            placeholder="Conference name *"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <input
            placeholder="Location (e.g. Seoul, Korea)"
            value={form.place}
            onChange={(e) => setForm({ ...form, place: e.target.value })}
          />
          <input
            placeholder="Dates (e.g. Jul 7-9, 2027)"
            value={form.dateText}
            onChange={(e) => setForm({ ...form, dateText: e.target.value })}
          />
          <label>
            Deadline{' '}
            <input
              type="datetime-local"
              value={form.deadline}
              onChange={(e) => setForm({ ...form, deadline: e.target.value })}
            />
          </label>
          <input
            placeholder="Official site URL"
            value={form.link}
            onChange={(e) => setForm({ ...form, link: e.target.value })}
          />
          <button onClick={saveForm} disabled={!form.title.trim()}>
            Save
          </button>
        </div>
      )}
      {rows.length === 0 && <p className="empty">No conferences to show.</p>}
      <ul className="conf-list" ref={listRef}>
        {rows.map(({ conf, year }) => {
          const state = deadlineState(year);
          const next = nextMilestone(year);
          const isTracked = tracked.includes(conf.slug);
          const isUpdated = highlight?.includes(`conf:${conf.slug}`);
          return (
            <li key={conf.slug} className={`conf-row ${state}${isUpdated ? ' just-updated' : ''}`}>
              <button
                className={isTracked ? 'star on' : 'star'}
                title={isTracked ? 'Untrack' : 'Track'}
                onClick={() => onToggleTrack(conf.slug)}
              >
                {isTracked ? '★' : '☆'}
              </button>
              <div className="conf-main">
                <div className="conf-title">
                  <strong>{conf.title} {year.year}</strong>
                  {conf.rank && <span className="badge rank">{conf.rank}</span>}
                </div>
                <div className="conf-sub">{conf.fullName}</div>
                <div className="conf-meta">
                  📍 {year.place || 'TBD'} · 🗓 {year.dateText || 'TBD'}
                </div>
                <ul className="schedule">
                  {scheduleItems(year).map((it, i) => {
                    const isPast = it.date ? Date.parse(it.date) < Date.now() : false;
                    const isNext = !!next && it.date === next.date && it.label === next.label;
                    return (
                      <li key={i} className={isNext ? 'sch-next' : isPast ? 'sch-past' : ''}>
                        <span className="sch-label">{it.label}</span>
                        <span className="sch-date">{fmtSchedule(it, year.timezone)}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <div className="conf-side">
                <span className={`dday ${state}`}>
                  {state === 'tbd'
                    ? 'TBD'
                    : state === 'past'
                      ? 'Ended'
                      : dday(next!.date) === 0
                        ? 'D-Day'
                        : `D-${dday(next!.date)}`}
                </span>
                {next && state !== 'past' && state !== 'tbd' && (
                  <span className="dday-target">{next.label}</span>
                )}
                {year.link && (
                  <button className="link" onClick={() => openExternal(year.link)}>
                    Site ↗
                  </button>
                )}
                {conf.source === 'custom' && (
                  <span className="row-edit">
                    <button
                      className="link"
                      onClick={() =>
                        setForm({
                          slug: conf.slug,
                          title: conf.title,
                          place: year.place,
                          dateText: year.dateText,
                          deadline: isoToLocalInput(year.deadline),
                          link: year.link,
                        })
                      }
                    >
                      Edit
                    </button>
                    <button
                      className="link danger"
                      onClick={() => {
                        if (pendingDelete === conf.slug) {
                          onDeleteCustom(conf.slug);
                          setPendingDelete(null);
                        } else {
                          setPendingDelete(conf.slug);
                        }
                      }}
                      onBlur={() => setPendingDelete(null)}
                    >
                      {pendingDelete === conf.slug ? 'Click again to delete' : 'Delete'}
                    </button>
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
