#!/usr/bin/env node
// MCP server for Conference Timeline — lets any MCP client (Claude Desktop,
// Claude Code, Codex CLI, …) research conferences, journals, and kanban items
// and push them straight into the app.
// Writes operations to an inbox queue file; the app polls and merges it
// (never touches store.json directly, so no write conflicts with the app).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const APP_ID = 'com.yjkim.conference-timeline';
// must mirror Tauri's app data dir on each OS
const dataDir =
  process.platform === 'win32'
    ? path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), APP_ID)
    : process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support', APP_ID)
      : path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share'), APP_ID);
const inboxPath = path.join(dataDir, 'mcp-inbox.json');
const storePath = path.join(dataDir, 'store.json');

function pushOps(...ops) {
  fs.mkdirSync(dataDir, { recursive: true });
  let queue = { ops: [] };
  try {
    queue = JSON.parse(fs.readFileSync(inboxPath, 'utf8'));
  } catch {
    /* no inbox yet */
  }
  queue.ops.push(...ops);
  fs.writeFileSync(inboxPath, JSON.stringify(queue));
  return `Queued ${ops.length} operation(s). Applied within seconds if the app is running, otherwise on next launch.`;
}

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(storePath, 'utf8'));
  } catch {
    return null;
  }
}

const text = (t) => ({ content: [{ type: 'text', text: t }] });

const server = new McpServer({ name: 'conference-timeline', version: '1.0.0' });

const yearSchema = z.object({
  year: z.number().describe('event year'),
  link: z.string().optional().describe('official site URL'),
  schedule: z
    .array(
      z.object({
        label: z.string().describe('label exactly as it appears in the site\'s Important Dates table (e.g. "Full paper deadline")'),
        date: z.string().nullable().describe('ISO date with timezone offset (e.g. 2026-09-15T23:59:00-08:00), null if unknown'),
      })
    )
    .optional()
    .describe(
      'the full official Important Dates table in chronological order, labels as-is (mark extended deadlines as extended). Always end with "Conference start"/"Conference end", event dates as YYYY-MM-DD without a time'
    ),
  deadline: z.string().nullable().optional().describe('(legacy field) paper submission deadline ISO — omit when schedule is provided'),
  abstractDeadline: z.string().optional().describe('(legacy field) abstract deadline ISO'),
  timezone: z.string().optional().describe('deadline timezone as announced by the conference — prefer "UTC±N", name allowed (e.g. "AoE", "UTC-7 (PT)", "KST")'),
  dateText: z.string().optional().describe('display text for the event dates (e.g. Jun 1-5, 2027)'),
  place: z.string().optional().describe('venue as "City, Country" (e.g. Vienna, Austria)'),
});

server.registerTool(
  'add_conferences',
  {
    description:
      'Add conferences to the Conference Timeline app. First research the latest (upcoming edition) official Important Dates (abstract/paper deadlines, notification, camera-ready, event dates) and venue on the web, then call with the schedule array using labels as-is. Conferences with the same name are updated.',
    inputSchema: {
      conferences: z.array(
        z.object({
          title: z.string().describe('conference acronym (e.g. ICRA)'),
          fullName: z.string().optional().describe('full conference name'),
          years: z.array(yearSchema).min(1),
        })
      ),
      track: z.boolean().optional().describe('if true, immediately track (★) the added conferences'),
    },
  },
  async ({ conferences, track }) => text(pushOps({ type: 'add_conferences', conferences, track: !!track }))
);

server.registerTool(
  'track_conferences',
  {
    description: 'Add or remove conferences already in the app from the tracked (★) list. Matched by name.',
    inputSchema: {
      titles: z.array(z.string()).describe('conference acronyms (e.g. ["ICRA", "IROS"])'),
      untrack: z.boolean().optional().describe('if true, untrack instead'),
    },
  },
  async ({ titles, untrack }) => text(pushOps({ type: 'track', titles, untrack: !!untrack }))
);

server.registerTool(
  'add_journals',
  {
    description: 'Add journals to the app journal list. If a name already exists, only the provided fields are updated. Quartile is the best quartile per SJR (scimagojr.com).',
    inputSchema: {
      journals: z.array(
        z.object({
          name: z.string(),
          publisher: z.string().optional(),
          quartile: z.enum(['Q1', 'Q2', 'Q3', 'Q4']).optional(),
          impactFactor: z.number().optional(),
          link: z.string().optional().describe('journal homepage URL'),
        })
      ),
    },
  },
  async ({ journals }) => text(pushOps({ type: 'add_journals', journals }))
);

server.registerTool(
  'add_submission',
  {
    description: 'Add a paper card to the journal kanban. notes can hold plans/ideas worked out with the assistant (- [ ] checkbox and ~~strikethrough~~ syntax supported).',
    inputSchema: {
      title: z.string().describe('paper title'),
      journal: z.string().optional().describe('target journal name (matched by name against the app journal list)'),
      stage: z.enum(['idea', 'drafting', 'submitted', 'review', 'revision', 'accepted', 'rejected']).optional(),
      notes: z.string().optional().describe('note contents'),
      plannedDate: z.string().optional().describe('planned submission date YYYY-MM-DD'),
    },
  },
  async (input) => text(pushOps({ type: 'add_submission', ...input }))
);

server.registerTool(
  'append_note',
  {
    description: 'Append to a kanban card\'s notes. The card is matched by paper title (partial match allowed).',
    inputSchema: {
      title: z.string().describe('paper title of the target card (a unique substring is enough)'),
      note: z.string().describe('note to append. - [ ] checkboxes and ~~strikethrough~~ allowed'),
    },
  },
  async ({ title, note }) => text(pushOps({ type: 'append_note', title, note }))
);

server.registerTool(
  'list_state',
  {
    description: 'Summarize the app\'s current state (conferences/tracked/journals/kanban cards). Call before adding or editing to check for duplicates.',
    inputSchema: {},
  },
  async () => {
    const store = readStore();
    if (!store) return text('No app data yet (launch the app once first).');
    const customConfs = (store.user?.customConferences ?? []).map((c) => `${c.title} (${c.years.map((y) => y.year).join('/')})`);
    const pendingOps = (() => {
      try {
        return JSON.parse(fs.readFileSync(inboxPath, 'utf8')).ops.length;
      } catch {
        return 0;
      }
    })();
    return text(
      [
        `Tracked: ${(store.user?.tracked ?? []).join(', ') || 'none'}`,
        `Conferences: ${customConfs.join('; ') || 'none'}`,
        `Journals (${store.user?.journals?.length ?? 0}): ${(store.user?.journals ?? []).map((j) => j.name).slice(0, 40).join('; ')}`,
        `Kanban cards: ${(store.user?.submissions ?? []).map((s) => `"${s.title}" [${s.stage}]`).join('; ') || 'none'}`,
        `Pending operations not yet applied: ${pendingOps}`,
      ].join('\n')
    );
  }
);

await server.connect(new StdioServerTransport());
