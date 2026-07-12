import { useEffect, useMemo, useRef, useState } from 'react';
import type { Conference, UserData } from './data/types';
import { isTauri } from './data/env';
import { applyOps, clearInbox, readInbox } from './data/inbox';
import { loadUser, saveUser } from './data/store';
import TimelineView from './views/TimelineView';
import MapView from './views/MapView';
import KanbanView from './views/KanbanView';
import './App.css';

type Tab = 'map' | 'timeline' | 'kanban';

export default function App() {
  const [tab, setTab] = useState<Tab>('timeline');
  const [user, setUser] = useState<UserData | null>(null);
  const [inboxNotice, setInboxNotice] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string[]>([]); // keys of MCP-touched items to flash
  const userRef = useRef<UserData | null>(null);
  userRef.current = user;

  useEffect(() => {
    (async () => {
      const u = await loadUser();
      // drop tracked slugs that no longer resolve (e.g. leftovers from the removed ccfddl sync)
      const tracked = u.tracked.filter((s) => u.customConferences.some((c) => c.slug === s));
      const next = tracked.length === u.tracked.length ? u : { ...u, tracked };
      setUser(next);
      if (next !== u) void saveUser(next);
    })();
  }, []);

  // poll the MCP inbox (Claude Desktop → app); Tauri only
  useEffect(() => {
    if (!isTauri) return;
    let busy = false;
    async function poll() {
      if (busy || !userRef.current) return;
      busy = true;
      try {
        const ops = await readInbox();
        if (ops && ops.length > 0) {
          const { user: nextUser, summary, changed } = applyOps(ops, userRef.current);
          setUser(nextUser);
          await saveUser(nextUser);
          await clearInbox();
          setInboxNotice(`Claude update: ${summary}`);
          if (changed.length) {
            // flash the changed items (only visible on the tab the user is already on — no auto tab switch)
            setHighlight(changed);
            setTimeout(() => setHighlight([]), 4500);
          }
          setTimeout(() => setInboxNotice(null), 8000);
        } else if (ops) {
          await clearInbox(); // empty/corrupt inbox — drop it
        }
      } catch {
        /* transient fs errors — retry next tick */
      }
      busy = false;
    }
    const id = setInterval(poll, 5000);
    window.addEventListener('focus', poll);
    void poll();
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', poll);
    };
  }, []);

  function updateUser(next: UserData) {
    setUser(next);
    void saveUser(next);
  }

  const conferences: Conference[] = useMemo(() => user?.customConferences ?? [], [user]);

  if (!user) return <div className="loading">Loading…</div>;

  const toggleTrack = (slug: string) =>
    updateUser({
      ...user,
      tracked: user.tracked.includes(slug) ? user.tracked.filter((s) => s !== slug) : [...user.tracked, slug],
    });

  return (
    <div className="app">
      <header className="topbar">
        <h1>Conference Timeline</h1>
        <nav className="tabs">
          <button className={tab === 'map' ? 'active' : ''} onClick={() => setTab('map')}>Map</button>
          <button className={tab === 'timeline' ? 'active' : ''} onClick={() => setTab('timeline')}>Timeline</button>
          <button className={tab === 'kanban' ? 'active' : ''} onClick={() => setTab('kanban')}>Journal Kanban</button>
        </nav>
        <div className="sync">
          {inboxNotice && <span className="inbox-notice" title={inboxNotice}>🤖 {inboxNotice}</span>}
        </div>
      </header>
      <main>
        {tab === 'map' && (
          <MapView
            conferences={conferences}
            tracked={user.tracked}
            onToggleTrack={toggleTrack}
            onDeleteYear={(slug, yearId) => {
              const pruned = user.customConferences
                .map((c) => (c.slug === slug ? { ...c, years: c.years.filter((y) => y.id !== yearId) } : c))
                .filter((c) => c.years.length > 0);
              updateUser({
                ...user,
                customConferences: pruned,
                tracked: pruned.some((c) => c.slug === slug) ? user.tracked : user.tracked.filter((s) => s !== slug),
              });
            }}
          />
        )}
        {tab === 'timeline' && (
          <TimelineView
            conferences={conferences}
            tracked={user.tracked}
            highlight={highlight}
            onToggleTrack={toggleTrack}
            onSaveCustom={(conf) =>
              updateUser({
                ...user,
                customConferences: user.customConferences.some((c) => c.slug === conf.slug)
                  ? user.customConferences.map((c) => (c.slug === conf.slug ? conf : c))
                  : [...user.customConferences, conf],
              })
            }
            onDeleteCustom={(slug) =>
              updateUser({
                ...user,
                customConferences: user.customConferences.filter((c) => c.slug !== slug),
                tracked: user.tracked.filter((s) => s !== slug),
              })
            }
            onImport={(confs) => {
              const next = [...user.customConferences];
              let added = 0;
              let updated = 0;
              for (const c of confs) {
                const i = next.findIndex(
                  (x) => x.slug === c.slug || x.title.toLowerCase() === c.title.toLowerCase()
                );
                if (i >= 0) {
                  next[i] = { ...c, slug: next[i].slug };
                  updated++;
                } else {
                  next.push(c);
                  added++;
                }
              }
              updateUser({ ...user, customConferences: next });
              return { added, updated };
            }}
            onCleanup={(beforeYear) => {
              const pruned = user.customConferences
                .map((c) => ({ ...c, years: c.years.filter((y) => y.year >= beforeYear) }))
                .filter((c) => c.years.length > 0);
              const removed =
                user.customConferences.reduce((n, c) => n + c.years.length, 0) -
                pruned.reduce((n, c) => n + c.years.length, 0);
              const slugs = new Set(pruned.map((c) => c.slug));
              updateUser({
                ...user,
                customConferences: pruned,
                tracked: user.tracked.filter((s) => slugs.has(s)),
              });
              return removed;
            }}
          />
        )}
        {tab === 'kanban' && <KanbanView user={user} onChange={updateUser} highlight={highlight} />}
      </main>
    </div>
  );
}
