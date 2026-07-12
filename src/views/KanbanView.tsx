import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { openExternal } from '../data/env';
import type { Journal, Stage, Submission, UserData } from '../data/types';
import { STAGES } from '../data/types';

const STAGE_LABELS: Record<Stage, string> = {
  idea: 'Idea',
  drafting: 'Drafting',
  submitted: 'Submitted',
  review: 'Under Review',
  revision: 'Revision',
  accepted: 'Accepted',
  rejected: 'Rejected',
};

const QUARTILES = ['Q1', 'Q2', 'Q3', 'Q4'] as const;

// inline ~~strikethrough~~ rendering
function renderInline(text: string): ReactNode[] {
  return text.split(/~~(.*?)~~/g).map((p, i) => (i % 2 === 1 ? <s key={i}>{p}</s> : <span key={i}>{p}</span>));
}

interface Props {
  user: UserData;
  onChange: (next: UserData) => void;
  highlight?: string[]; // `sub:<id>` keys just changed via MCP — flash + scroll to them
}

export default function KanbanView({ user, onChange, highlight }: Props) {
  const boardRef = useRef<HTMLDivElement>(null);
  // when MCP changes arrive, bring the first flashed card into view
  useEffect(() => {
    if (highlight?.length)
      boardRef.current?.querySelector('.just-updated')?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  }, [highlight]);

  const [newTitle, setNewTitle] = useState('');
  const [journalQuery, setJournalQuery] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const [showJournals, setShowJournals] = useState(true);
  const [newJName, setNewJName] = useState('');
  const [listQuery, setListQuery] = useState('');
  const [editJournalId, setEditJournalId] = useState<string | null>(null);
  const [modalId, setModalId] = useState<string | null>(null);
  const [modalJournalText, setModalJournalText] = useState('');
  const notesRef = useRef<HTMLTextAreaElement>(null);

  const journalById = (id?: string) => user.journals.find((j) => j.id === id);
  const modalSub = user.submissions.find((s) => s.id === modalId);

  function resolveJournal(text: string): Journal | undefined {
    const q = text.trim().toLowerCase();
    if (!q) return undefined;
    const exact = user.journals.find((j) => j.name.toLowerCase() === q);
    if (exact) return exact;
    const partial = user.journals.filter((j) => j.name.toLowerCase().includes(q));
    return partial.length === 1 ? partial[0] : undefined;
  }

  function addSubmission() {
    const title = newTitle.trim();
    if (!title) return;
    const sub: Submission = {
      id: crypto.randomUUID(),
      title,
      journalId: resolveJournal(journalQuery)?.id,
      stage: 'idea',
      updatedAt: new Date().toISOString(),
    };
    onChange({ ...user, submissions: [...user.submissions, sub] });
    setNewTitle('');
    setJournalQuery('');
  }

  function updateSubmission(id: string, patch: Partial<Submission>) {
    onChange({
      ...user,
      submissions: user.submissions.map((s) =>
        s.id === id ? { ...s, ...patch, updatedAt: new Date().toISOString() } : s
      ),
    });
  }

  function moveSubmission(s: Submission, stage: Stage) {
    updateSubmission(s.id, {
      stage,
      submittedAt: stage === 'submitted' && !s.submittedAt ? new Date().toISOString() : s.submittedAt,
    });
  }

  function moveBy(s: Submission, delta: number) {
    const i = STAGES.indexOf(s.stage) + delta;
    if (i >= 0 && i < STAGES.length) moveSubmission(s, STAGES[i]);
  }

  function removeSubmission(id: string) {
    if (modalId === id) setModalId(null);
    onChange({ ...user, submissions: user.submissions.filter((s) => s.id !== id) });
  }

  function updateJournal(id: string, patch: Partial<Journal>) {
    onChange({ ...user, journals: user.journals.map((j) => (j.id === id ? { ...j, ...patch } : j)) });
  }

  function removeJournal(id: string) {
    onChange({
      ...user,
      journals: user.journals.filter((j) => j.id !== id),
      submissions: user.submissions.map((s) => (s.journalId === id ? { ...s, journalId: undefined } : s)),
    });
  }

  function addJournal() {
    const name = newJName.trim();
    if (!name) return;
    const j: Journal = { id: crypto.randomUUID(), name };
    onChange({ ...user, journals: [...user.journals, j] });
    setNewJName('');
    setEditJournalId(j.id); // open the editor so publisher/quartile/IF/link can be filled right away
  }

  function openModal(s: Submission) {
    setModalId(s.id);
    setModalJournalText(journalById(s.journalId)?.name ?? '');
  }

  // ── memo macros ──
  function insertCheckbox() {
    if (!modalSub) return;
    const ta = notesRef.current;
    const notes = modalSub.notes ?? '';
    const pos = ta?.selectionStart ?? notes.length;
    const lineStart = notes.lastIndexOf('\n', pos - 1) + 1;
    updateSubmission(modalSub.id, { notes: notes.slice(0, lineStart) + '- [ ] ' + notes.slice(lineStart) });
    requestAnimationFrame(() => {
      ta?.focus();
      ta?.setSelectionRange(pos + 6, pos + 6);
    });
  }

  function strikeSelection() {
    if (!modalSub) return;
    const ta = notesRef.current;
    const notes = modalSub.notes ?? '';
    const a = ta?.selectionStart ?? notes.length;
    const b = ta?.selectionEnd ?? notes.length;
    updateSubmission(modalSub.id, { notes: `${notes.slice(0, a)}~~${notes.slice(a, b)}~~${notes.slice(b)}` });
    requestAnimationFrame(() => {
      ta?.focus();
      ta?.setSelectionRange(a + 2, b + 2);
    });
  }

  function toggleLine(s: Submission, idx: number) {
    const lines = (s.notes ?? '').split('\n');
    lines[idx] = lines[idx].startsWith('- [x]')
      ? lines[idx].replace('- [x]', '- [ ]')
      : lines[idx].replace('- [ ]', '- [x]');
    updateSubmission(s.id, { notes: lines.join('\n') });
  }

  const filteredJournals = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    return q
      ? user.journals.filter((j) => `${j.name} ${j.publisher ?? ''}`.toLowerCase().includes(q))
      : user.journals;
  }, [user.journals, listQuery]);

  return (
    <div className="kanban-layout">
      <div className="kanban-main">
        <div className="toolbar">
          <input
            className="search"
            placeholder="New paper title…"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addSubmission()}
          />
          <input
            className="search"
            list="journal-options"
            placeholder="Search target journal (optional)…"
            value={journalQuery}
            onChange={(e) => setJournalQuery(e.target.value)}
          />
          <datalist id="journal-options">
            {user.journals.map((j) => (
              <option key={j.id} value={j.name} />
            ))}
          </datalist>
          <button onClick={addSubmission}>+ Add</button>
          <button className="chip" onClick={() => setShowJournals(!showJournals)}>
            {showJournals ? 'Hide journal panel' : 'Show journal panel'}
          </button>
        </div>
        <div className="kanban-board" ref={boardRef}>
          {STAGES.map((stage) => (
            <div
              key={stage}
              className={`kanban-col ${stage}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                const s = user.submissions.find((x) => x.id === dragId);
                if (s) moveSubmission(s, stage);
                setDragId(null);
              }}
            >
              <h3>
                {STAGE_LABELS[stage]}
                <span className="count">{user.submissions.filter((s) => s.stage === stage).length}</span>
              </h3>
              {user.submissions
                .filter((s) => s.stage === stage)
                .map((s) => {
                  const j = journalById(s.journalId);
                  const idx = STAGES.indexOf(s.stage);
                  return (
                    <div
                      key={s.id}
                      className={`kanban-card${highlight?.includes(`sub:${s.id}`) ? ' just-updated' : ''}`}
                      draggable
                      onDragStart={() => setDragId(s.id)}
                      onClick={() => openModal(s)}
                    >
                      <div className="card-title">
                        {s.title}
                        {s.notes && <span className="note-dot" title="Has notes">📝</span>}
                      </div>
                      {j && (
                        <div className="card-journal">
                          {j.name}
                          {j.quartile && <span className={`badge ${j.quartile}`}>{j.quartile}</span>}
                          {j.impactFactor != null && <span className="badge if">IF {j.impactFactor}</span>}
                        </div>
                      )}
                      <div className="card-meta" onClick={(e) => e.stopPropagation()}>
                        <button className="move" disabled={idx === 0} title="Previous stage" onClick={() => moveBy(s, -1)}>
                          ◀
                        </button>
                        <button
                          className="move"
                          disabled={idx === STAGES.length - 1}
                          title="Next stage"
                          onClick={() => moveBy(s, 1)}
                        >
                          ▶
                        </button>
                        <span className="dates">
                          {s.submittedAt && <>Planned {s.submittedAt.slice(0, 10)} · </>}
                          {s.updatedAt.slice(0, 10)}
                        </span>
                        <button className="del" title="Delete" onClick={() => removeSubmission(s.id)}>
                          ×
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>
          ))}
        </div>
      </div>

      {showJournals && (
        <aside className="journal-panel">
          <h2>Journals</h2>
          <p className="credit">Quartile data from SCImago Journal Rank (scimagojr.com) · IF entered manually</p>
          <div className="journal-add">
            <input placeholder="Search journals…" value={listQuery} onChange={(e) => setListQuery(e.target.value)} />
          </div>
          <div className="journal-add">
            <input
              placeholder="New journal name…"
              value={newJName}
              onChange={(e) => setNewJName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addJournal()}
            />
            <button onClick={addJournal}>+</button>
          </div>
          <ul className="journal-list">
            {filteredJournals.map((j) => (
              <li key={j.id}>
                <div className="journal-name">
                  {j.name}
                  <button
                    className="link edit-toggle"
                    title="Edit publisher/link"
                    onClick={() => setEditJournalId(editJournalId === j.id ? null : j.id)}
                  >
                    ✎
                  </button>
                  <button className="del" title="Delete journal" onClick={() => removeJournal(j.id)}>
                    ×
                  </button>
                </div>
                <div className="journal-meta">
                  {j.publisher && <span>{j.publisher} ·</span>}
                  <select
                    value={j.quartile ?? ''}
                    onChange={(e) =>
                      updateJournal(j.id, { quartile: (e.target.value || undefined) as Journal['quartile'] })
                    }
                  >
                    <option value="">Quartile —</option>
                    {QUARTILES.map((q) => (
                      <option key={q} value={q}>
                        {q}
                      </option>
                    ))}
                  </select>
                  IF{' '}
                  <input
                    className="if-input"
                    type="number"
                    step="0.1"
                    value={j.impactFactor ?? ''}
                    placeholder="—"
                    onChange={(e) =>
                      updateJournal(j.id, {
                        impactFactor: e.target.value === '' ? undefined : Number(e.target.value),
                      })
                    }
                  />
                  {j.link && (
                    <button className="link" title="Journal homepage" onClick={() => openExternal(j.link!)}>
                      ↗
                    </button>
                  )}
                </div>
                {editJournalId === j.id && (
                  <div className="journal-edit">
                    <input
                      placeholder="Publisher (e.g. Elsevier, MDPI)"
                      value={j.publisher ?? ''}
                      onChange={(e) => updateJournal(j.id, { publisher: e.target.value || undefined })}
                    />
                    <input
                      placeholder="Homepage URL"
                      value={j.link ?? ''}
                      onChange={(e) => updateJournal(j.id, { link: e.target.value || undefined })}
                    />
                    <button
                      className="link"
                      title="Look up this journal's quartile/rank on SCImago Journal Rank"
                      onClick={() =>
                        openExternal(`https://www.scimagojr.com/journalsearch.php?q=${encodeURIComponent(j.name)}`)
                      }
                    >
                      Check quartile on SJR ↗
                    </button>
                  </div>
                )}
              </li>
            ))}
            {filteredJournals.length === 0 && <li className="empty">No results</li>}
          </ul>
        </aside>
      )}

      {modalSub && (
        <div className="modal-overlay" onClick={() => setModalId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <input
                className="modal-title"
                value={modalSub.title}
                onChange={(e) => updateSubmission(modalSub.id, { title: e.target.value })}
              />
              <button className="del" title="Close" onClick={() => setModalId(null)}>
                ×
              </button>
            </div>
            <div className="modal-row">
              <label>
                Target journal{' '}
                <input
                  list="journal-options"
                  placeholder="Search journals…"
                  value={modalJournalText}
                  onChange={(e) => {
                    setModalJournalText(e.target.value);
                    updateSubmission(modalSub.id, { journalId: resolveJournal(e.target.value)?.id });
                  }}
                />
              </label>
              {(() => {
                const j = journalById(modalSub.journalId);
                return j?.quartile ? <span className={`badge ${j.quartile}`}>{j.quartile}</span> : null;
              })()}
              <label>
                Stage{' '}
                <select
                  value={modalSub.stage}
                  onChange={(e) => moveSubmission(modalSub, e.target.value as Stage)}
                >
                  {STAGES.map((st) => (
                    <option key={st} value={st}>
                      {STAGE_LABELS[st]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Planned submission{' '}
                <input
                  type="date"
                  value={modalSub.submittedAt?.slice(0, 10) ?? ''}
                  onChange={(e) =>
                    updateSubmission(modalSub.id, {
                      submittedAt: e.target.value ? `${e.target.value}T00:00:00.000Z` : undefined,
                    })
                  }
                />
              </label>
            </div>
            <div className="memo-toolbar">
              <button onClick={insertCheckbox} title="Turn current line into a checkbox">☑ Checkbox</button>
              <button onClick={strikeSelection} title="Strike through selected text">~~Strike~~</button>
              <span className="manage-hint">Click checkboxes in the preview below to mark them done</span>
            </div>
            <textarea
              ref={notesRef}
              className="modal-notes"
              placeholder={'Notes — reviewer comments, revision plans, links…\n- [ ] Checkbox item\n~~Strikethrough~~'}
              value={modalSub.notes ?? ''}
              onChange={(e) => updateSubmission(modalSub.id, { notes: e.target.value })}
            />
            {(modalSub.notes ?? '').trim() && (
              <div className="memo-preview">
                {(modalSub.notes ?? '').split('\n').map((line, i) => {
                  const m = line.match(/^- \[( |x)\] ?(.*)$/);
                  if (m)
                    return (
                      <label key={i} className="check-line">
                        <input type="checkbox" checked={m[1] === 'x'} onChange={() => toggleLine(modalSub, i)} />
                        <span className={m[1] === 'x' ? 'done' : ''}>{renderInline(m[2])}</span>
                      </label>
                    );
                  return line.trim() ? <p key={i}>{renderInline(line)}</p> : <div key={i} className="blank" />;
                })}
              </div>
            )}
            <div className="modal-foot">
              <button className="danger-btn" onClick={() => removeSubmission(modalSub.id)}>
                Delete card
              </button>
              <button onClick={() => setModalId(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
