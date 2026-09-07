import React, { useState } from 'react';
import { ChevronDown, CircleAlert, FileSpreadsheet, Hash, Layers, Loader2, Minus, Plus, Save, X } from 'lucide-react';
import type { FingerprintResource, ProxyResource, SessionRecord } from '../types';
import { Modal } from '../ui';
import { fptMeta, fptShort } from './FingerprintPanel';

/** resources/proxies entries arrive as URLs; the store wants the parsed parts. */
export function parseProxyUrl(url: string) {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`Unusable proxy entry: ${url}`);
  }
  if (!u.hostname || !u.port) throw new Error(`Proxy needs a host and port: ${url}`);
  return {
    host: u.hostname,
    port: Number(u.port),
    username: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
  };
}

const Select: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}> = ({ label, value, onChange, children }) => (
  <div className="form-row">
    <label htmlFor={`f-${label}`}>{label}</label>
    <div className="select-wrap">
      <select
        id={`f-${label}`}
        className="input"
        style={{ width: '100%' }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {children}
      </select>
      <ChevronDown size={13} />
    </div>
  </div>
);

const ErrorBox: React.FC<{ text: string }> = ({ text }) => (
  <div className="alert">
    <CircleAlert size={14} strokeWidth={2} style={{ marginTop: 1 }} />
    {text}
  </div>
);

/* ================================================================== *
 * Create profiles
 * ================================================================== */

type Mode = 'single' | 'batch' | 'csv';

export const NewSessionModal: React.FC<{
  onClose: () => void;
  onCreateSingle: (name: string, proxy?: string, fingerprintFile?: string) => Promise<void>;
  onCreateBatch: (count: number, prefix: string) => Promise<void>;
  onImportCsv: (csv: string) => Promise<void>;
  proxies: ProxyResource[];
  fingerprints: FingerprintResource[];
}> = ({ onClose, onCreateSingle, onCreateBatch, onImportCsv, proxies, fingerprints }) => {
  const [mode, setMode] = useState<Mode>('single');
  const [name, setName] = useState('');
  const [proxy, setProxy] = useState('');
  const [fpt, setFpt] = useState('');
  const [count, setCount] = useState(3);
  const [prefix, setPrefix] = useState('session');
  const [csv, setCsv] = useState('Email\nuser1@example.com');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const freeProxies = proxies.filter((p) => !p.isAssigned);
  const freeFpts = fingerprints.filter((f) => !f.isAssigned && !f.error);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'single') {
        if (!name.trim()) throw new Error('Name is required');
        await onCreateSingle(name.trim(), proxy || undefined, fpt || undefined);
      } else if (mode === 'batch') {
        if (count < 1) throw new Error('Count must be at least 1');
        await onCreateBatch(count, prefix.trim() || 'session');
      } else {
        if (!csv.trim()) throw new Error('CSV is empty');
        await onImportCsv(csv);
      }
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const TABS: Array<[Mode, string, typeof Layers]> = [
    ['single', 'One', Layers],
    ['batch', 'Batch', Hash],
    ['csv', 'CSV', FileSpreadsheet],
  ];

  return (
    <Modal
      title="New profiles"
      onClose={onClose}
      belowTitle={
        <div className="modal-tabs" role="group" aria-label="Creation mode">
          {TABS.map(([id, label, Icon]) => (
            <button
              key={id}
              aria-pressed={mode === id}
              onClick={() => setMode(id)}
              type="button"
            >
              <Icon size={13} strokeWidth={1.75} />
              {label}
            </button>
          ))}
        </div>
      }
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="new-session" className="btn primary" disabled={busy}>
            {busy ? <Loader2 size={13} className="spin" /> : <Plus size={13} strokeWidth={2.25} />}
            Create
          </button>
        </>
      }
    >
      <form id="new-session" onSubmit={submit} style={{ display: 'contents' }}>
        {error && <ErrorBox text={error} />}

        {mode === 'single' && (
          <>
            <div className="form-row">
              <label htmlFor="f-name">Name or email</label>
              <input
                id="f-name"
                className="input"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="buyer-01"
              />
            </div>
            <Select label="Proxy" value={proxy} onChange={setProxy}>
              <option value="">Auto — {freeProxies.length} free</option>
              {freeProxies.map((p) => (
                <option key={p.key} value={p.url}>
                  {p.host}:{p.port}
                </option>
              ))}
            </Select>
            <Select label="Fingerprint" value={fpt} onChange={setFpt}>
              <option value="">Auto — {freeFpts.length} free</option>
              {freeFpts.map((f) => {
                const m = fptMeta(f);
                return (
                  <option key={f.file} value={f.file}>
                    {m.shortId} · {m.country} · {f.platform}
                  </option>
                );
              })}
            </Select>
          </>
        )}

        {mode === 'batch' && (
          <>
            <div className="form-row">
              <label htmlFor="f-prefix">Prefix</label>
              <input
                id="f-prefix"
                className="input"
                autoFocus
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
              />
            </div>
            <div className="form-row">
              <label htmlFor="f-count">Count</label>
              <input
                id="f-count"
                type="number"
                min={1}
                max={100}
                className="input"
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              />
              <span className="hint">Each gets a free proxy and fingerprint.</span>
            </div>
          </>
        )}

        {mode === 'csv' && (
          <div className="form-row">
            <label htmlFor="f-csv">CSV with an Email column</label>
            <textarea
              id="f-csv"
              className="input mono"
              rows={7}
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
            />
          </div>
        )}
      </form>
    </Modal>
  );
};

