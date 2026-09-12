import React, { useCallback, useEffect, useState } from 'react';
import {
  Archive,
  Cookie,
  Clock,
  Fingerprint,
  Globe,
  Loader2,
  Play,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import type { SessionBackup, SessionRecord } from '../types';
import { CopyButton, useElapsed, useUI } from '../ui';
import { fptShort } from './FingerprintPanel';
import { api } from '../api';

const AVATAR_COLORS = [
  '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
  '#ec4899', '#f43f5e', '#ef4444', '#f97316',
  '#f59e0b', '#84cc16', '#22c55e', '#14b8a6',
  '#06b6d4', '#3b82f6', '#2563eb', '#7c3aed',
];

function avatarColor(id: string): string {
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

interface Props {
  session: SessionRecord;
  onClose: () => void;
  onLaunch: () => void;
  onStop: () => void;
  onEdit: () => void;
  onDelete: () => void;
  launching: boolean;
  onRefresh?: () => void;
}

export const ProfileDrawer: React.FC<Props> = ({
  session: s,
  onClose,
  onLaunch,
  onStop,
  onEdit,
  onDelete,
  launching,
  onRefresh,
}) => {
  const { toast, confirm } = useUI();
  const live = s.status === 'live';
  const uptime = useElapsed(live ? s.liveInfo?.startedAt : null);
  const bg = s.color || avatarColor(s.id);

  const [backups, setBackups] = useState<SessionBackup[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const loadBackups = useCallback(async () => {
    try {
      setLoadingBackups(true);
      const list = await api.getSessionBackups(s.id);
      setBackups(list || []);
    } catch (e) {
      console.error('Failed to load backups:', e);
    } finally {
      setLoadingBackups(false);
    }
  }, [s.id]);

  useEffect(() => {
    loadBackups();
  }, [loadBackups]);

  const handleCreateBackup = async () => {
    try {
      setIsBackingUp(true);
      const res = await api.createSessionBackup(s.id, 'manual');
      if (res.ok) {
        toast('success', `Snapshot created for ${s.id}`);
        await loadBackups();
      }
    } catch (e: any) {
      toast('error', `Snapshot failed: ${e.message || e}`);
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleRestore = async (backupName: string) => {
    const ok = await confirm({
      title: 'Restore Profile Snapshot?',
      body: 'This will restore cookies, credentials, and profile state from this snapshot. Any unsaved session changes will be overwritten.',
      confirmLabel: 'Restore Snapshot',
      danger: true,
    });
    if (!ok) return;

    try {
      setRestoring(backupName);
      const res = await api.restoreSessionBackup(s.id, backupName);
      if (res.ok) {
        toast('success', `Restored ${res.restoredCount} profile files from snapshot.`);
        if (onRefresh) onRefresh();
        await loadBackups();
      }
    } catch (e: any) {
      toast('error', `Restore failed: ${e.message || e}`);
    } finally {
      setRestoring(null);
    }
  };

  const handleDeleteBackup = async (backupName: string) => {
    const ok = await confirm({
      title: 'Delete Snapshot?',
      body: 'Are you sure you want to delete this snapshot? This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;

    try {
      setDeleting(backupName);
      await api.deleteSessionBackup(s.id, backupName);
      toast('info', 'Snapshot deleted.');
      await loadBackups();
    } catch (e: any) {
      toast('error', `Failed to delete snapshot: ${e.message || e}`);
    } finally {
      setDeleting(null);
    }
  };

  return (
    <>
      <div className="drawer-scrim" onMouseDown={onClose} />
      <aside className="drawer" role="complementary" aria-label={`Profile details: ${s.id}`}>
        <div className="drawer-grabber" aria-hidden="true" />
        <div className="drawer-head">
          <div className="avatar" style={{ background: bg }}>
            {initials(s.id)}
          </div>
          <h2 title={s.id}>{s.id}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close drawer">
            <X size={15} />
          </button>
        </div>

        <div className="drawer-body">
          {/* Status */}
          <div className="drawer-section">
            <span className="drawer-section-title">Status</span>
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
              <span className="badge error">{s.lastResult?.reason || 'Error'}</span>
            ) : (
              <span className="badge">
                <span className="dot" />
                {s.status === 'completed' ? 'Done' : 'Ready'}
              </span>
            )}
          </div>

          {/* Tags */}
          {s.tags && s.tags.length > 0 && (
            <div className="drawer-section">
              <span className="drawer-section-title">Tags</span>
              <div className="chips">
                {s.tags.map((t) => (
                  <span
                    key={t}
                    className="chip"
                    style={{ background: 'rgba(255,255,255,0.08)', color: 'var(--txt-2)' }}
                  >
                    <span>{t}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Proxy */}
          <div className="drawer-section">
            <span className="drawer-section-title">Proxy</span>
            {s.proxy?.host ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span className="tag">
                  <Globe size={11} strokeWidth={1.75} />
                  <span>
                    {s.proxy.host}:{s.proxy.port}
                  </span>
                </span>
                <CopyButton
                  value={`${s.proxy.host}:${s.proxy.port}`}
                  label="Copy proxy"
                  size={12}
                />
              </div>
            ) : (
              <span className="dim">Direct connection</span>
            )}
          </div>

          {/* Fingerprint */}
          <div className="drawer-section">
            <span className="drawer-section-title">Fingerprint</span>
            {s.fingerprintFile ? (
              <span className="tag" title={s.fingerprintFile}>
                <Fingerprint size={11} strokeWidth={1.75} />
                <span>{fptShort(s.fingerprintFile)}</span>
              </span>
            ) : (
              <span className="dim">Default</span>
            )}
            {s.fingerprint && (
              <div className="code-block" style={{ fontSize: 10.5, lineHeight: 1.6 }}>
                {s.fingerprint.platform} · {s.fingerprint.chromeVersion || 'Chrome'}
                {'\n'}
                {typeof s.fingerprint.viewport === 'string'
                  ? s.fingerprint.viewport
                  : s.fingerprint.viewport
                    ? `${s.fingerprint.viewport.width}×${s.fingerprint.viewport.height}`
                    : '—'}
                {' · '}
                {s.fingerprint.timezone || '—'}
              </div>
            )}
          </div>

          {/* Details */}
          <div className="drawer-section">
            <span className="drawer-section-title">Details</span>
            <dl className="kv-grid">
              <div className="kv">
                <dt>
                  <Cookie size={11} style={{ verticalAlign: -1, marginRight: 4, opacity: 0.6 }} />
                  Cookies
                </dt>
                <dd>{s.cookieCount}</dd>
              </div>
              <div className="kv">
                <dt>
                  <Clock size={11} style={{ verticalAlign: -1, marginRight: 4, opacity: 0.6 }} />
                  Last opened
                </dt>
                <dd>{ago(s.lastOpenedAt)}</dd>
              </div>
            </dl>
          </div>

          {/* Notes */}
          {s.notes && (
            <div className="drawer-section">
              <span className="drawer-section-title">Notes</span>
              <p style={{ fontSize: 12.5, color: 'var(--txt-2)', lineHeight: 1.5 }}>{s.notes}</p>
            </div>
          )}

          {/* Snapshots & Backups */}
          <div className="drawer-section">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="drawer-section-title" style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0 }}>
                <Archive size={12} />
                <span>Snapshots ({backups.length})</span>
              </span>
              <button
                className="btn xs ghost"
                onClick={handleCreateBackup}
                disabled={isBackingUp || live}
                data-tip={live ? 'Stop profile to take snapshot' : 'Take snapshot now'}
                style={{ padding: '2px 8px', height: 22, fontSize: 11, gap: 4 }}
              >
                {isBackingUp ? <Loader2 size={11} className="spin" /> : <Save size={11} />}
                <span>Snapshot</span>
              </button>
            </div>

            {loadingBackups ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--txt-3)', fontSize: 11.5, padding: '4px 0' }}>
                <Loader2 size={12} className="spin" />
                <span>Loading snapshots...</span>
              </div>
            ) : backups.length === 0 ? (
              <div style={{ color: 'var(--txt-3)', fontSize: 11.5, lineHeight: 1.4 }}>
                No snapshots saved yet. Snapshots are auto-created when sessions close.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 180, overflowY: 'auto', paddingRight: 2 }}>
                {backups.map((b) => (
                  <div
                    key={b.backupName}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '6px 8px',
                      background: 'rgba(255, 255, 255, 0.03)',
                      borderRadius: 'var(--r-sm)',
                      border: '1px solid var(--line)',
                      fontSize: 11,
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1, paddingRight: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span
                          className="chip"
                          style={{
                            height: 16,
                            padding: '0 5px',
                            fontSize: 9.5,
                            background: b.label === 'auto' ? 'rgba(99, 102, 241, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                            color: b.label === 'auto' ? '#818cf8' : '#34d399',
                          }}
                        >
                          {b.label || 'snap'}
                        </span>
                        <span style={{ fontWeight: 500, color: 'var(--txt)' }}>
                          {ago(b.createdAt)}
                        </span>
                      </div>
                      <div style={{ color: 'var(--txt-3)', fontSize: 10 }}>
                        {(b.sizeBytes / (1024 * 1024)).toFixed(1)} MB · {b.fileCount} files · {b.cookieCount} cookies
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                      <button
                        className="icon-btn xs"
                        onClick={() => handleRestore(b.backupName)}
                        disabled={live || restoring === b.backupName}
                        title={live ? 'Stop profile before restoring' : 'Restore this snapshot'}
                        aria-label="Restore snapshot"
                        style={{ color: 'var(--accent)' }}
                      >
                        {restoring === b.backupName ? (
                          <Loader2 size={12} className="spin" />
                        ) : (
                          <RotateCcw size={12} />
                        )}
                      </button>
                      <button
                        className="icon-btn xs danger"
                        onClick={() => handleDeleteBackup(b.backupName)}
                        disabled={deleting === b.backupName}
                        title="Delete snapshot"
                        aria-label="Delete snapshot"
                      >
                        {deleting === b.backupName ? (
                          <Loader2 size={12} className="spin" />
                        ) : (
                          <Trash2 size={12} />
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="drawer-actions">
          {live ? (
            <button className="btn danger" onClick={onStop}>
              <Square size={12} strokeWidth={2.25} />
              Stop
            </button>
          ) : (
            <button className="btn primary" onClick={onLaunch} disabled={launching}>
              <Play size={12} strokeWidth={2.25} />
              Launch
            </button>
          )}
          <button className="btn" onClick={onEdit}>
            <SlidersHorizontal size={13} strokeWidth={1.75} />
            Configure
          </button>
          <button className="btn danger" onClick={onDelete}>
            <Trash2 size={13} strokeWidth={1.75} />
          </button>
        </div>
      </aside>
    </>
  );
};

// [style] cookie viewer
