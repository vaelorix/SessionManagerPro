import React, { useState } from 'react';
import {
  Check,
  Compass,
  EyeOff,
  Globe,
  Info,
  Layers,
  Loader2,
  MonitorOff,
  Play,
  Shield,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import type { LaunchOptions, PoolStatus } from '../types';
import { Modal, Stepper, Switch, useStored, useUI } from '../ui';
import { api } from '../api';

interface Props {
  pool: PoolStatus | null;
  threadLimit: number;
  onThreadStep: (delta: 1 | -1) => void;
  url: string;
  onUrl: (v: string) => void;
  launchOpts: LaunchOptions;
  onChangeLaunchOpts: (opts: LaunchOptions) => void;
  selectedCount: number;
  isLaunching: boolean;
  onLaunch: () => void;
  onStopAll: () => void;
}

export const RunBar: React.FC<Props> = ({
  pool,
  threadLimit,
  onThreadStep,
  url,
  onUrl,
  launchOpts,
  onChangeLaunchOpts,
  selectedCount,
  isLaunching,
  onLaunch,
  onStopAll,
}) => {
  const { toast, confirm } = useUI();
  const [isCleaning, setIsCleaning] = useState(false);
  const [optsModalOpen, setOptsModalOpen] = useState(false);

  // Temporary state for the options modal
  const [extraUrlsText, setExtraUrlsText] = useState(
    (launchOpts.startUrls || []).join('\n')
  );
  const [webrtc, setWebrtc] = useState<'default' | 'proxy_only' | 'disabled'>(
    launchOpts.webrtcPolicy || 'proxy_only'
  );
  const [headless, setHeadless] = useState(!!launchOpts.headless);
  const [ephemeral, setEphemeral] = useState(!!launchOpts.ephemeral);

  const active = pool?.activeCount ?? 0;
  const queued = pool?.queuedCount ?? 0;
  const slots = Math.max(threadLimit, active);

  const handleOpenOpts = () => {
    setExtraUrlsText((launchOpts.startUrls || []).join('\n'));
    setWebrtc(launchOpts.webrtcPolicy || 'proxy_only');
    setHeadless(!!launchOpts.headless);
    setEphemeral(!!launchOpts.ephemeral);
    setOptsModalOpen(true);
  };

  const handleSaveOpts = () => {
    const urls = extraUrlsText
      .split('\n')
      .map((u: string) => u.trim())
      .filter(Boolean);
    onChangeLaunchOpts({
      ...launchOpts,
      startUrls: urls,
      webrtcPolicy: webrtc,
      headless,
      ephemeral,
    });
    setOptsModalOpen(false);
    toast('success', 'Launch preferences saved');
  };

  const handleCleanSystem = async () => {
    const ok = await confirm({
      title: 'Clean Orphan Processes & Stale Locks?',
      body: 'This will forcefully terminate any orphaned background firefox or worker processes and clear leftover lock files (parent.lock) across all profile directories.',
      confirmLabel: 'Clean Now',
      danger: true,
    });
    if (!ok) return;

    try {
      setIsCleaning(true);
      const res = await api.reapSystem();
      toast(
        'success',
        `System clean complete: reaped ${res.processesReaped} orphan(s), cleared ${res.locksRemoved} lock(s) across ${res.profilesCleaned} profile(s).`
      );
    } catch (err: any) {
      toast('error', `Clean failed: ${err.message || err}`);
    } finally {
      setIsCleaning(false);
    }
  };

  const hasCustomOpts =
    (launchOpts.startUrls && launchOpts.startUrls.length > 0) ||
    launchOpts.webrtcPolicy === 'disabled' ||
    launchOpts.headless ||
    launchOpts.ephemeral;

  return (
    <>
      <div className="runbar">
        <div
          className="meter"
          data-tip="Concurrent browser windows"
          role="status"
          aria-label={`${active} of ${threadLimit} browser windows running${queued ? `, ${queued} queued` : ''}`}
        >
          <div className="meter-slots" aria-hidden="true">
            {Array.from({ length: slots }, (_, i) => (
              <span
                key={i}
                className={`meter-slot${i < active ? ' on' : i < active + queued ? ' queued' : ''}`}
              />
            ))}
          </div>
          <span className="meter-label">
            <b>{active}</b>/{threadLimit}
            {queued > 0 && <> · {queued} queued</>}
          </span>
        </div>

        <Stepper value={threadLimit} min={1} max={20} onStep={onThreadStep} label="Thread cap" />

        <div className="field grow" style={{ maxWidth: 300, flex: 1 }}>
          <Globe size={14} />
          <input
            className="input"
            placeholder="Primary Start URL"
            value={url}
            onChange={(e) => onUrl(e.target.value)}
            aria-label="Start URL"
          />
        </div>

        <button
          className={`btn ghost ${hasCustomOpts ? 'active' : ''}`}
          type="button"
          onClick={handleOpenOpts}
          data-tip="Configure Multi-Tab, WebRTC Leak Guard, Ephemeral Mode"
          aria-label="Launch Options"
          style={{ gap: 6, position: 'relative' }}
        >
          <SlidersHorizontal size={13} strokeWidth={2} />
          Options
          {hasCustomOpts && (
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--accent)',
                position: 'absolute',
                top: 6,
                right: 6,
              }}
            />
          )}
        </button>

        <button
          className="btn primary"
          onClick={onLaunch}
          disabled={!selectedCount || isLaunching}
          data-tip={selectedCount ? 'Ctrl+Enter' : 'Select profiles first'}
        >
          {isLaunching ? (
            <Loader2 size={14} strokeWidth={2} className="spin" />
          ) : (
            <Play size={13} strokeWidth={2.25} />
          )}
          Launch{selectedCount ? ` ${selectedCount}` : ''}
        </button>

        {active > 0 && (
          <button className="btn danger" onClick={onStopAll}>
            <Square size={12} strokeWidth={2.25} />
            Stop all
          </button>
        )}

        <button
          className="btn ghost"
          type="button"
          onClick={async () => {
            try {
              await api.openTerminal();
            } catch (e) {
              console.error('Failed to open terminal:', e);
            }
          }}
          data-tip="Open separate live command terminal window"
          aria-label="Open Live Terminal"
          style={{ gap: 6 }}
        >
          <Terminal size={13} strokeWidth={2} />
          Live Console
        </button>

        <button
          className="btn ghost"
          type="button"
          onClick={handleCleanSystem}
          disabled={isCleaning}
          data-tip="Terminate orphaned browser processes and clear leftover lock files"
          aria-label="Clean System"
          style={{ gap: 6 }}
        >
          {isCleaning ? (
            <Loader2 size={13} strokeWidth={2} className="spin" />
          ) : (
            <ShieldCheck size={13} strokeWidth={2} />
          )}
          Clean System
        </button>
      </div>

      {/* Advanced Launcher Options Modal */}
      {optsModalOpen && (
        <Modal
          title={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <SlidersHorizontal size={16} color="var(--accent)" />
              <span>Profile Launcher Options</span>
            </div>
          }
          onClose={() => setOptsModalOpen(false)}
          width={620}
          footer={
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, width: '100%' }}>
              <button className="btn" onClick={() => setOptsModalOpen(false)}>
                Cancel
              </button>
              <button className="btn primary" onClick={handleSaveOpts} style={{ gap: 6 }}>
                <Check size={14} />
                Apply Options
              </button>
            </div>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Non-Randomization Guarantee Note */}
            <div className="opts-security-banner">
              <div className="opts-security-icon">
                <ShieldCheck size={18} />
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--txt)' }}>
                    Authentic Fingerprint Guard Active
                  </span>
                  <span
                    className="badge"
                    style={{
                      fontSize: 9.5,
                      textTransform: 'uppercase',
                      background: 'var(--accent-soft)',
                      color: 'var(--accent)',
                      fontWeight: 700,
                      padding: '1px 6px',
                    }}
                  >
                    Strict 100% Map
                  </span>
                </div>
                <div style={{ fontSize: 11.5, lineHeight: 1.45, color: 'var(--txt-2)', marginTop: 3 }}>
                  Screen viewport, GPU WebGL renderer, canvas noise, CPU concurrency, and RAM values
                  are strictly mapped 100% from each profile's authentic fingerprint file without synthetic randomization.
                </div>
              </div>
            </div>

            {/* Multi-Tab URLs */}
            <div className="form-row" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="opts-section-head">
                <div className="opts-section-title">
                  <Globe size={13} />
                  <span>Multi-Tab Startup URLs</span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    className="btn xs"
                    onClick={() =>
                      setExtraUrlsText(
                        'https://whoer.net\nhttps://browserleaks.com/webrtc\nhttps://pixelscan.net'
                      )
                    }
                    style={{ gap: 5 }}
                  >
                    <Compass size={12} />
                    Leak Test Presets
                  </button>
                  <button
                    type="button"
                    className="btn xs ghost"
                    onClick={() => setExtraUrlsText('')}
                    style={{ gap: 4 }}
                  >
                    <Trash2 size={11} />
                    Clear
                  </button>
                </div>
              </div>
              <textarea
                className="input"
                rows={3}
                style={{
                  fontFamily: 'var(--mono, monospace)',
                  fontSize: 11.5,
                  resize: 'vertical',
                  minHeight: 74,
                  lineHeight: 1.5,
                  background: 'var(--panel-2)',
                  borderRadius: 'var(--r-md)',
                }}
                placeholder="https://example.com (one URL per line to open multiple tabs automatically on launch)"
                value={extraUrlsText}
                onChange={(e) => setExtraUrlsText(e.target.value)}
              />
              <div style={{ fontSize: 11, color: 'var(--txt-3)', display: 'flex', alignItems: 'center', gap: 5 }}>
                <Info size={12} />
                Each URL entered opens in a new background tab upon profile launch.
              </div>
            </div>

            {/* WebRTC Leak Policy */}
            <div className="form-row" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="opts-section-title">
                <Shield size={13} />
                <span>WebRTC Isolation Policy</span>
              </div>
              <div className="opts-webrtc-grid">
                <div
                  className={`opts-webrtc-card ${webrtc === 'proxy_only' ? 'active' : ''}`}
                  onClick={() => setWebrtc('proxy_only')}
                  role="button"
                  tabIndex={0}
                >
                  <Shield size={16} />
                  <div className="opts-webrtc-title">Proxy Only</div>
                  <div className="opts-webrtc-desc">Route ICE via proxy</div>
                </div>

                <div
                  className={`opts-webrtc-card ${webrtc === 'disabled' ? 'active' : ''}`}
                  onClick={() => setWebrtc('disabled')}
                  role="button"
                  tabIndex={0}
                >
                  <ShieldAlert size={16} />
                  <div className="opts-webrtc-title">Disabled</div>
                  <div className="opts-webrtc-desc">Disable WebRTC</div>
                </div>

                <div
                  className={`opts-webrtc-card ${webrtc === 'default' ? 'active' : ''}`}
                  onClick={() => setWebrtc('default')}
                  role="button"
                  tabIndex={0}
                >
                  <Globe size={16} />
                  <div className="opts-webrtc-title">Default</div>
                  <div className="opts-webrtc-desc">Standard browser ICE</div>
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--txt-3)', lineHeight: 1.4 }}>
                {webrtc === 'proxy_only' &&
                  'Routes WebRTC ICE candidates strictly through the configured proxy tunnel, preventing host IP discovery.'}
                {webrtc === 'disabled' &&
                  'Completely turns off media.peerconnection in Firefox. Guarantees zero WebRTC packets leave the browser.'}
                {webrtc === 'default' && 'Standard browser WebRTC behavior without proxy enforcement.'}
              </div>
            </div>

            {/* Stealth & Lifecycle Controls */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="opts-section-title">
                <Layers size={13} />
                <span>Stealth & Session Persistence</span>
              </div>

              {/* Ephemeral / Disposable Mode */}
              <div
                className={`opts-toggle-card ${ephemeral ? 'active' : ''}`}
                onClick={() => setEphemeral(!ephemeral)}
                role="button"
                tabIndex={0}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
                  <div className="opts-toggle-icon">
                    <EyeOff size={16} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div className="opts-toggle-label">Ephemeral / Pristine Mode</div>
                    <div className="opts-toggle-sub">
                      Do not persist cookies, history, or caches to disk on exit (profile stays 100% pristine).
                    </div>
                  </div>
                </div>
                <Switch checked={ephemeral} onChange={setEphemeral} label="Toggle Ephemeral Mode" />
              </div>

              {/* Headless / Cloaked Toggle */}
              <div
                className={`opts-toggle-card ${headless ? 'active' : ''}`}
                onClick={() => setHeadless(!headless)}
                role="button"
                tabIndex={0}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
                  <div className="opts-toggle-icon">
                    <MonitorOff size={16} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div className="opts-toggle-label">Cloaked Background (Headless)</div>
                    <div className="opts-toggle-sub">
                      Run profile silently in background without rendering an interactive GUI desktop window.
                    </div>
                  </div>
                </div>
                <Switch checked={headless} onChange={setHeadless} label="Toggle Headless Mode" />
              </div>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
};
