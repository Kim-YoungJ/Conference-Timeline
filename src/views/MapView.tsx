import { useEffect, useMemo, useRef, useState } from 'react';
import { openExternal } from '../data/env';
import type { Conference, ConferenceYear } from '../data/types';
import { deadlineState, dday, fmtSchedule, nextMilestone, type DeadlineState } from '../data/util';
import { countryPaths, MAP_H, MAP_W, project } from '../map/worldPaths';

interface Props {
  conferences: Conference[];
  tracked: string[];
  onToggleTrack: (slug: string) => void;
  onDeleteYear: (slug: string, yearId: string) => void;
}

interface Pin {
  conf: Conference;
  year: ConferenceYear;
  x: number;
  y: number;
  state: DeadlineState;
}

// pins sharing the same coordinates (same city) group into one numbered marker
interface Cluster {
  key: string;
  x: number;
  y: number;
  pins: Pin[];
}

const MIN_W = MAP_W / 10;

export default function MapView({ conferences, tracked, onToggleTrack, onDeleteYear }: Props) {
  const thisYear = new Date().getFullYear();
  const [yearFilter, setYearFilter] = useState<number | 'all'>(thisYear);
  const [selected, setSelected] = useState<Cluster | null>(null);
  const [hovered, setHovered] = useState<Cluster | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, w: MAP_W, h: MAP_H });
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ px: number; py: number; moved: boolean } | null>(null);
  const scale = view.w / MAP_W; // keeps pins/strokes constant on screen while zooming

  const allYears = useMemo(
    () => [...new Set(conferences.flatMap((c) => c.years.map((y) => y.year)))].sort(),
    [conferences]
  );

  const clusters: Cluster[] = useMemo(() => {
    const map = new Map<string, Cluster>();
    for (const conf of conferences) {
      for (const year of conf.years) {
        if ((yearFilter !== 'all' && year.year !== yearFilter) || year.lat == null || year.lng == null) continue;
        const [x, y] = project(year.lat, year.lng);
        const key = `${x.toFixed(1)},${y.toFixed(1)}`;
        const pin: Pin = { conf, year, x, y, state: deadlineState(year) };
        const c = map.get(key);
        if (c) c.pins.push(pin);
        else map.set(key, { key, x, y, pins: [pin] });
      }
    }
    return [...map.values()];
  }, [conferences, yearFilter]);

  function clampView(x: number, y: number, w: number, h: number) {
    return {
      x: Math.min(Math.max(x, 0), MAP_W - w),
      y: Math.min(Math.max(y, 0), MAP_H - h),
      w,
      h,
    };
  }

  function zoomBy(factor: number) {
    setView((v) => {
      const w = Math.min(MAP_W, Math.max(MIN_W, v.w * factor));
      const h = w / 2;
      const cx = v.x + v.w / 2;
      const cy = v.y + v.h / 2;
      return clampView(cx - w / 2, cy - h / 2, w, h);
    });
  }

  // wheel zoom at cursor — native listener because React's synthetic wheel is passive
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width;
      const py = (e.clientY - rect.top) / rect.height;
      setView((v) => {
        const factor = e.deltaY > 0 ? 1.2 : 1 / 1.2;
        const w = Math.min(MAP_W, Math.max(MIN_W, v.w * factor));
        const h = w / 2;
        const cx = v.x + px * v.w;
        const cy = v.y + py * v.h;
        return clampView(cx - px * w, cy - py * h, w, h);
      });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  const active = hovered ?? selected;

  function clusterState(c: Cluster): DeadlineState {
    return c.pins.some((p) => p.state !== 'past') ? 'ok' : 'past';
  }

  return (
    <div className="mapview">
      <div className="toolbar">
        <div className="chips">
          <button className={yearFilter === 'all' ? 'chip active' : 'chip'} onClick={() => setYearFilter('all')}>
            All years
          </button>
          {allYears.map((y) => (
            <button key={y} className={yearFilter === y ? 'chip active' : 'chip'} onClick={() => setYearFilter(y)}>
              {y}
            </button>
          ))}
        </div>
        <span className="map-hint">Scroll to zoom · drag to pan · numbered circles = conferences in the same city</span>
        <div className="zoom-controls">
          <button onClick={() => zoomBy(1 / 1.5)} title="Zoom in">＋</button>
          <button onClick={() => zoomBy(1.5)} title="Zoom out">−</button>
          <button onClick={() => setView({ x: 0, y: 0, w: MAP_W, h: MAP_H })} title="Reset view">⟲</button>
        </div>
      </div>
      <div className="map-wrap">
        <svg
          ref={svgRef}
          viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
          className="worldmap"
          onPointerDown={(e) => {
            drag.current = { px: e.clientX, py: e.clientY, moved: false };
            (e.target as Element).setPointerCapture?.(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            const rect = svgRef.current!.getBoundingClientRect();
            const dx = ((e.clientX - d.px) / rect.width) * view.w;
            const dy = ((e.clientY - d.py) / rect.height) * view.h;
            if (Math.abs(e.clientX - d.px) + Math.abs(e.clientY - d.py) > 3) d.moved = true;
            drag.current = { px: e.clientX, py: e.clientY, moved: d.moved };
            setView((v) => clampView(v.x - dx, v.y - dy, v.w, v.h));
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerLeave={() => {
            drag.current = null;
          }}
        >
          {countryPaths.map((d, i) => (
            <path key={i} d={d} className="country" style={{ strokeWidth: 0.5 * scale }} />
          ))}
          {clusters.map((c) => {
            const isTracked = c.pins.some((p) => tracked.includes(p.conf.slug));
            const multi = c.pins.length > 1;
            return (
              <g
                key={c.key}
                className={`pin ${clusterState(c)} ${isTracked ? 'tracked' : ''} ${
                  selected?.key === c.key ? 'selected' : ''
                }`}
                transform={`translate(${c.x},${c.y})`}
                onMouseEnter={() => setHovered(c)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => {
                  if (!drag.current?.moved) setSelected(c);
                }}
              >
                <circle r={(multi ? 12 : 7) * scale} className="pin-hit" />
                <circle r={(multi ? 8.5 : 4.5) * scale} className="pin-dot" style={{ strokeWidth: 1.2 * scale }} />
                {multi && (
                  <text className="pin-count" textAnchor="middle" dy="0.35em" style={{ fontSize: 9 * scale }}>
                    {c.pins.length}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {active && (
          <div
            className="map-tooltip"
            style={{
              left: `${((active.x - view.x) / view.w) * 100}%`,
              top: `${((active.y - view.y) / view.h) * 100}%`,
            }}
          >
            {active.pins.length === 1 ? (
              <>
                <strong>
                  {active.pins[0].conf.title} {active.pins[0].year.year}
                </strong>
                <div>📍 {active.pins[0].year.place}</div>
                <div>🗓 {active.pins[0].year.dateText || 'TBD'}</div>
                <div>
                  {(() => {
                    const n = nextMilestone(active.pins[0].year);
                    if (n) return `Next: ${n.label} ${fmtSchedule(n, active.pins[0].year.timezone)} (D-${Math.max(dday(n.date), 0)})`;
                    return active.pins[0].state === 'past' ? 'Ended' : 'Schedule TBD';
                  })()}
                </div>
              </>
            ) : (
              <>
                <strong>📍 {active.pins[0].year.place} — {active.pins.length} conferences</strong>
                {active.pins.map((p) => {
                  const n = nextMilestone(p.year);
                  return (
                    <div key={p.year.id}>
                      {p.conf.title} {p.year.year}
                      {n && ` · ${n.label} D-${Math.max(dday(n.date), 0)}`}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}
      </div>
      {selected && selected.pins.length > 1 && (
        <div className="map-detail">
          <div className="conf-title">
            <strong>📍 {selected.pins[0].year.place}</strong>
            <span className="badge rank">{selected.pins.length} conferences</span>
          </div>
          <ul className="cluster-list">
            {selected.pins.map((p) => {
              const n = nextMilestone(p.year);
              return (
                <li key={p.year.id}>
                  <button className="link" onClick={() => setSelected({ ...selected, key: selected.key, pins: [p] })}>
                    {p.conf.title} {p.year.year}
                  </button>
                  <span className={`dday ${p.state}`}>
                    {p.state === 'tbd' ? 'TBD' : p.state === 'past' ? 'Ended' : `D-${Math.max(dday(n!.date), 0)}`}
                  </span>
                  <span className="cluster-date">{p.year.dateText}</span>
                </li>
              );
            })}
          </ul>
          <div className="detail-actions">
            <button onClick={() => setSelected(null)}>Close</button>
          </div>
        </div>
      )}
      {selected && selected.pins.length === 1 && (
        <div className="map-detail">
          {(() => {
            const p = selected.pins[0];
            return (
              <>
                <div className="conf-title">
                  <strong>
                    {p.conf.title} {p.year.year}
                  </strong>
                  {p.conf.rank && <span className="badge rank">{p.conf.rank}</span>}
                  <span className={`dday ${p.state}`}>
                    {p.state === 'tbd'
                      ? 'TBD'
                      : p.state === 'past'
                        ? 'Ended'
                        : `D-${Math.max(dday(nextMilestone(p.year)!.date), 0)}`}
                  </span>
                </div>
                <div className="conf-sub">{p.conf.fullName}</div>
                <div className="conf-meta">
                  📍 {p.year.place} · 🗓 {p.year.dateText || 'TBD'} ·{' '}
                  {(() => {
                    const n = nextMilestone(p.year);
                    if (n) return `Next: ${n.label} ${fmtSchedule(n, p.year.timezone)}`;
                    return p.state === 'past' ? 'Ended' : 'Schedule TBD';
                  })()}
                </div>
                <div className="detail-actions">
                  <button onClick={() => onToggleTrack(p.conf.slug)}>
                    {tracked.includes(p.conf.slug) ? '★ Untrack' : '☆ Track'}
                  </button>
                  {p.year.link && <button onClick={() => openExternal(p.year.link)}>Official site ↗</button>}
                  {p.conf.source === 'custom' && (
                    <button
                      className="danger-btn"
                      title="Delete this year's record"
                      onClick={() => {
                        onDeleteYear(p.conf.slug, p.year.id);
                        setSelected(null);
                      }}
                    >
                      Delete this record
                    </button>
                  )}
                  <button onClick={() => setSelected(null)}>Close</button>
                </div>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
