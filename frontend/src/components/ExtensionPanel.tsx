import React, { useMemo, useRef, useState } from 'react';
import {
  Check,
  Globe,
  Layers,
  Loader2,
  Package,
  Plus,
  Puzzle,
  RefreshCw,
  Search,
  Sliders,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import type { ExtensionResource, SessionRecord } from '../types';
import { api } from '../api';
import { CopyButton, Empty, Modal, Pager, Switch, Toolbar, usePaged, useStored } from '../ui';

interface Props {
  extensions: ExtensionResource[];
  sessions: SessionRecord[];
  query: string;
  onQuery: (q: string) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  pageSize: number;
  onPageSize: (n: number) => void;
  onToast: (kind: 'success' | 'error' | 'info', text: string) => void;
  onRefresh: () => void;
}

type Filter = 'all' | 'global' | 'profile';

export const ExtensionPanel: React.FC<Props> = ({
  extensions,
  sessions,
  query,
  onQuery,
  searchRef,
  pageSize,
  onPageSize,
  onToast,
  onRefresh,
}) => {
  const [filter, setFilter] = useState<Filter>('all');
  const [uploading, setUploading] = useState(false);
  const [assigningExt, setAssigningExt] = useState<ExtensionResource | null>(null);
  const [selectedProfiles, setSelectedProfiles] = useState<string[]>([]);
  const [profileSearch, setProfileSearch] = useState('');
  const [isSavingAssign, setIsSavingAssign] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const globalCount = extensions.filter((e) => e.isGlobal).length;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return extensions.filter((e) => {
      if (filter === 'global' && !e.isGlobal) return false;
      if (filter === 'profile' && e.isGlobal) return false;
      if (!q) return true;
      return [e.name, e.version, e.description, e.type, e.id]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [extensions, query, filter]);

  const paged = usePaged(rows, pageSize, `${filter}|${query}`);

  // Handle file upload
  const handleFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    const file = files[0];
    const nameLower = file.name.toLowerCase();
    if (!nameLower.endsWith('.xpi') && !nameLower.endsWith('.zip') && !nameLower.endsWith('.crx')) {
      onToast('error', 'Only .xpi, .crx, and .zip extension files are supported');
      return;
    }

    try {
      setUploading(true);
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const b64 = (reader.result as string).split(',')[1];
          const res = await api.uploadExtension(file.name, b64);
          onToast('success', `Installed "${res.extension.name || file.name}" v${res.extension.version}`);
          onRefresh();
        } catch (err: any) {
          onToast('error', `Upload failed: ${err.message || err}`);
        } finally {
          setUploading(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      setUploading(false);
      onToast('error', `Error reading file: ${err.message}`);
    }
  };

  const handleToggleGlobal = async (ext: ExtensionResource) => {
    try {
      const nextGlobal = !ext.isGlobal;
      await api.toggleExtensionGlobal(ext.id, nextGlobal);
      onToast(
        'info',
        nextGlobal
          ? `"${ext.name}" will now load globally in all profiles`
          : `"${ext.name}" set to profile-specific mode`
      );
      onRefresh();
    } catch (err: any) {
      onToast('error', `Failed to update global state: ${err.message}`);
    }
  };

  const handleDelete = async (ext: ExtensionResource) => {
    if (!window.confirm(`Delete extension "${ext.name}"? This removes the unpacked files.`)) return;
    try {
      await api.deleteExtension(ext.id);
      onToast('success', `Deleted "${ext.name}"`);
      onRefresh();
    } catch (err: any) {
      onToast('error', `Delete failed: ${err.message}`);
    }
  };

  const openAssignModal = (ext: ExtensionResource) => {
    setAssigningExt(ext);
    setSelectedProfiles(ext.assignedProfiles || []);
    setProfileSearch('');
  };

  const saveAssignments = async () => {
    if (!assigningExt) return;
    try {
      setIsSavingAssign(true);
      await api.assignExtensionToProfiles(assigningExt.id, selectedProfiles);
      onToast('success', `Updated assignments for "${assigningExt.name}"`);
      setAssigningExt(null);
      onRefresh();
    } catch (err: any) {
      onToast('error', `Assignment failed: ${err.message}`);
    } finally {
      setIsSavingAssign(false);
    }
  };

  const filteredSessions = useMemo(() => {
    const q = profileSearch.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (s) => s.id.toLowerCase().includes(q) || (s.email && s.email.toLowerCase().includes(q))
    );
  }, [sessions, profileSearch]);

  return (
    <>
      <Toolbar title="Extensions Hub" count={extensions.length}>
        <div className="seg" role="group" aria-label="Filter extensions">
          {(['all', 'global', 'profile'] as Filter[]).map((f) => (
            <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : f === 'global' ? `Global (${globalCount})` : 'Profile Bound'}
            </button>
          ))}
        </div>

        <div className="field search">
          <Search size={14} />
          <input
            ref={searchRef}
            type="search"
            className="input"
            placeholder="Search extensions  /"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            aria-label="Search extensions"
          />
        </div>

        <input
          type="file"
          ref={fileInputRef}
          style={{ display: 'none' }}
          accept=".xpi,.crx,.zip"
          onChange={(e) => handleFiles(e.target.files)}
        />

        <button
          className="btn primary"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? <Loader2 size={13} className="spin" /> : <UploadCloud size={13} />}
          Upload (.xpi / .crx / .zip)
        </button>

        <button className="icon-btn" onClick={onRefresh} title="Refresh extensions">
          <RefreshCw size={14} />
        </button>
      </Toolbar>

      <div className="view">
        {/* Drag & Drop Quick Area */}
        <div
          className="upload-dropzone"
          style={{
            border: '1.5px dashed var(--line)',
            borderRadius: 'var(--radius)',
            padding: '16px 20px',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--card-bg, rgba(255,255,255,0.02))',
            gap: 16,
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleFiles(e.dataTransfer.files);
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 8,
                background: 'var(--accent-glow, rgba(16,185,129,0.12))',
                color: 'var(--accent)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Puzzle size={20} />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--txt)' }}>
                Drop Firefox .xpi, Chrome .crx, or WebExtension .zip archives here
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--dim)', marginTop: 2 }}>
                Auto-unpacked with manifest parsing and seamlessly injected into browser profiles via Marionette.
              </div>
            </div>
          </div>
          <button
            className="btn xs"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            <Plus size={12} />
            Choose File
          </button>
        </div>

        {!extensions.length ? (
          <div className="card">
            <Empty
              icon={<Puzzle size={32} strokeWidth={1.5} />}
              text="No extensions installed yet. Drop .xpi / .crx / .zip files above or place folders in resources/extensions/"
              action={
                <button className="btn" onClick={() => fileInputRef.current?.click()}>
                  Install Extension
                </button>
              }
            />
          </div>
        ) : rows.length === 0 ? (
          <div className="card">
            <Empty icon={<Search size={26} strokeWidth={1.5} />} text="No extensions match search." />
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div className="extensions-grid">
              {paged.slice.map((ext) => {
                return (
                  <div
                    key={ext.id}
                    className={`extension-tile ${ext.isGlobal ? 'active-global' : ''}`}
                  >
                    {/* Top Row: Icon + Title + Version + Badges + Delete */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        justifyContent: 'space-between',
                        gap: 14,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
                        {ext.icon ? (
                          <img
                            src={ext.icon}
                            alt=""
                            style={{
                              width: 44,
                              height: 44,
                              borderRadius: 10,
                              objectFit: 'contain',
                              background: 'rgba(0,0,0,0.3)',
                              border: '1px solid var(--line-2)',
                              padding: 3,
                              flexShrink: 0,
                            }}
                          />
                        ) : (
                          <div
                            style={{
                              width: 44,
                              height: 44,
                              borderRadius: 10,
                              background: 'var(--accent-soft)',
                              color: 'var(--accent)',
                              border: '1px solid var(--accent-line)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                            }}
                          >
                            <Puzzle size={22} />
                          </div>
                        )}
                        <div style={{ minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: 15,
                              fontWeight: 600,
                              color: 'var(--txt)',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              lineHeight: 1.3,
                            }}
                          >
                            <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                              {ext.name}
                            </span>
                            <span className="dim" style={{ fontSize: 11.5, fontWeight: 500, flexShrink: 0 }}>
                              v{ext.version}
                            </span>
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 5 }}>
                            <span className="badge" style={{ textTransform: 'uppercase', fontSize: 10, padding: '1px 7px' }}>
                              {ext.type}
                            </span>
                            {ext.isGlobal ? (
                              <span className="badge live" style={{ fontSize: 10, padding: '1px 8px' }}>
                                <span className="dot" />
                                Global Active
                              </span>
                            ) : (
                              <span className="badge" style={{ fontSize: 10, padding: '1px 8px' }}>
                                {ext.assignedProfiles?.length || 0} Profiles
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <button
                        className="icon-btn xs"
                        title="Delete extension"
                        onClick={() => handleDelete(ext)}
                        style={{ color: 'var(--danger)', marginTop: 2 }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>

                    {/* Description */}
                    {ext.description && (
                      <div
                        style={{
                          fontSize: 12.5,
                          color: 'var(--txt-2)',
                          lineHeight: 1.5,
                        }}
                        title={ext.description}
                      >
                        {ext.description}
                      </div>
                    )}

                    {/* Global Auto-Injection Row with Switch */}
                    <div
                      style={{
                        padding: '12px 16px',
                        background: 'rgba(0, 0, 0, 0.2)',
                        border: '1px solid var(--line)',
                        borderRadius: 'var(--r-md)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 16,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 12.5,
                            fontWeight: 600,
                            color: 'var(--txt)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                          }}
                        >
                          Global Auto-Injection
                          {ext.isGlobal && (
                            <span style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 600 }}>
                              • Active in all profiles
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--txt-3)', marginTop: 2, lineHeight: 1.4 }}>
                          {ext.isGlobal
                            ? 'Auto-loaded and pinned to the navigation toolbar in all launched profiles.'
                            : 'Disabled globally. Only injected into explicitly assigned browser profiles.'}
                        </div>
                      </div>
                      <Switch
                        checked={ext.isGlobal}
                        onChange={() => handleToggleGlobal(ext)}
                        label="Toggle Global Injection"
                      />
                    </div>

                    {/* Profile-Specific Assignment Row (if not global) */}
                    {!ext.isGlobal && (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '10px 14px',
                          background: 'var(--panel-2)',
                          border: '1px solid var(--line)',
                          borderRadius: 'var(--r-md)',
                          fontSize: 11.5,
                        }}
                      >
                        <div style={{ color: 'var(--txt-2)' }}>
                          {ext.assignedProfiles?.length ? (
                            <span>
                              Assigned to <b>{ext.assignedProfiles.length}</b> profile(s)
                            </span>
                          ) : (
                            <span className="dim">Not assigned to any profile</span>
                          )}
                        </div>
                        <button
                          className="btn xs"
                          onClick={() => openAssignModal(ext)}
                          style={{ gap: 5 }}
                        >
                          <Layers size={12} />
                          Assign Profiles
                        </button>
                      </div>
                    )}

                    {/* Footer: ID & Path */}
                    <div className="tile-foot" style={{ marginTop: 'auto', paddingTop: 10 }}>
                      <span className="mono dim" style={{ fontSize: 10.5, letterSpacing: '0.02em' }}>
                        ID: <span style={{ color: 'var(--txt-2)' }}>{ext.id}</span>
                      </span>
                      <CopyButton value={ext.path} label="Copy directory path" />
                    </div>
                  </div>
                );
              })}
            </div>

            <Pager
              standalone
              page={paged.page}
              pages={paged.pages}
              from={paged.from}
              to={paged.to}
              total={rows.length}
              noun="extensions"
              pageSize={pageSize}
              onPage={paged.setPage}
              onPageSize={onPageSize}
            />
          </div>
        )}
      </div>

      {/* Assignment Modal */}
      {assigningExt && (
        <Modal
          title={`Assign Extension: ${assigningExt.name}`}
          onClose={() => setAssigningExt(null)}
          width={520}
          footer={
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn xs"
                  onClick={() => setSelectedProfiles(sessions.map((s) => s.id))}
                >
                  Select All
                </button>
                <button className="btn xs" onClick={() => setSelectedProfiles([])}>
                  Deselect All
                </button>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={() => setAssigningExt(null)}>
                  Cancel
                </button>
                <button className="btn primary" onClick={saveAssignments} disabled={isSavingAssign}>
                  {isSavingAssign ? <Loader2 size={13} className="spin" /> : <Check size={13} />}
                  Save Assignments ({selectedProfiles.length})
                </button>
              </div>
            </div>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontSize: 12, color: 'var(--dim)', margin: 0 }}>
              Select which profiles will auto-load <b>{assigningExt.name}</b> upon launch.
            </p>

            <div className="field search" style={{ margin: 0 }}>
              <Search size={14} />
              <input
                className="input"
                placeholder="Filter profiles..."
                value={profileSearch}
                onChange={(e) => setProfileSearch(e.target.value)}
              />
            </div>

            <div
              style={{
                maxHeight: 280,
                overflowY: 'auto',
                border: '1px solid var(--line)',
                borderRadius: 6,
                padding: '4px 0',
                background: 'rgba(0,0,0,0.1)',
              }}
            >
              {filteredSessions.length === 0 ? (
                <div style={{ padding: 16, textAlign: 'center', color: 'var(--dim)', fontSize: 12 }}>
                  No profiles match filter
                </div>
              ) : (
                filteredSessions.map((s) => {
                  const checked = selectedProfiles.includes(s.id);
                  return (
                    <label
                      key={s.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '7px 12px',
                        cursor: 'pointer',
                        fontSize: 12.5,
                        background: checked ? 'rgba(var(--accent-rgb, 16,185,129), 0.08)' : 'transparent',
                        borderBottom: '1px solid rgba(255,255,255,0.03)',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedProfiles((prev) => [...prev, s.id]);
                          } else {
                            setSelectedProfiles((prev) => prev.filter((id) => id !== s.id));
                          }
                        }}
                      />
                      <span style={{ fontWeight: 500, color: 'var(--txt)' }}>{s.id}</span>
                      {s.email && (
                        <span style={{ color: 'var(--dim)', fontSize: 11, marginLeft: 'auto' }}>
                          {s.email}
                        </span>
                      )}
                    </label>
                  );
                })
              )}
            </div>
          </div>
        </Modal>
      )}
    </>
  );
};
