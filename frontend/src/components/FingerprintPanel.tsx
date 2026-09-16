import React, { useMemo, useState } from 'react';
import { Eye, Fingerprint, LayoutGrid, List, Search } from 'lucide-react';
import type { FingerprintResource } from '../types';
import { CopyButton, Empty, Pager, Toolbar, usePaged } from '../ui';

const FLAGS: Record<string, string> = {
  US: '🇺🇸', GB: '🇬🇧', DE: '🇩🇪', FR: '🇫🇷', CA: '🇨🇦', AU: '🇦🇺', BR: '🇧🇷', IN: '🇮🇳',
  JP: '🇯🇵', NL: '🇳🇱', RU: '🇷🇺', AW: '🇦🇼', IT: '🇮🇹', ES: '🇪🇸', SE: '🇸🇪', CH: '🇨🇭',
};

type Filter = 'all' | 'free' | 'bound' | 'chrome' | 'firefox';

/**
 * Dump filenames come in two shapes: `<hash>_<CC>_<C|F>` and `<capture-ip>__<hash>`.
 * Pick the hash out of either rather than blindly taking the first segment,
 * which would label every print with a truncated IP.
 */
export function fptShort(file: string) {
  const segments = file.replace(/\.json(\.gz)?$/, '').split(/_+/).filter(Boolean);
  const hash = segments.find((s) => /^[0-9a-f]{8,}$/i.test(s));
  return (hash || segments[0] || file).slice(0, 8);
}

export function fptMeta(f: FingerprintResource) {
  const segments = f.file.replace(/\.json(\.gz)?$/, '').split(/_+/).filter(Boolean);
  const country = f.country || segments.find((s) => /^[A-Za-z]{2}$/.test(s))?.toUpperCase();
  return {
    // The backend's shortId is the first filename segment, which is the capture IP
    // for `<ip>__<hash>` dumps. Always prefer the hash so ids stay distinguishable.
    shortId: fptShort(f.file),
    country: !country || country === 'GLOBAL' ? '' : country,
    browserName: f.browserName || (segments.includes('F') ? 'Firefox' : 'Chrome'),
  };
}

interface Props {
  fingerprints: FingerprintResource[];
  query: string;
  onQuery: (q: string) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  onInspect: (f: FingerprintResource) => void;
  onRefresh: () => void;
  pageSize: number;
  onPageSize: (n: number) => void;
}