/* ================================================================== *
 * Configure one profile
 * ================================================================== */

export const SessionModal: React.FC<{
  session: SessionRecord;
  proxies: ProxyResource[];
  fingerprints: FingerprintResource[];
  onClose: () => void;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
}> = ({ session, proxies, fingerprints, onClose, onSave }) => {
  const currentProxy = session.proxy ? `${session.proxy.host}:${session.proxy.port}` : '';
  const [notes, setNotes] = useState(session.notes || '');
  const [proxyKey, setProxyKey] = useState(currentProxy);
  const [fptFile, setFptFile] = useState(session.fingerprintFile || '');
  const [tags, setTags] = useState<string[]>(session.tags || []);
  const [tagInput, setTagInput] = useState('');
  const [color, setColor] = useState(session.color || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const COLORS = ['#ef4444','#f97316','#f59e0b','#22c55e','#14b8a6','#3b82f6','#a855f7','#ec4899'];

  const proxyOptions = proxies.filter((p) => !p.isAssigned || p.key === currentProxy);
  const fptOptions = fingerprints.filter(
    (f) => (!f.isAssigned && !f.error) || f.file === session.fingerprintFile
  );

  const tagsMatch = JSON.stringify(tags) === JSON.stringify(session.tags || []);
  const dirty =
    notes !== (session.notes || '') ||
    proxyKey !== currentProxy ||
    fptFile !== (session.fingerprintFile || '') ||
    !tagsMatch ||
    color !== (session.color || '');

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const patch: Record<string, unknown> = {};
      if (notes !== (session.notes || '')) patch.notes = notes;
      if (!tagsMatch) patch.tags = tags;
      if (color !== (session.color || '')) patch.color = color || undefined;
      if (fptFile && fptFile !== session.fingerprintFile) patch.fingerprintFile = fptFile;
      if (proxyKey !== currentProxy) {
        const chosen = proxies.find((p) => p.key === proxyKey);
        if (!chosen) throw new Error('That proxy is no longer available');
        patch.proxy = parseProxyUrl(chosen.url);
      }
      await onSave(patch);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Save failed');
      setBusy(false);
    }
  };

  const fp = session.fingerprint;

  return (
    <Modal
      title={session.id}
      width={520}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="edit-session" className="btn primary" disabled={busy || !dirty}>
            {busy ? <Loader2 size={13} className="spin" /> : <Save size={13} strokeWidth={1.9} />}
            Save
          </button>
        </>
      }
    >
      <form id="edit-session" onSubmit={save} style={{ display: 'contents' }}>
        {error && <ErrorBox text={error} />}

        <div className="form-row">
          <label htmlFor="f-notes">Note</label>
          <input
            id="f-notes"
            className="input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="—"
          />
        </div>

        <Select label="Proxy" value={proxyKey} onChange={setProxyKey}>
          {!currentProxy && <option value="">None</option>}
          {currentProxy && !proxyOptions.some((p) => p.key === currentProxy) && (
            <option value={currentProxy}>{currentProxy} · current, missing from pool</option>
          )}
          {proxyOptions.map((p) => (
            <option key={p.key} value={p.key}>
              {p.host}:{p.port}
              {p.key === currentProxy ? ' · current' : ''}
            </option>
          ))}
        </Select>

        <Select label="Fingerprint" value={fptFile} onChange={setFptFile}>
          {!session.fingerprintFile && <option value="">None</option>}
          {session.fingerprintFile && !fptOptions.some((f) => f.file === session.fingerprintFile) && (
            <option value={session.fingerprintFile}>
              {fptShort(session.fingerprintFile)} · current, missing from pool
            </option>
          )}
          {fptOptions.map((f) => {
            const m = fptMeta(f);
            return (
              <option key={f.file} value={f.file}>
                {m.shortId} · {m.country} · {f.platform}
                {f.file === session.fingerprintFile ? ' · current' : ''}
              </option>
            );
          })}
        </Select>

        {(proxyKey !== currentProxy || fptFile !== (session.fingerprintFile || '')) && (
          <span className="hint">Saving rebuilds the fingerprint against the new proxy region.</span>
        )}

        {/* Tags */}
        <div className="form-row">
          <label>Tags</label>
          <div className="tag-input-wrap" onClick={() => {
            const inp = document.getElementById('f-tag-input') as HTMLInputElement;
            inp?.focus();
          }}>
            {tags.map((t) => (
              <span
                key={t}
                className="chip"
                style={{ background: 'rgba(255,255,255,0.1)', color: 'var(--txt-2)' }}
              >
                <span>{t}</span>
                <button
                  type="button"
                  className="chip-remove"
                  onClick={() => setTags(tags.filter((x) => x !== t))}
                  aria-label={`Remove tag ${t}`}
                >
                  <X size={8} />
                </button>
              </span>
            ))}
            <input
              id="f-tag-input"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ',') && tagInput.trim()) {
                  e.preventDefault();
                  const t = tagInput.trim().replace(',', '');
                  if (t && !tags.includes(t)) setTags([...tags, t]);
                  setTagInput('');
                }
                if (e.key === 'Backspace' && !tagInput && tags.length) {
                  setTags(tags.slice(0, -1));
                }
              }}
              placeholder={tags.length ? '' : 'Type and press Enter'}
            />
          </div>
          <span className="hint">Press Enter or comma to add a tag.</span>
        </div>

        {/* Color */}
        <div className="form-row">
          <label>Profile color</label>
          <div className="color-palette">
            <button
              type="button"
              className="color-swatch-none"
              aria-selected={!color}
              onClick={() => setColor('')}
              title="No color"
            >
              <Minus size={10} />
            </button>
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className="color-swatch"
                style={{ background: c }}
                aria-selected={color === c}
                onClick={() => setColor(c)}
                title={c}
              />
            ))}
          </div>
        </div>

        {fp && <Specs fp={fp} />}
      </form>
    </Modal>
  );
};

