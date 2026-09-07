import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Columns3,
  Cookie,
  Copy,
  Download,
  Fingerprint,
  Globe,
  Inbox,
  Loader2,
  Play,
  Plus,
  Search,
  SlidersHorizontal,
  Square,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import type { SessionRecord } from '../types';
import { CheckBox, CopyButton, Empty, Pager, Toolbar, useElapsed, usePaged, useStored } from '../ui';
import { fptShort } from './FingerprintPanel';

type Filter = 'all' | 'live' | 'queued' | 'ready' | 'error';
type SortKey = 'id' | 'status' | 'cookieCount' | 'lastOpenedAt';
type ColumnId = 'proxy' | 'fingerprint' | 'cookies' | 'opened' | 'tags';

const FILTERS: Filter[] = ['all', 'live', 'queued', 'ready', 'error'];
const STATUS_RANK: Record<string, number> = { live: 0, queued: 1, error: 2, ready: 3, completed: 4 };
const ALL_COLUMNS: { id: ColumnId; label: string }[] = [
  { id: 'proxy', label: 'Proxy' },
  { id: 'fingerprint', label: 'Fingerprint' },
  { id: 'tags', label: 'Tags' },
  { id: 'cookies', label: 'Cookies' },
  { id: 'opened', label: 'Opened' },
];

const AVATAR_COLORS = [
  '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
  '#ec4899', '#f43f5e', '#ef4444', '#f97316',
  '#f59e0b', '#84cc16', '#22c55e', '#14b8a6',
  '#06b6d4', '#3b82f6', '#2563eb', '#7c3aed',
];

function avatarColor(id: string, color?: string): string {
  if (color) return color;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function initials(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase() || '??';
}

const ago = (iso?: string) => {
  if (!iso) return '—';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

/* ------------------------------------------------------------------ *
 * Context Menu
 * ------------------------------------------------------------------ */

type CtxPos = { x: number; y: number } | null;

const ContextMenu: React.FC<{
  pos: CtxPos;
  session: SessionRecord | null;
  onClose: () => void;
  onLaunch: () => void;
  onStop: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onCopyProxy: () => void;
  onPreview: () => void;
}> = ({ pos, session, onClose, onLaunch, onStop, onEdit, onDelete, onCopyProxy, onPreview }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pos) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent && e.key === 'Escape') { onClose(); return; }
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
    };
  }, [pos, onClose]);

  if (!pos || !session) return null;

  const live = session.status === 'live';

  // Keep menu within viewport
  const style: React.CSSProperties = {
    left: Math.min(pos.x, window.innerWidth - 200),
    top: Math.min(pos.y, window.innerHeight - 280),
  };

  return (
    <div className="ctx-menu" style={style} ref={ref}>
      <button className="ctx-item" onClick={() => { onPreview(); onClose(); }}>
        <SlidersHorizontal size={14} strokeWidth={1.75} />
        <span className="ctx-label">Quick view</span>
      </button>
      {live ? (
        <button className="ctx-item" onClick={() => { onStop(); onClose(); }}>
          <Square size={14} strokeWidth={2} />
          <span className="ctx-label">Stop</span>
        </button>
      ) : (
        <button className="ctx-item" onClick={() => { onLaunch(); onClose(); }}>
          <Play size={14} strokeWidth={2} />
          <span className="ctx-label">Launch</span>
          <span className="ctx-shortcut">⏎</span>
        </button>
      )}
      <div className="ctx-sep" />
      {session.proxy?.host && (
        <button className="ctx-item" onClick={() => { onCopyProxy(); onClose(); }}>
          <Copy size={14} strokeWidth={1.75} />
          <span className="ctx-label">Copy proxy</span>
        </button>
      )}
      <button className="ctx-item" onClick={() => { onEdit(); onClose(); }}>
        <SlidersHorizontal size={14} strokeWidth={1.75} />
        <span className="ctx-label">Configure</span>
      </button>
      <div className="ctx-sep" />
      <button className="ctx-item danger" onClick={() => { onDelete(); onClose(); }}>
        <Trash2 size={14} strokeWidth={1.75} />
        <span className="ctx-label">Delete</span>
        <span className="ctx-shortcut">Del</span>
      </button>
    </div>
  );
};

/* ------------------------------------------------------------------ *
 * Column Picker
 * ------------------------------------------------------------------ */

