import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CircleAlert } from 'lucide-react';
import { Rail, type Tab } from './components/Rail';
import { RunBar } from './components/RunBar';
import { SessionTable } from './components/SessionTable';
import { ProxyPanel } from './components/ProxyPanel';
import { FingerprintPanel } from './components/FingerprintPanel';
import { ExtensionPanel } from './components/ExtensionPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { StatusBar } from './components/StatusBar';
import { ProfileDrawer } from './components/ProfileDrawer';
import { ShortcutHelper } from './components/ShortcutHelper';
import { NewSessionModal, SessionModal, SpecsModal } from './components/Modals';
import { UIProvider, useStored, useUI } from './ui';
import { api } from './api';
import {
  ACCENT_OPTIONS,
  type AccentColor,
  type CardRadius,
  type GlassStyle,
  type FingerprintResource,
  type PoolStatus,
  type ProxyResource,
  type SessionRecord,
  type ExtensionResource,
  type LaunchOptions,
} from './types';

const Panel: React.FC = () => {
  const { toast, confirm } = useUI();

  const [tab, setTab] = useStored<Tab>('tab', 'sessions');
  const [pageSize, setPageSize] = useStored<number>('pageSize', 25);
  const [launchUrl, setLaunchUrl] = useStored<string>('url', '');
  const [theme, setTheme] = useStored<'dark' | 'light'>('theme', 'dark');
  const [accent, setAccent] = useStored<AccentColor>('accent', 'emerald');
  const [cardRadius, setCardRadius] = useStored<CardRadius>('cardRadius', 'curved');
  const [glassStyle, setGlassStyle] = useStored<GlassStyle>('glassStyle', 'acrylic');
  const [meshGlow, setMeshGlow] = useStored<boolean>('meshGlow', true);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute('data-accent', accent);
  }, [accent]);

  useEffect(() => {
    document.documentElement.setAttribute('data-radius', cardRadius);
  }, [cardRadius]);

  useEffect(() => {
    document.documentElement.setAttribute('data-glass', glassStyle);
  }, [glassStyle]);

  useEffect(() => {
    document.documentElement.setAttribute('data-mesh', meshGlow ? 'true' : 'false');
  }, [meshGlow]);

  const cycleAccent = useCallback(() => {
    const ids = ACCENT_OPTIONS.map((o) => o.id);
    const idx = ids.indexOf(accent);
    const next = ids[(idx + 1) % ids.length];
    setAccent(next);
    const nextOpt = ACCENT_OPTIONS.find((o) => o.id === next);
    toast('info', `Accent: ${nextOpt?.label}`);
  }, [accent, setAccent, toast]);

  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [pool, setPool] = useState<PoolStatus | null>(null);
  const [proxies, setProxies] = useState<ProxyResource[]>([]);
  const [fingerprints, setFingerprints] = useState<FingerprintResource[]>([]);
  const [extensions, setExtensions] = useState<ExtensionResource[]>([]);

  const [launchOpts, setLaunchOpts] = useStored<LaunchOptions>('launchOptions', {
    webrtcPolicy: 'proxy_only',
    headless: false,
    ephemeral: false,
    startUrls: [],
  });

  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [launching, setLaunching] = useState<string[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [connected, setConnected] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // The orchestrator owns the concurrency cap; the stepper writes to it.
  const threadLimit = pool?.threadLimit ?? 5;

  const [newOpen, setNewOpen] = useState(false);
  const [editing, setEditing] = useState<SessionRecord | null>(null);
  const [specs, setSpecs] = useState<{ title: string; fp: any } | null>(null);
  const [preview, setPreview] = useState<SessionRecord | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);

  /* ---------------- data ---------------- */

  const loadAll = useCallback(async () => {
    const [s, p, res, ext] = await Promise.allSettled([
      api.getSessions(),
      api.getPool(),
      api.getResources(),
      api.getExtensions(),
    ]);

    // A failed fetch is not an empty inventory. Say so rather than rendering
    // "no proxies configured" over a 500.
    const failed: string[] = [];
    if (s.status === 'fulfilled') setSessions(s.value);
    else failed.push('sessions');
    if (p.status === 'fulfilled' && p.value) setPool(p.value);
    if (res.status === 'fulfilled') {
      setProxies(res.value.proxies || []);
      setFingerprints(res.value.fingerprints || []);
    } else {
      failed.push('resources');
    }
    if (ext.status === 'fulfilled') {
      setExtensions(ext.value || []);
    }

    setLoadError(failed.length ? `Could not load ${failed.join(' and ')}` : null);
    if (failed.length) toast('error', `Could not load ${failed.join(' and ')} — is the backend running?`);
  }, [toast]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Live pool/session stream. Reconnects on drop; never re-subscribes on re-render.
  useEffect(() => {
    const url = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const refreshSessions = () => api.getSessions().then(setSessions).catch(() => {});

    const connect = () => {
      ws = new WebSocket(url);
      ws.onopen = () => setConnected(true);
      ws.onmessage = (e) => {
        let msg: { type: string; data: any };
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }
        if (msg.type === 'pool') {
          setPool(msg.data);
          refreshSessions();
        } else if (msg.type === 'session') {
          refreshSessions();
        }
      };
      ws.onclose = () => {
        if (closed) return;
        setConnected(false);
        timer = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws?.close();
    };
    connect();

    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      ws?.close();
    };
  }, []);

  // Drop selections for profiles that no longer exist.
  useEffect(() => {
    setSelectedIds((prev) => {
      const alive = new Set(sessions.map((s) => s.id));
      const next = prev.filter((id) => alive.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [sessions]);

  // Search is per-view; switching views starts clean.
  const [queriedTab, setQueriedTab] = useState(tab);
  if (queriedTab !== tab) {
    setQueriedTab(tab);
    setQuery('');
  }

  /* ---------------- computed ---------------- */
  const totalCookies = sessions.reduce((n, s) => n + (s.cookieCount || 0), 0);
  const proxiesFree = proxies.filter((p) => !p.isAssigned).length;
  const fpFree = fingerprints.filter((f) => !f.isAssigned && !f.error).length;

  /* ---------------- actions ---------------- */

  const launch = useCallback(
    async (ids: string[], extraOpts?: Partial<LaunchOptions>) => {
      if (!ids.length) return;
      setLaunching((prev) => [...new Set([...prev, ...ids])]);
      try {
        const mergedOpts: LaunchOptions = {
          threads: threadLimit,
          url: launchUrl,
          ...launchOpts,
          ...extraOpts,
        };
        await api.launchSessions(ids, mergedOpts);
        toast('success', `Queued ${ids.length} profile${ids.length > 1 ? 's' : ''}`);
      } catch (err: any) {
        toast('error', err.message);
      } finally {
        setLaunching((prev) => prev.filter((id) => !ids.includes(id)));
      }
    },
    [threadLimit, launchUrl, launchOpts, toast]
  );

  // Steps accumulate against the pending value, and a burst coalesces into one write.
  const pendingLimit = useRef<number | null>(null);
  const limitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stepThreadLimit = (delta: 1 | -1) => {
    const next = Math.min(20, Math.max(1, (pendingLimit.current ?? threadLimit) + delta));
    pendingLimit.current = next;
    setPool((p) => (p ? { ...p, threadLimit: next } : p));

    if (limitTimer.current) clearTimeout(limitTimer.current);
    limitTimer.current = setTimeout(async () => {
      pendingLimit.current = null;
      try {
        setPool(await api.setThreadLimit(next));
      } catch (err: any) {
        toast('error', err.message);
        loadAll();
      }
    }, 300);
  };

  const stop = async (id: string) => {
    try {
      await api.stopSession(id);
    } catch (err: any) {
      toast('error', err.message);
    }
  };

  const stopAll = async () => {
    if (!(await confirm({ title: 'Stop all windows?', body: 'Cookies are saved before closing.', confirmLabel: 'Stop all', danger: true })))
      return;
    try {
      await api.stopAllSessions();
    } catch (err: any) {
      toast('error', err.message);
    }
  };

  const remove = async (ids: string[]) => {
    const ok = await confirm({
      title: ids.length > 1 ? `Delete ${ids.length} profiles?` : `Delete ${ids[0]}?`,
      body: 'The Chrome profile directory and saved cookies are removed. This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    const results = await Promise.allSettled(ids.map((id) => api.deleteSession(id)));
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed) toast('error', `${failed} of ${ids.length} could not be deleted`);
    else toast('success', `Deleted ${ids.length}`);
    loadAll();
  };

  const saveSession = async (id: string, patch: Record<string, unknown>) => {
    if (Object.keys(patch).length) await api.patchSession(id, patch);
    await loadAll();
    toast('success', 'Saved');
  };

  const syncSheet = async () => {
    setIsSyncing(true);
    try {
      const r = await api.syncSheet();
      toast('success', `Sheet synced — ${r.created} new, ${r.updated} updated`);
      await loadAll();
    } catch (err: any) {
      toast('error', err.message);
    } finally {
      setIsSyncing(false);
    }
  };

  /* ---------------- keyboard ---------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A dialog owns the keyboard while it is up; the Modal handles its own Escape.
      if (document.querySelector('.scrim') || document.querySelector('.shortcuts-overlay')) return;

      const el = e.target as HTMLElement | null;
      const typing = !!el?.closest('input, textarea, select');

      if (e.key === '?' && !typing) {
        e.preventDefault();
        setShowShortcuts((v) => !v);
        return;
      }

      if (e.key === 'Escape' && !typing) {
        setSelectedIds([]);
        setPreview(null);
        return;
      }
      if (!typing && (e.key === '/' || ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'f')))) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (!typing && (e.ctrlKey || e.metaKey) && e.key === 'Enter' && selectedIds.length) {
        e.preventDefault();
        launch(selectedIds);
      }
      if (!typing && (e.ctrlKey || e.metaKey) && e.key === 'a' && tab === 'sessions') {
        e.preventDefault();
        setSelectedIds(sessions.map((s) => s.id));
      }
      if (!typing && e.key === 'Delete' && selectedIds.length) {
        e.preventDefault();
        remove(selectedIds);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedIds, launch, sessions, tab]);

  /* ---------------- render ---------------- */

  return (
    <div className="app">
      <Rail
        tab={tab}
        onTab={setTab}
        liveCount={pool?.activeCount ?? 0}
        onRefresh={loadAll}
        onSync={syncSheet}
        isSyncing={isSyncing}
        proxiesCount={proxies.length}
        fpCount={fingerprints.length}
        extCount={extensions.length}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        accent={accent}
        onCycleAccent={cycleAccent}
      />

      <main className="main">
        {loadError && (
          <div className="banner" role="alert">
            <CircleAlert size={14} strokeWidth={2} />
            {loadError}
            <button className="btn xs" onClick={loadAll}>
              Retry
            </button>
          </div>
        )}

        {tab === 'sessions' && (
          <SessionTable
            sessions={sessions}
            query={query}
            onQuery={setQuery}
            searchRef={searchRef}
            selectedIds={selectedIds}
            onSelect={setSelectedIds}
            launchingIds={launching}
            onLaunch={(id) => launch([id])}
            onStop={stop}
            onDelete={remove}
            onEdit={setEditing}
            onNew={() => setNewOpen(true)}
            onPreview={setPreview}
            pageSize={pageSize}
            onPageSize={setPageSize}
            runbar={
              <>
                <StatusBar
                  totalProfiles={sessions.length}
                  activeCount={pool?.activeCount ?? 0}
                  queuedCount={pool?.queuedCount ?? 0}
                  totalCookies={totalCookies}
                  proxiesFree={proxiesFree}
                  proxiesTotal={proxies.length}
                  fpFree={fpFree}
                  fpTotal={fingerprints.length}
                />
                <RunBar
                  pool={pool}
                  threadLimit={threadLimit}
                  onThreadStep={stepThreadLimit}
                  url={launchUrl}
                  onUrl={setLaunchUrl}
                  launchOpts={launchOpts}
                  onChangeLaunchOpts={setLaunchOpts}
                  selectedCount={selectedIds.length}
                  isLaunching={launching.length > 0}
                  onLaunch={() => launch(selectedIds)}
                  onStopAll={stopAll}
                />
              </>
            }
          />
        )}

        {tab === 'proxies' && (
          <ProxyPanel
            proxies={proxies}
            query={query}
            onQuery={setQuery}
            searchRef={searchRef}
            pageSize={pageSize}
            onPageSize={setPageSize}
            onToast={toast}
            onRefresh={loadAll}
          />
        )}

        {tab === 'fingerprints' && (
          <FingerprintPanel
            fingerprints={fingerprints}
            query={query}
            onQuery={setQuery}
            searchRef={searchRef}
            onInspect={(f) => setSpecs({ title: f.file, fp: f })}
            onRefresh={loadAll}
            pageSize={pageSize}
            onPageSize={setPageSize}
          />
        )}

        {tab === 'extensions' && (
          <ExtensionPanel
            extensions={extensions}
            sessions={sessions}
            query={query}
            onQuery={setQuery}
            searchRef={searchRef}
            pageSize={pageSize}
            onPageSize={setPageSize}
            onToast={toast}
            onRefresh={loadAll}
          />
        )}

        {tab === 'settings' && (
          <SettingsPanel
            pool={pool}
            theme={theme}
            accent={accent}
            cardRadius={cardRadius}
            glassStyle={glassStyle}
            meshGlow={meshGlow}
            onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            onSelectAccent={(a) => setAccent(a)}
            onSelectRadius={(r) => setCardRadius(r)}
            onSelectGlass={(g) => setGlassStyle(g)}
            onToggleMesh={() => setMeshGlow((m) => !m)}
            onRefresh={loadAll}
            onToast={toast}
          />
        )}
      </main>

      {newOpen && (
        <NewSessionModal
          onClose={() => setNewOpen(false)}
          proxies={proxies}
          fingerprints={fingerprints}
          onCreateSingle={async (name, proxy, fpt) => {
            try {
              await api.createSession({ name, proxy, fingerprintFile: fpt });
              toast('success', `Created ${name}`);
            } finally {
              await loadAll();
            }
          }}
          onCreateBatch={async (count, prefix) => {
            try {
              const r = await api.autoGenerateSessions(count, prefix);
              toast('success', `Created ${r.created.length} profiles`);
            } finally {
              await loadAll();
            }
          }}
          onImportCsv={async (csv) => {
            try {
              const r = await api.importAccounts(csv);
              toast('success', `Imported ${r.count} accounts`);
            } finally {
              await loadAll();
            }
          }}
        />
      )}

      {editing && (
        <SessionModal
          session={editing}
          proxies={proxies}
          fingerprints={fingerprints}
          onClose={() => setEditing(null)}
          onSave={(patch) => saveSession(editing.id, patch)}
        />
      )}

      {specs && <SpecsModal title={specs.title} fp={specs.fp} onClose={() => setSpecs(null)} />}

      {preview && (
        <ProfileDrawer
          session={preview}
          onClose={() => setPreview(null)}
          onLaunch={() => { launch([preview.id]); setPreview(null); }}
          onStop={() => { stop(preview.id); setPreview(null); }}
          onEdit={() => { setEditing(preview); setPreview(null); }}
          onDelete={() => { remove([preview.id]); setPreview(null); }}
          launching={launching.includes(preview.id)}
          onRefresh={loadAll}
        />
      )}

      {showShortcuts && <ShortcutHelper onClose={() => setShowShortcuts(false)} />}
    </div>
  );
};

export const App: React.FC = () => (
  <UIProvider>
    <Panel />
  </UIProvider>
);

export default App;
