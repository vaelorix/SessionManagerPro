import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ChevronDown,
  ChevronUp,
  Download,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Search,
  Terminal,
  Trash2,
} from 'lucide-react';
import type { LogEntry } from '../types';

type Size = 'closed' | 'normal' | 'tall';
type Level = 'all' | 'info' | 'success' | 'warn' | 'error';

const LEVELS: Level[] = ['all', 'info', 'success', 'warn', 'error'];

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString([], {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

/** Highlights every match of `q` without dangerouslySetInnerHTML. */
const Highlight: React.FC<{ text: string; q: string }> = ({ text, q }) => {
  if (!q) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  let i = 0;
  while (i < text.length) {
    const at = lower.indexOf(needle, i);
    if (at < 0) {
      parts.push(text.slice(i));
      break;
    }
    if (at > i) parts.push(text.slice(i, at));
    parts.push(<mark key={at}>{text.slice(at, at + needle.length)}</mark>);
    i = at + needle.length;
  }
  return <>{parts}</>;
};

export const ConsoleDock: React.FC<{
  logs: LogEntry[];
  onClear: () => void;
  size: Size;
  onSize: (s: Size) => void;
  connected: boolean;
}> = ({ logs, onClear, size, onSize, connected }) => {
  const [level, setLevel] = useState<Level>('all');
  const [q, setQ] = useState('');
  // Pausing snapshots the buffer; live logs keep accumulating in the parent.
  const [frozen, setFrozen] = useState<LogEntry[] | null>(null);
  const [stick, setStick] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);

  const paused = frozen !== null;
  const source = frozen ?? logs;

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return source.filter(
      (l) =>
        (level === 'all' || l.level === level) &&
        (!needle ||
          l.message.toLowerCase().includes(needle) ||
          (l.sessionId || '').toLowerCase().includes(needle) ||
          l.category.toLowerCase().includes(needle))
    );
  }, [source, level, q]);

  useEffect(() => {
    if (stick && size !== 'closed' && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [rows, stick, size]);

  const download = () => {
    const text = rows
      .map((l) => `${l.timestamp}\t${l.level}\t${l.category}\t${l.sessionId || '-'}\t${l.message}`)
      .join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sessionmanager.log';
    a.click();
    URL.revokeObjectURL(url);
  };

  const open = size !== 'closed';

  return (
    <section
      className={`dock${open ? ' open' : ''}`}
      style={open ? { height: size === 'tall' ? '55vh' : 260 } : undefined}
      aria-label="Event log"
    >
      <div className="dock-head">
        <button
          className="dock-title"
          onClick={() => onSize(open ? 'closed' : 'normal')}
          aria-expanded={open}
        >
          <Terminal size={14} strokeWidth={1.75} />
          Log
          <span className="count">{rows.length}</span>
          {open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>

        {!connected && (
          <span className="badge queued" title="Reconnecting to the orchestrator">
            <span className="dot" />
            Offline
          </span>
        )}

        <span className="topbar-sep" />

        {open && (
          <>
            <div className="field" style={{ width: 180 }}>
              <Search size={13} />
              <input
                className="input"
                style={{ height: 26, fontSize: 11.5 }}
                placeholder="Filter"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                aria-label="Filter log"
              />
            </div>

            <div className="seg" role="group" aria-label="Log level">
              {LEVELS.map((l) => (
                <button key={l} aria-pressed={level === l} onClick={() => setLevel(l)}>
                  {l === 'all' ? 'All' : l}
                </button>
              ))}
            </div>

            <button
              className={`icon-btn${paused ? ' on' : ''}`}
              onClick={() => setFrozen((f) => (f ? null : logs))}
              aria-label={paused ? 'Resume stream' : 'Pause stream'}
              data-tip={paused ? 'Resume' : 'Pause'}
            >
              {paused ? <Play size={14} strokeWidth={1.9} /> : <Pause size={14} strokeWidth={1.9} />}
            </button>
            <button
              className={`icon-btn${stick ? ' on' : ''}`}
              onClick={() => setStick((s) => !s)}
              aria-label="Follow newest"
              data-tip="Follow"
            >
              <ArrowDown size={14} strokeWidth={1.9} />
            </button>
            <button className="icon-btn" onClick={download} aria-label="Download log" data-tip="Download">
              <Download size={14} strokeWidth={1.9} />
            </button>
            <button
              className="icon-btn"
              onClick={onClear}
              disabled={paused}
              aria-label="Clear log"
              data-tip={paused ? 'Resume to clear' : 'Clear'}
            >
              <Trash2 size={14} strokeWidth={1.9} />
            </button>
            <button
              className="icon-btn"
              onClick={() => onSize(size === 'tall' ? 'normal' : 'tall')}
              aria-label={size === 'tall' ? 'Shrink log' : 'Expand log'}
              data-tip={size === 'tall' ? 'Shrink' : 'Expand'}
            >
              {size === 'tall' ? <Minimize2 size={14} strokeWidth={1.9} /> : <Maximize2 size={14} strokeWidth={1.9} />}
            </button>
          </>
        )}
      </div>

      {open && (
        <div
          className="logs"
          ref={bodyRef}
          tabIndex={0}
          role="log"
          aria-label="Event log output"
          onScroll={(e) => {
            const el = e.currentTarget;
            setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
          }}
        >
          {rows.length === 0 ? (
            <div className="empty" style={{ padding: '28px 20px' }}>
              <p>{source.length ? 'Nothing matches.' : 'Waiting for events.'}</p>
            </div>
          ) : (
            rows.map((l) => (
              <div key={l.id} className={`log ${l.level}`}>
                <span className="sr-only">{l.level}</span>
                <time>{time(l.timestamp)}</time>
                <span className="cat">{l.category}</span>
                {l.sessionId && <span className="sid">{l.sessionId}</span>}
                <span className="msg">
                  <Highlight text={l.message} q={q.trim()} />
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
};
