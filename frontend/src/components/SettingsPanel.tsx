import React, { useState } from 'react';
import {
  Activity,
  Check,
  CheckCircle2,
  Clock,
  Compass,
  Cpu,
  Database,
  Download,
  ExternalLink,
  Flame,
  Globe,
  HardDrive,
  Keyboard,
  Layers,
  Maximize,
  Moon,
  Monitor,
  MousePointer,
  Palette,
  Play,
  RefreshCw,
  RotateCcw,
  Shield,
  ShieldCheck,
  Sliders,
  Sparkles,
  Sun,
  Terminal,
  Zap,
} from 'lucide-react';
import type { AccentColor, CardRadius, GlassStyle, PoolStatus } from '../types';
import { ACCENT_OPTIONS } from '../types';
import { Stepper, Toolbar, useStored } from '../ui';
import { api } from '../api';

interface Props {
  pool: PoolStatus | null;
  theme: 'dark' | 'light';
  accent?: AccentColor;
  cardRadius?: CardRadius;
  glassStyle?: GlassStyle;
  meshGlow?: boolean;
  onToggleTheme: () => void;
  onSelectAccent?: (color: AccentColor) => void;
  onSelectRadius?: (radius: CardRadius) => void;
  onSelectGlass?: (glass: GlassStyle) => void;
  onToggleMesh?: () => void;
  onRefresh: () => void;
  onToast: (kind: 'success' | 'error' | 'info', text: string) => void;
}

