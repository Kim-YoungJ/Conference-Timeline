// MCP inbox: Claude Desktop's MCP server queues operations in mcp-inbox.json
// (app data dir); the app polls, merges them into user state, then clears the file.
import { BaseDirectory, exists, readTextFile, remove } from '@tauri-apps/plugin-fs';
import { parseImport } from './importConf';
import type { Conference, Journal, Stage, Submission, UserData } from './types';
import { STAGES } from './types';

const FILE = 'mcp-inbox.json';
const OPT = { baseDir: BaseDirectory.AppData };

export interface InboxOp {
  type: 'add_conferences' | 'track' | 'add_journals' | 'add_submission' | 'append_note';
  [k: string]: unknown;
}

export async function readInbox(): Promise<InboxOp[] | null> {
  if (!(await exists(FILE, OPT))) return null;
  try {
    const parsed = JSON.parse(await readTextFile(FILE, OPT)) as { ops?: InboxOp[] };
    return Array.isArray(parsed.ops) ? parsed.ops : [];
  } catch {
    return [];
  }
}

export async function clearInbox(): Promise<void> {
  await remove(FILE, OPT).catch(() => undefined);
}

function findByTitle(all: Conference[], title: string): Conference | undefined {
  const q = title.trim().toLowerCase();
  return (
    all.find((c) => c.slug === q || c.title.toLowerCase() === q) ??
    all.find((c) => c.title.toLowerCase().includes(q) || c.fullName.toLowerCase().includes(q))
  );
}

// pure merge of queued ops into user state; returns a short summary for the UI
// plus `changed`: keys of items touched, so the UI can flash + scroll to them
export function applyOps(
  ops: InboxOp[],
  user: UserData
): { user: UserData; summary: string; changed: string[] } {
  let next = user;
  const done: string[] = [];
  const changed: string[] = [];

  for (const op of ops) {
    try {
      if (op.type === 'add_conferences') {
        const confs = parseImport(JSON.stringify(op.conferences));
        const customs = [...next.customConferences];
        let tracked = next.tracked;
        for (const c of confs) {
          const i = customs.findIndex(
            (x) => x.slug === c.slug || x.title.toLowerCase() === c.title.toLowerCase()
          );
          const slug = i >= 0 ? customs[i].slug : c.slug;
          if (i >= 0) customs[i] = { ...c, slug };
          else customs.push(c);
          if (op.track && !tracked.includes(slug)) tracked = [...tracked, slug];
          changed.push(`conf:${slug}`);
        }
        next = { ...next, customConferences: customs, tracked };
        done.push(`Added ${confs.length} conference(s)${op.track ? ' + tracked' : ''}`);
      } else if (op.type === 'track') {
        const titles = (op.titles as string[]) ?? [];
        let tracked = next.tracked;
        let hit = 0;
        for (const t of titles) {
          const conf = findByTitle(next.customConferences, t);
          if (!conf) continue;
          hit++;
          changed.push(`conf:${conf.slug}`);
          tracked = op.untrack
            ? tracked.filter((s) => s !== conf.slug)
            : tracked.includes(conf.slug)
              ? tracked
              : [...tracked, conf.slug];
        }
        next = { ...next, tracked };
        done.push(`${op.untrack ? 'Untracked' : 'Tracked'} ${hit}`);
      } else if (op.type === 'add_journals') {
        const incoming = (op.journals as Partial<Journal>[]) ?? [];
        const journals = [...next.journals];
        for (const nj of incoming) {
          if (!nj.name) continue;
          const i = journals.findIndex((j) => j.name.toLowerCase() === nj.name!.toLowerCase());
          if (i >= 0) {
            // fill/update only the fields Claude provided
            journals[i] = {
              ...journals[i],
              ...(nj.publisher !== undefined && { publisher: nj.publisher }),
              ...(nj.quartile !== undefined && { quartile: nj.quartile }),
              ...(nj.impactFactor !== undefined && { impactFactor: nj.impactFactor }),
              ...(nj.link !== undefined && { link: nj.link }),
            };
          } else {
            journals.push({ id: crypto.randomUUID(), name: nj.name, ...nj });
          }
        }
        next = { ...next, journals };
        done.push(`Updated ${incoming.length} journal(s)`);
      } else if (op.type === 'add_submission') {
        const jq = typeof op.journal === 'string' ? op.journal.trim().toLowerCase() : '';
        const journal =
          next.journals.find((j) => j.name.toLowerCase() === jq) ??
          (next.journals.filter((j) => j.name.toLowerCase().includes(jq)).length === 1 && jq
            ? next.journals.find((j) => j.name.toLowerCase().includes(jq))
            : undefined);
        const stage = STAGES.includes(op.stage as Stage) ? (op.stage as Stage) : 'idea';
        const sub: Submission = {
          id: crypto.randomUUID(),
          title: String(op.title ?? 'Untitled'),
          journalId: journal?.id,
          stage,
          notes: typeof op.notes === 'string' ? op.notes : undefined,
          submittedAt:
            typeof op.plannedDate === 'string' && op.plannedDate
              ? `${op.plannedDate}T00:00:00.000Z`
              : undefined,
          updatedAt: new Date().toISOString(),
        };
        next = { ...next, submissions: [...next.submissions, sub] };
        changed.push(`sub:${sub.id}`);
        done.push(`Added card "${sub.title}"`);
      } else if (op.type === 'append_note') {
        const q = String(op.title ?? '').trim().toLowerCase();
        const exact = next.submissions.filter((s) => s.title.toLowerCase() === q);
        const partial = next.submissions.filter((s) => s.title.toLowerCase().includes(q));
        const target = exact[0] ?? (partial.length === 1 ? partial[0] : undefined);
        if (!target) {
          done.push(`Card "${op.title}" not found for note`);
          continue;
        }
        next = {
          ...next,
          submissions: next.submissions.map((s) =>
            s.id === target.id
              ? {
                  ...s,
                  notes: `${s.notes ? `${s.notes}\n` : ''}${String(op.note ?? '')}`,
                  updatedAt: new Date().toISOString(),
                }
              : s
          ),
        };
        changed.push(`sub:${target.id}`);
        done.push(`Added note to "${target.title}"`);
      }
    } catch (e) {
      done.push(`Operation failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { user: next, summary: done.join(', '), changed };
}