export const FingerprintPanel: React.FC<Props> = ({
  fingerprints,
  query,
  onQuery,
  searchRef,
  onInspect,
  onRefresh,
  pageSize,
  onPageSize,
}) => {
  const [filter, setFilter] = useState<Filter>('all');
  const [view, setView] = useState<'table' | 'cards'>('table');

  const free = fingerprints.filter((f) => !f.isAssigned).length;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return fingerprints.filter((f) => {
      const m = fptMeta(f);
      if (filter === 'free' && f.isAssigned) return false;
      if (filter === 'bound' && !f.isAssigned) return false;
      if (filter === 'chrome' && m.browserName !== 'Chrome') return false;
      if (filter === 'firefox' && m.browserName !== 'Firefox') return false;
      if (!q) return true;
      return [f.file, m.country, m.browserName, f.userAgent, f.assignedTo]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [fingerprints, query, filter]);

  const paged = usePaged(rows, pageSize, `${filter}|${query}|${view}`);

  const pager = (standalone?: boolean) => (
    <Pager
      standalone={standalone}
      page={paged.page}
      pages={paged.pages}
      from={paged.from}
      to={paged.to}
      total={rows.length}
      noun="prints"
      pageSize={pageSize}
      onPage={paged.setPage}
      onPageSize={onPageSize}
    />
  );

  return (
    <>
      <Toolbar title="Fingerprints" count={fingerprints.length}>
        <div className="seg" role="group" aria-label="Filter fingerprints">
          {(['all', 'free', 'bound', 'chrome', 'firefox'] as Filter[]).map((f) => (
            <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : f === 'free' ? `Free ${free}` : f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        <div className="field search">
          <Search size={14} />
          <input
            ref={searchRef}
            type="search"
            className="input"
            placeholder="Search  /"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            aria-label="Search fingerprints"
          />
        </div>

        <div className="seg" role="group" aria-label="Layout">
          <button aria-pressed={view === 'table'} onClick={() => setView('table')} aria-label="Table view">
            <List size={14} strokeWidth={1.75} />
          </button>
          <button aria-pressed={view === 'cards'} onClick={() => setView('cards')} aria-label="Card view">
            <LayoutGrid size={14} strokeWidth={1.75} />
          </button>
        </div>
      </Toolbar>

      <div className="view">
        {!fingerprints.length ? (
          <div className="card">
            <Empty
              icon={<Fingerprint size={30} strokeWidth={1.5} />}
              text="No fingerprint dumps in resources/fpts/"
              action={
                <button className="btn" onClick={onRefresh}>
                  Rescan
                </button>
              }
            />
          </div>
        ) : rows.length === 0 ? (
          <div className="card">
            <Empty icon={<Search size={26} strokeWidth={1.5} />} text="Nothing matches." />
          </div>
        ) : view === 'table' ? (
          <div className="table-wrap">
            <div className="table-scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Region</th>
                    <th>Browser</th>
                    <th>Platform</th>
                    <th>Viewport</th>
                    <th>Bound to</th>
                    <th className="col-tight" />
                  </tr>
                </thead>
                <tbody>
                  {paged.slice.map((f) => {
                    const m = fptMeta(f);
                    return (
                      <tr key={f.file}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                            <span className="mono name">{m.shortId}</span>
                            <CopyButton value={f.file} label="Copy filename" size={12} />
                          </div>
                        </td>
                        <td>
                          <span className="badge">
                            {m.country ? `${FLAGS[m.country] || '🌐'} ${m.country}` : 'Unknown'}
                          </span>
                        </td>
                        <td>
                          {m.browserName}
                          <span className="dim">
                            {f.chromeVersion ? ` ${f.chromeVersion.split('.')[0]}` : ''}
                          </span>
                        </td>
                        <td>
                          {f.error ? (
                            <span className="badge error" title={f.error}>
                              Unreadable
                            </span>
                          ) : (
                            f.platform || '—'
                          )}
                        </td>
                        <td className="mono dim">{f.viewport || '—'}</td>
                        <td>
                          {f.isAssigned ? (
                            <span className="tag">
                              <span>{f.assignedTo}</span>
                            </span>
                          ) : (
                            <span className="badge live">
                              <span className="dot" />
                              Free
                            </span>
                          )}
                        </td>
                        <td className="col-tight">
                          <div className="row-actions">
                            <button
                              className="icon-btn xs"
                              onClick={() => onInspect(f)}
                              aria-label={`Inspect ${m.shortId}`}
                              title="Inspect"
                            >
                              <Eye size={14} strokeWidth={1.75} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {pager()}
          </div>
        ) : (
          <>
            <div className="grid">
              {paged.slice.map((f) => {
                const m = fptMeta(f);
                return (
                  <div key={f.file} className="tile">
                    <div className="tile-head">
                      <span className="mono name" style={{ fontSize: 12.5 }}>
                        {m.shortId}
                      </span>
                      <span className="badge">
                        {m.country ? `${FLAGS[m.country] || '🌐'} ${m.country}` : 'Unknown'}
                      </span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div className="tile-kv">
                        <span>Browser</span>
                        <b>
                          {m.browserName} {f.chromeVersion ? f.chromeVersion.split('.')[0] : ''}
                        </b>
                      </div>
                      <div className="tile-kv">
                        <span>Screen</span>
                        <b>{f.viewport || '—'}</b>
                      </div>
                      <div className="tile-kv">
                        <span>Cores / RAM</span>
                        <b>
                          {f.hardwareConcurrency || '?'} / {f.deviceMemory || '?'} GB
                        </b>
                      </div>
                    </div>

                    <div className="tile-foot">
                      {f.isAssigned ? (
                        <span className="sub">{f.assignedTo}</span>
                      ) : (
                        <span className="badge live">
                          <span className="dot" />
                          Free
                        </span>
                      )}
                      <div style={{ display: 'flex', gap: 4 }}>
                        <CopyButton value={f.file} label="Copy filename" />
                        <button className="btn xs" onClick={() => onInspect(f)}>
                          <Eye size={11} strokeWidth={1.9} />
                          Inspect
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {pager(true)}
          </>
        )}
      </div>
    </>
  );
};

// [fpts] spec tooltips