export const SettingsPanel: React.FC<Props> = ({
  pool,
  theme,
  accent = 'emerald',
  cardRadius = 'curved',
  glassStyle = 'acrylic',
  meshGlow = true,
  onToggleTheme,
  onSelectAccent,
  onSelectRadius,
  onSelectGlass,
  onToggleMesh,
  onRefresh,
  onToast,
}) => {
  const [defaultUrl, setDefaultUrl] = useStored<string>('url', 'https://ipinfo.io');
  const [humanizeMouse, setHumanizeMouse] = useStored<boolean>('humanizeMouse', true);
  const [randomSeed, setRandomSeed] = useStored<boolean>('randomSeed', false);
  const [autoSaveCookies, setAutoSaveCookies] = useStored<boolean>('autoSaveCookies', true);
  const [dnsLeakProtection, setDnsLeakProtection] = useStored<boolean>('dnsLeakProtection', true);
  const [aspectPreset, setAspectPreset] = useStored<string>('aspectPreset', '16:9 (1600×900)');

  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<string | null>(null);

  const runSelfCheck = async () => {
    setChecking(true);
    setCheckResult(null);
    try {
      const stats = await api.getStats();
      if (stats) {
        setCheckResult(`Ready — Engine verified (${stats.proxiesTotal} proxies, ${stats.fingerprintsTotal} prints)`);
        onToast('success', 'Zendriver stealth engine healthy');
      }
    } catch (err: any) {
      setCheckResult(`Error: ${err.message}`);
      onToast('error', 'Health check failed');
    } finally {
      setChecking(false);
    }
  };

  const exportProfiles = async () => {
    try {
      const sessions = await api.getSessions();
      const blob = new Blob([JSON.stringify(sessions, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `SessionManagerPro_Backup_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      onToast('success', `Exported ${sessions.length} profiles`);
    } catch (err: any) {
      onToast('error', 'Export failed: ' + err.message);
    }
  };

  const setRatioPreset = (preset: string) => {
    setAspectPreset(preset);
    if (preset.includes('1600×900')) {
      window.resizeTo?.(1600, 900);
    } else if (preset.includes('1440×810')) {
      window.resizeTo?.(1440, 810);
    } else if (preset.includes('1280×720')) {
      window.resizeTo?.(1280, 720);
    } else if (preset.includes('1920×1080')) {
      window.resizeTo?.(1920, 1080);
    }
    onToast('info', `Window ratio preset set to ${preset}`);
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  return (
    <>
      <Toolbar title="Settings">
        <span
          className="badge live"
          style={{
            fontSize: 11,
            padding: '3px 9px',
            background: 'var(--accent-soft)',
            color: 'var(--accent)',
            borderColor: 'var(--accent-line)',
          }}
        >
          <span className="dot" />
          Zendriver Active
        </span>

        <button
          className="btn ghost xs"
          onClick={async () => {
            try {
              await api.openTerminal();
              onToast('success', 'Terminal Console opened');
            } catch (e) {
              onToast('error', 'Failed to open terminal');
            }
          }}
          data-tip="Open Live Console terminal"
          style={{ gap: 6 }}
        >
          <Terminal size={12} strokeWidth={2} />
          Terminal
        </button>
      </Toolbar>

      <div className="view settings-view">
        <div className="settings-container">
          {/* Section 1: Stealth & Browser Engine */}
        <section className="settings-card">
          <div className="settings-header">
            <div className="stat-icon-wrap stat-green">
              <ShieldCheck size={20} strokeWidth={2.2} />
            </div>
            <div>
              <h3>Zendriver Stealth Engine (CDP Driverless)</h3>
              <p>Driverless Chrome DevTools Protocol automation with hardware-consistent fingerprint emulation</p>
            </div>
            <button
              className="btn xs primary"
              onClick={runSelfCheck}
              disabled={checking}
              style={{ marginLeft: 'auto' }}
            >
              <Zap size={12} strokeWidth={2} className={checking ? 'spin' : undefined} />
              {checking ? 'Checking...' : 'Run Diagnostics'}
            </button>
          </div>

          {checkResult && (
            <div className={`alert ${checkResult.startsWith('Error') ? 'error' : 'success'}`} style={{ marginTop: 12 }}>
              <CheckCircle2 size={16} color="var(--accent)" />
              <span>{checkResult}</span>
            </div>
          )}

          <div className="settings-list">
            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">Engine Runtime</span>
                <span className="settings-row-desc">Pinned Python 3.11.9 virtual environment (.venv)</span>
              </div>
              <span className="badge live">
                <span className="dot" />
                Python 3.11.9 Active
              </span>
            </div>

            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">Humanized Mouse Movement</span>
                <span className="settings-row-desc">Simulate authentic Bezier mouse curves and variable cursor speeds</span>
              </div>
              <button
                className={`btn xs ${humanizeMouse ? 'primary' : ''}`}
                onClick={() => setHumanizeMouse(!humanizeMouse)}
              >
                {humanizeMouse ? 'Enabled' : 'Disabled'}
              </button>
            </div>

            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">DNS Leak Prevention</span>
                <span className="settings-row-desc">Force remote DNS resolution via SOCKS5 proxy tunnel</span>
              </div>
              <button
                className={`btn xs ${dnsLeakProtection ? 'primary' : ''}`}
                onClick={() => setDnsLeakProtection(!dnsLeakProtection)}
              >
                {dnsLeakProtection ? 'Protected' : 'Standard'}
              </button>
            </div>

            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">Deterministic Fingerprints</span>
                <span className="settings-row-desc">Generate static reproducible fingerprint seeds per profile</span>
              </div>
              <button
                className={`btn xs ${!randomSeed ? 'primary' : ''}`}
                onClick={() => setRandomSeed(!randomSeed)}
              >
                {!randomSeed ? 'Sticky Seeds' : 'Random on Launch'}
              </button>
            </div>
          </div>
        </section>

        {/* Section 2: UI Appearance & Accent Theme */}
        <section className="settings-card">
          <div className="settings-header">
            <div className="stat-icon-wrap stat-purple">
              <Palette size={20} strokeWidth={2.2} />
            </div>
            <div>
              <h3>UI Appearance & Accent Theme</h3>
              <p>Personalize accent colors, card corner curvatures, and dynamic ambient lighting</p>
            </div>
            <span
              className="badge live"
              style={{
                marginLeft: 'auto',
                background: 'var(--accent)',
                color: 'var(--accent-ink)',
                border: 'none',
              }}
            >
              Active: {ACCENT_OPTIONS.find((o) => o.id === accent)?.label || 'Accent'}
            </span>
          </div>

          <div className="settings-list">
            {/* Theme Mode */}
            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">Theme Mode</span>
                <span className="settings-row-desc">Toggle between Apple iOS Light Mode and OLED Dark Mode</span>
              </div>
              <div className="seg" role="group" aria-label="Theme selection">
                <button
                  aria-pressed={theme === 'dark'}
                  onClick={() => theme !== 'dark' && onToggleTheme()}
                >
                  <Moon size={13} /> Dark
                </button>
                <button
                  aria-pressed={theme === 'light'}
                  onClick={() => theme !== 'light' && onToggleTheme()}
                >
                  <Sun size={13} /> Light
                </button>
              </div>
            </div>

            {/* Accent Theme Color Swatches */}
            <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
              <div className="settings-row-info">
                <span className="settings-row-label">Accent Theme Color</span>
                <span className="settings-row-desc">
                  Changes primary action buttons, active tab indicators, focus rings, progress bars, and glowing badges
                </span>
              </div>
              <div className="accent-grid">
                {ACCENT_OPTIONS.map((opt) => {
                  const isActive = accent === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      className={`accent-card ${isActive ? 'active' : ''}`}
                      onClick={() => {
                        onSelectAccent?.(opt.id);
                        onToast('success', `Accent theme set to ${opt.label}`);
                      }}
                      aria-pressed={isActive}
                    >
                      <div
                        className="accent-circle"
                        style={{
                          background: `linear-gradient(135deg, ${opt.color}, ${opt.color2})`,
                        }}
                      >
                        {isActive && <Check size={14} strokeWidth={2.8} />}
                      </div>
                      <div className="accent-card-info">
                        <span className="accent-card-name">{opt.label}</span>
                        <span className="accent-card-sub">{opt.sublabel}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Card Curvature Style */}
            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">Card Corner Radius</span>
                <span className="settings-row-desc">Adjust UI geometry from sharp tech cards to ultra-rounded pebbles</span>
              </div>
              <div className="seg" role="group" aria-label="Corner radius">
                <button
                  aria-pressed={cardRadius === 'compact'}
                  onClick={() => {
                    onSelectRadius?.('compact');
                    onToast('info', 'Corner radius set to Compact (12px)');
                  }}
                >
                  Compact (12px)
                </button>
                <button
                  aria-pressed={cardRadius === 'curved'}
                  onClick={() => {
                    onSelectRadius?.('curved');
                    onToast('info', 'Corner radius set to iOS Curved (20px)');
                  }}
                >
                  iOS Curved (20px)
                </button>
                <button
                  aria-pressed={cardRadius === 'pill'}
                  onClick={() => {
                    onSelectRadius?.('pill');
                    onToast('info', 'Corner radius set to Pill Smooth (28px)');
                  }}
                >
                  Pill Smooth (28px)
                </button>
              </div>
            </div>

            {/* Glassmorphism Contrast */}
            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">Glassmorphism & Contrast</span>
                <span className="settings-row-desc">Frosted translucent acrylic backdrop vs opaque high-contrast panels</span>
              </div>
              <div className="seg" role="group" aria-label="Glassmorphism style">
                <button
                  aria-pressed={glassStyle === 'acrylic'}
                  onClick={() => {
                    onSelectGlass?.('acrylic');
                    onToast('info', 'Frosted Acrylic glass enabled');
                  }}
                >
                  Frosted Acrylic
                </button>
                <button
                  aria-pressed={glassStyle === 'solid'}
                  onClick={() => {
                    onSelectGlass?.('solid');
                    onToast('info', 'Solid Contrast panels enabled');
                  }}
                >
                  Solid Contrast
                </button>
              </div>
            </div>

            {/* Ambient Mesh Glow */}
            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">Ambient Accent Mesh Glow</span>
                <span className="settings-row-desc">Subtly illuminate background gradients using the chosen accent color</span>
              </div>
              <button
                className={`btn xs ${meshGlow ? 'primary' : ''}`}
                onClick={() => {
                  onToggleMesh?.();
                  onToast('info', meshGlow ? 'Ambient mesh disabled' : 'Ambient mesh enabled');
                }}
              >
                <Sparkles size={13} strokeWidth={2} />
                {meshGlow ? 'Glow Enabled' : 'Glow Disabled'}
              </button>
            </div>
          </div>
        </section>

        {/* Section 3: Display & Aspect Ratio (16:9 Default) */}
        <section className="settings-card">
          <div className="settings-header">
            <div className="stat-icon-wrap stat-blue">
              <Monitor size={20} strokeWidth={2.2} />
            </div>
            <div>
              <h3>Display & Aspect Ratio</h3>
              <p>Default window layout calibrated to 16:9 widescreen proportions</p>
            </div>
            <span className="badge live" style={{ marginLeft: 'auto' }}>
              Default 16:9
            </span>
          </div>

          <div className="settings-list">
            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">16:9 Aspect Ratio Presets</span>
                <span className="settings-row-desc">Current selection: {aspectPreset}</span>
              </div>
              <div className="seg" role="group" aria-label="Ratio Presets">
                <button
                  aria-pressed={aspectPreset.includes('1600×900')}
                  onClick={() => setRatioPreset('16:9 (1600×900)')}
                >
                  1600×900
                </button>
                <button
                  aria-pressed={aspectPreset.includes('1440×810')}
                  onClick={() => setRatioPreset('16:9 (1440×810)')}
                >
                  1440×810
                </button>
                <button
                  aria-pressed={aspectPreset.includes('1920×1080')}
                  onClick={() => setRatioPreset('16:9 (1920×1080)')}
                >
                  1920×1080
                </button>
              </div>
            </div>

            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">Fullscreen Toggle</span>
                <span className="settings-row-desc">Expand SessionManagerPro to fill your entire display</span>
              </div>
              <button className="btn xs" onClick={toggleFullscreen}>
                <Maximize size={13} strokeWidth={2} />
                Toggle Fullscreen
              </button>
            </div>
          </div>
        </section>

        {/* Section 3: Concurrency & Automation Defaults */}
        <section className="settings-card">
          <div className="settings-header">
            <div className="stat-icon-wrap stat-orange">
              <Sliders size={20} strokeWidth={2.2} />
            </div>
            <div>
              <h3>Concurrency & Automation</h3>
              <p>Control background thread capacity and profile launch defaults</p>
            </div>
          </div>

          <div className="settings-list">
            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">Default Start URL</span>
                <span className="settings-row-desc">Initial address loaded when browser profiles open</span>
              </div>
              <div className="field" style={{ width: 280 }}>
                <Globe size={13} />
                <input
                  className="input"
                  value={defaultUrl}
                  onChange={(e) => setDefaultUrl(e.target.value)}
                  placeholder="https://..."
                />
              </div>
            </div>

            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">Quick URL Presets</span>
                <span className="settings-row-desc">Click a chip to assign as launch target</span>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[
                  'https://ipinfo.io',
                  'https://browserleaks.com',
                  'https://google.com',
                  'about:blank',
                ].map((url) => (
                  <button
                    key={url}
                    className={`badge ${defaultUrl === url ? 'live' : ''}`}
                    style={{ cursor: 'pointer' }}
                    onClick={() => {
                      setDefaultUrl(url);
                      onToast('info', `Set Start URL to ${url}`);
                    }}
                  >
                    {url.replace('https://', '')}
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">Auto-Save Cookies on Close</span>
                <span className="settings-row-desc">Persist all session cookies to disk whenever a tab closes</span>
              </div>
              <button
                className={`btn xs ${autoSaveCookies ? 'primary' : ''}`}
                onClick={() => setAutoSaveCookies(!autoSaveCookies)}
              >
                {autoSaveCookies ? 'Auto-Save On' : 'Manual Only'}
              </button>
            </div>
          </div>
        </section>

        {/* Section 4: Data Storage & Backups */}
        <section className="settings-card">
          <div className="settings-header">
            <div className="stat-icon-wrap stat-purple">
              <Database size={20} strokeWidth={2.2} />
            </div>
            <div>
              <h3>Data & Storage Management</h3>
              <p>Profile folders, session storage, and backup tools</p>
            </div>
          </div>

          <div className="settings-list">
            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">Backup All Profiles</span>
                <span className="settings-row-desc">Export all profiles, proxies, and fingerprint associations to JSON</span>
              </div>
              <button className="btn xs" onClick={exportProfiles}>
                <Download size={13} strokeWidth={2} />
                Export JSON
              </button>
            </div>

            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">Rescan Filesystem Inventory</span>
                <span className="settings-row-desc">Reload proxies from resources/proxies and fingerprints from resources/fingerprints</span>
              </div>
              <button className="btn xs" onClick={() => { onRefresh(); onToast('success', 'Inventory rescanned'); }}>
                <RefreshCw size={13} strokeWidth={2} />
                Rescan Now
              </button>
            </div>
          </div>
        </section>

        {/* Section 5: Keyboard Shortcuts Reference */}
        <section className="settings-card">
          <div className="settings-header">
            <div className="stat-icon-wrap stat-cyan">
              <Keyboard size={20} strokeWidth={2.2} />
            </div>
            <div>
              <h3>Keyboard Shortcuts</h3>
              <p>Pro hotkeys for rapid profile management</p>
            </div>
          </div>

          <div className="settings-list">
            {[
              { key: 'Ctrl + Enter', label: 'Launch Selected Profiles' },
              { key: 'Ctrl + A', label: 'Select All Profiles' },
              { key: 'Delete', label: 'Delete Selected Profiles' },
              { key: '/', label: 'Quick Focus Search' },
              { key: 'Escape', label: 'Clear Selection / Close Drawer' },
              { key: '?', label: 'Open Shortcuts Modal' },
            ].map((s) => (
              <div key={s.key} className="settings-row">
                <span className="settings-row-label">{s.label}</span>
                <kbd className="kbd">{s.key}</kbd>
              </div>
            ))}
          </div>
        </section>
        </div>
      </div>
    </>
  );
};