const ColumnPicker: React.FC<{
  visible: ColumnId[];
  onChange: (cols: ColumnId[]) => void;
  open: boolean;
  onToggle: () => void;
}> = ({ visible, onChange, open, onToggle }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onToggle();
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open, onToggle]);

  const toggle = (id: ColumnId) => {
    onChange(
      visible.includes(id) ? visible.filter((c) => c !== id) : [...visible, id]
    );
  };

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button className="icon-btn" onClick={onToggle} data-tip="Columns" aria-label="Toggle columns">
        <Columns3 size={15} strokeWidth={1.75} />
      </button>
      {open && (
        <div
          className="ctx-menu"
          style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, minWidth: 160 }}
        >
          {ALL_COLUMNS.map((col) => (
            <button
              key={col.id}
              className="ctx-item"
              onClick={() => toggle(col.id)}
              style={{ fontWeight: visible.includes(col.id) ? 500 : 400 }}
            >
              <span
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 3,
                  border: `1.5px solid ${visible.includes(col.id) ? 'var(--accent)' : 'var(--txt-3)'}`,
                  background: visible.includes(col.id) ? 'var(--accent-soft)' : 'transparent',
                  display: 'grid',
                  placeItems: 'center',
                  flexShrink: 0,
                }}
              >
                {visible.includes(col.id) && (
                  <span style={{ width: 6, height: 6, borderRadius: 1, background: 'var(--accent)' }} />
                )}
              </span>
              <span className="ctx-label">{col.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ *
 * Status Filter Dropdown
 * ------------------------------------------------------------------ */

const StatusFilterDropdown: React.FC<{
  filter: Filter;
  onChange: (f: Filter) => void;
  counts: Record<Filter, number>;
}> = ({ filter, onChange, counts }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  const items: { id: Filter; label: string; dotClass: string }[] = [
    { id: 'all', label: 'All Sessions', dotClass: 'dot-all' },
    { id: 'live', label: 'Live Running', dotClass: 'dot-live' },
    { id: 'queued', label: 'Queued', dotClass: 'dot-queued' },
    { id: 'ready', label: 'Ready', dotClass: 'dot-ready' },
    { id: 'error', label: 'Error', dotClass: 'dot-error' },
  ];

  const current = items.find((i) => i.id === filter) || items[0];

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button
        type="button"
        className={`status-dropdown-btn ${filter !== 'all' ? 'active-filter' : ''}`}
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Filter sessions by status"
      >
        <span className={`dot ${current.dotClass}`} />
        <span>{current.label}</span>
        {filter !== 'all' && (
          <span className="count-badge">
            {counts[filter]}
          </span>
        )}
        <ChevronDown
          size={11}
          strokeWidth={2}
          style={{
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.15s ease',
          }}
        />
      </button>

      {open && (
        <div className="status-dropdown-menu" role="listbox">
          {items.map((item) => {
            const isSelected = item.id === filter;
            return (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`status-dropdown-item ${isSelected ? 'active' : ''}`}
                onClick={() => {
                  onChange(item.id);
                  setOpen(false);
                }}
              >
                <span className={`dot ${item.dotClass}`} />
                <span style={{ flex: 1 }}>{item.label}</span>
                <span className="count-badge">{counts[item.id]}</span>
                {isSelected && <Check size={12} strokeWidth={2.5} style={{ marginLeft: 4 }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ *
 * SessionTable
 * ------------------------------------------------------------------ */

interface Props {
  sessions: SessionRecord[];
  query: string;
  onQuery: (q: string) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  launchingIds: string[];
  onLaunch: (id: string) => void;
  onStop: (id: string) => void;
  onDelete: (ids: string[]) => void;
  onEdit: (s: SessionRecord) => void;
  onNew: () => void;
  onPreview: (s: SessionRecord) => void;
  pageSize: number;
  onPageSize: (n: number) => void;
  runbar: React.ReactNode;
}

export const SessionTable: React.FC<Props> = ({
  sessions,
  query,
  onQuery,
  searchRef,
  selectedIds,
  onSelect,
  launchingIds,
  onLaunch,
  onStop,
  onDelete,
  onEdit,
  onNew,
  onPreview,
  pageSize,
  onPageSize,
  runbar,
}) => {
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'status', dir: 1 });
  const [cols, setCols] = useStored<ColumnId[]>('cols', ['proxy', 'fingerprint', 'tags', 'cookies', 'opened']);
  const [colPicker, setColPicker] = useState(false);

  // Context menu state
  const [ctx, setCtx] = useState<{ pos: CtxPos; session: SessionRecord | null }>({ pos: null, session: null });

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = sessions.filter((s) => {
      const passesFilter =
        filter === 'all' ? true : filter === 'ready' ? s.status === 'ready' || s.status === 'completed' : s.status === filter;
      if (!passesFilter) return false;
      if (!q) return true;
      return [s.id, s.email, s.notes, s.fingerprintFile, s.proxy && `${s.proxy.host}:${s.proxy.port}`, ...(s.tags || [])]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });

    const { key, dir } = sort;
    return [...matched].sort((a, b) => {
      let d = 0;
      if (key === 'status') d = (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9);
      else if (key === 'cookieCount') d = a.cookieCount - b.cookieCount;
      else if (key === 'lastOpenedAt')
        d = new Date(a.lastOpenedAt || 0).getTime() - new Date(b.lastOpenedAt || 0).getTime();
      else d = a.id.localeCompare(b.id, undefined, { numeric: true });
      return d * dir || a.id.localeCompare(b.id, undefined, { numeric: true });
    });
  }, [sessions, query, filter, sort]);

  const paged = usePaged(rows, pageSize, `${filter}|${query}|${sort.key}|${sort.dir}`);
  const totalCookies = sessions.reduce((n, s) => n + (s.cookieCount || 0), 0);
  const selected = new Set(selectedIds);
  const visibleSelected = rows.filter((s) => selected.has(s.id)).length;
  const headState: boolean | 'mixed' =
    rows.length > 0 && visibleSelected === rows.length ? true : visibleSelected > 0 ? 'mixed' : false;

  // Select-all acts on the rows the filter is actually showing, never hidden ones.
  const toggleAll = () =>
    onSelect(headState === true ? selectedIds.filter((id) => !rows.some((r) => r.id === id)) : [
      ...new Set([...selectedIds, ...rows.map((r) => r.id)]),
    ]);

  const toggleOne = (id: string) =>
    onSelect(selected.has(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);

  const sortBtn = (key: SortKey, label: string) => {
    const active = sort.key === key;
    return (
      <th className={active ? 'sorted' : undefined} aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
        <button
          onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === 1 ? -1 : 1 }))}
          aria-label={active ? `${label}, sorted ${sort.dir === 1 ? 'ascending' : 'descending'}` : `Sort by ${label}`}
        >
          {label}
          {active && (sort.dir === 1 ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
        </button>
      </th>
    );
  };

  const col = (id: ColumnId) => cols.includes(id);

  // Export selected profiles as JSON
  const exportSelected = useCallback(() => {
    const data = sessions.filter((s) => selectedIds.includes(s.id));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `profiles-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [sessions, selectedIds]);

  const statusCounts = useMemo(() => {
    const res: Record<Filter, number> = { all: sessions.length, live: 0, queued: 0, ready: 0, error: 0 };
    for (const s of sessions) {
      if (s.status === 'live') res.live++;
      else if (s.status === 'queued') res.queued++;
      else if (s.status === 'error') res.error++;
      else if (s.status === 'ready') res.ready++;
    }
    return res;
  }, [sessions]);

  return (
    <>
      <Toolbar title="Sessions" count={sessions.length}>
        {totalCookies > 0 && <span className="count">{totalCookies.toLocaleString()} cookies</span>}

        <StatusFilterDropdown
          filter={filter}
          onChange={setFilter}
          counts={statusCounts}
        />

        <div className="field search">
          <Search size={14} />
          <input
            ref={searchRef}
            type="search"
            className="input"
            placeholder="Search  /"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            aria-label="Search sessions"
          />
        </div>

        <ColumnPicker
          visible={cols}
          onChange={setCols}
          open={colPicker}
          onToggle={() => setColPicker((p) => !p)}
        />

        <button className="btn primary" onClick={onNew}>
          <Plus size={14} strokeWidth={2} />
          New
        </button>
      </Toolbar>

      <div className="view" style={{ position: 'relative' }}>
        {runbar}

        {sessions.length === 0 ? (
          <div className="table-wrap">
            <Empty
              icon={<Inbox size={30} strokeWidth={1.5} />}
              text="No profiles yet."
              action={
                <button className="btn primary" onClick={onNew}>
                  <Plus size={14} strokeWidth={2} />
                  Create profile
                </button>
              }
            />
          </div>
        ) : rows.length === 0 ? (
          <div className="table-wrap">
            <Empty icon={<Search size={26} strokeWidth={1.5} />} text="Nothing matches." />
          </div>
        ) : (
          <div className="table-wrap">
            <div className="table-scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    <th className="col-tight">
                      <CheckBox state={headState} onClick={toggleAll} label="Select all shown" />
                    </th>
                    {sortBtn('id', 'Profile')}
                    {sortBtn('status', 'Status')}
                    {col('proxy') && <th>Proxy</th>}
                    {col('fingerprint') && <th>Fingerprint</th>}
                    {col('tags') && <th>Tags</th>}
                    {col('cookies') && sortBtn('cookieCount', 'Cookies')}
                    {col('opened') && sortBtn('lastOpenedAt', 'Opened')}
                    <th className="col-tight" />
                  </tr>
                </thead>
                <tbody>
                  {paged.slice.map((s) => (
                    <Row
                      key={s.id}
                      s={s}
                      cols={cols}
                      selected={selected.has(s.id)}
                      launching={launchingIds.includes(s.id)}
                      onToggle={() => toggleOne(s.id)}
                      onLaunch={() => onLaunch(s.id)}
                      onStop={() => onStop(s.id)}
                      onEdit={() => onEdit(s)}
                      onDelete={() => onDelete([s.id])}
                      onPreview={() => onPreview(s)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setCtx({ pos: { x: e.clientX, y: e.clientY }, session: s });
                      }}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <Pager
              page={paged.page}
              pages={paged.pages}
              from={paged.from}
              to={paged.to}
              total={rows.length}
              noun="profiles"
              pageSize={pageSize}
              onPage={paged.setPage}
              onPageSize={onPageSize}
            />
          </div>
        )}

        {/* Floating bulk actions bar */}
        {selectedIds.length > 0 && (
          <div className="bulk-bar">
            <span className="count">{selectedIds.length} selected</span>
            <button className="btn xs primary" onClick={() => { for (const id of selectedIds) onLaunch(id); }}>
              <Play size={11} strokeWidth={2.25} />
              Launch
            </button>
            <button className="btn xs" onClick={exportSelected}>
              <Download size={11} strokeWidth={1.9} />
              Export
            </button>
            <button className="btn xs danger" onClick={() => onDelete(selectedIds)}>
              <Trash2 size={11} strokeWidth={1.75} />
              Delete
            </button>
            <button
              className="icon-btn xs"
              onClick={() => onSelect([])}
              aria-label="Clear selection"
            >
              <X size={13} />
            </button>
          </div>
        )}
      </div>

      <ContextMenu
        pos={ctx.pos}
        session={ctx.session}
        onClose={() => setCtx({ pos: null, session: null })}
        onLaunch={() => ctx.session && onLaunch(ctx.session.id)}
        onStop={() => ctx.session && onStop(ctx.session.id)}
        onEdit={() => ctx.session && onEdit(ctx.session)}
        onDelete={() => ctx.session && onDelete([ctx.session.id])}
        onCopyProxy={() => {
          if (ctx.session?.proxy)
            navigator.clipboard.writeText(`${ctx.session.proxy.host}:${ctx.session.proxy.port}`);
        }}
        onPreview={() => ctx.session && onPreview(ctx.session)}
      />
    </>
  );
};

/* ------------------------------------------------------------------ *
 * Row
 * ------------------------------------------------------------------ */

const Row: React.FC<{
  s: SessionRecord;
  cols: ColumnId[];
  selected: boolean;
  launching: boolean;
  onToggle: () => void;
  onLaunch: () => void;
  onStop: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onPreview: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}> = ({ s, cols, selected, launching, onToggle, onLaunch, onStop, onEdit, onDelete, onPreview, onContextMenu }) => {
  const live = s.status === 'live';
  const uptime = useElapsed(live ? s.liveInfo?.startedAt : null);
  const bg = avatarColor(s.id, s.color);
  const col = (id: ColumnId) => cols.includes(id);

  return (
    <tr data-selected={selected} onContextMenu={onContextMenu}>
      <td className="col-tight">
        <CheckBox state={selected} onClick={onToggle} label={`Select ${s.id}`} />
      </td>

      <td>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            className="avatar"
            style={{ background: bg, cursor: 'pointer' }}
            onClick={onPreview}
            title="Quick view"
          >
            {initials(s.id)}
          </div>
          <div>
            <div className="name" title={s.id} style={{ cursor: 'pointer' }} onClick={onPreview}>
              {s.id}
            </div>
            {s.notes && <div className="sub" title={s.notes}>{s.notes}</div>}
          </div>
        </div>
      </td>

      <td>
        {live ? (
          <span className="badge live">
            <span className="dot" />
            {uptime || 'Live'}
          </span>
        ) : s.status === 'queued' ? (
          <span className="badge queued">
            <span className="dot" />
            Queued
          </span>
        ) : s.status === 'error' ? (
          <span className="badge error" title={s.lastResult?.reason || 'Error'}>
            <CircleAlert size={11} strokeWidth={2} />
            Error
            <span className="sr-only">: {s.lastResult?.reason || 'unknown reason'}</span>
          </span>
        ) : (
          <span className="badge">
            <span className="dot" />
            {s.status === 'completed' ? 'Done' : 'Ready'}
          </span>
        )}
      </td>

      {col('proxy') && (
        <td>
          {s.proxy?.host ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <span className="tag">
                <Globe size={11} strokeWidth={1.75} />
                <span>
                  {s.proxy.host}:{s.proxy.port}
                </span>
              </span>
              <CopyButton value={`${s.proxy.host}:${s.proxy.port}`} label="Copy proxy" size={12} />
            </div>
          ) : (
            <span className="dim">Direct</span>
          )}
        </td>
      )}

      {col('fingerprint') && (
        <td>
          {s.fingerprintFile ? (
            <span className="tag" title={s.fingerprintFile}>
              <Fingerprint size={11} strokeWidth={1.75} />
              <span>{fptShort(s.fingerprintFile)}</span>
            </span>
          ) : (
            <span className="dim">Default</span>
          )}
        </td>
      )}

      {col('tags') && (
        <td>
          {s.tags && s.tags.length > 0 ? (
            <div className="chips">
              {s.tags.slice(0, 3).map((t) => (
                <span
                  key={t}
                  className="chip"
                  style={{ background: 'rgba(255,255,255,0.08)', color: 'var(--txt-2)' }}
                >
                  <span>{t}</span>
                </span>
              ))}
              {s.tags.length > 3 && (
                <span className="chip" style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--txt-3)' }}>
                  +{s.tags.length - 3}
                </span>
              )}
            </div>
          ) : (
            <span className="dim">—</span>
          )}
        </td>
      )}

      {col('cookies') && (
        <td>
          <span
            className="mono"
            style={{ color: s.cookieCount ? 'var(--txt-2)' : 'var(--txt-3)', fontSize: 12 }}
          >
            <Cookie
              size={11}
              strokeWidth={1.75}
              style={{ verticalAlign: -1, marginRight: 5, opacity: 0.6 }}
            />
            {s.cookieCount}
          </span>
        </td>
      )}

      {col('opened') && (
        <td className="dim" title={s.lastOpenedAt ? new Date(s.lastOpenedAt).toLocaleString() : undefined}>
          {ago(s.lastOpenedAt)}
        </td>
      )}

      <td className="col-tight">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
          {live ? (
            <button className="btn xs danger" onClick={onStop}>
              <Square size={11} strokeWidth={2.25} />
              Stop
            </button>
          ) : (
            <button className="btn xs" onClick={onLaunch} disabled={launching}>
              {launching ? (
                <Loader2 size={11} className="spin" />
              ) : (
                <Play size={11} strokeWidth={2.25} />
              )}
              Launch
            </button>
          )}
          <div className="row-actions">
            <button className="icon-btn xs" onClick={onEdit} aria-label={`Configure ${s.id}`} title="Configure">
              <SlidersHorizontal size={14} strokeWidth={1.75} />
            </button>
            <button
              className="icon-btn xs danger"
              onClick={onDelete}
              aria-label={`Delete ${s.id}`}
              title="Delete"
            >
              <Trash2 size={14} strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </td>
    </tr>
  );
};