/* ================================================================== *
 * Read-only fingerprint specs
 * ================================================================== */

const Field: React.FC<{ k: string; v: React.ReactNode }> = ({ k, v }) => (
  <div className="kv">
    <dt>{k}</dt>
    <dd>{v || '—'}</dd>
  </div>
);

export const Specs: React.FC<{ fp: any }> = ({ fp }) => {
  const vp = fp.viewport;
  const gl = fp.webgl || {};
  return (
    <>
      <div className="code-block">{fp.userAgent || 'Default user agent'}</div>
      <dl className="kv-grid">
        <Field k="Platform" v={fp.platform} />
        <Field k="Chrome" v={fp.chromeVersion} />
        <Field
          k="Viewport"
          v={typeof vp === 'string' ? vp : vp ? `${vp.width}×${vp.height} @${vp.deviceScaleFactor || 1}x` : null}
        />
        <Field k="Timezone" v={fp.timezone} />
        <Field k="Locale" v={fp.locale || fp.lang} />
        <Field k="Cores / RAM" v={`${fp.hardwareConcurrency || '?'} / ${fp.deviceMemory || '?'} GB`} />
      </dl>
      <div className="form-row">
        <label>WebGL</label>
        <div className="code-block">
          {fp.webglVendor || gl.vendor || '—'}
          {'\n'}
          {fp.webglRenderer || gl.renderer || '—'}
        </div>
      </div>
    </>
  );
};

export const SpecsModal: React.FC<{ fp: any; title: string; onClose: () => void }> = ({
  fp,
  title,
  onClose,
}) => (
  <Modal
    title={title}
    width={520}
    onClose={onClose}
    footer={
      <button className="btn" onClick={onClose}>
        Close
      </button>
    }
  >
    <Specs fp={fp} />
  </Modal>
);
