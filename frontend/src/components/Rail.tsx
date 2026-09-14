import { AppWindow, Fingerprint, Globe, Moon, Palette, Puzzle, RefreshCw, Settings, Sun, Table2, Terminal } from 'lucide-react';
import { api } from '../api';
import type { AccentColor } from '../types';

export type Tab = 'sessions' | 'proxies' | 'fingerprints' | 'extensions' | 'settings';

const NAV: Array<{ id: Tab; label: string; Icon: typeof AppWindow }> = [
  { id: 'sessions', label: 'Profiles', Icon: AppWindow },
  { id: 'proxies', label: 'Proxies', Icon: Globe },
  { id: 'fingerprints', label: 'Fingerprints', Icon: Fingerprint },
  { id: 'extensions', label: 'Extensions', Icon: Puzzle },
  { id: 'settings', label: 'Settings', Icon: Settings },
];

export const Rail: React.FC<{
  tab: Tab;
  onTab: (t: Tab) => void;
  liveCount: number;
  onRefresh: () => void;
  onSync: () => void;
  isSyncing: boolean;
  proxiesCount?: number;
  fpCount?: number;
  extCount?: number;
  theme?: 'dark' | 'light';
  onToggleTheme?: () => void;
  accent?: AccentColor;
  onCycleAccent?: () => void;
}> = ({

  tab,
  onTab,
  liveCount,
  onRefresh,
  onSync,
  isSyncing,
  proxiesCount,
  fpCount,
  theme = 'dark',
  onToggleTheme,
  accent = 'emerald',
  onCycleAccent,
}) => {
  return (
    <nav className="rail" aria-label="Sections">
      <div className="rail-mark" aria-hidden="true" title="SessionManager Pro">
        SM
      </div>

      {NAV.map(({ id, label, Icon }) => (
        <button
          key={id}
          className="rail-btn"
          aria-current={tab === id ? 'page' : undefined}
          aria-label={id === 'sessions' && liveCount > 0 ? `${label}, ${liveCount} live` : label}
          data-tip={label}
          onClick={() => onTab(id)}
        >
          <Icon size={17} strokeWidth={1.75} />
          {id === 'sessions' && liveCount > 0 && <span className="rail-dot" aria-hidden="true" />}
        </button>
      ))}

      <span className="rail-spacer" />

      <button
        className="rail-btn"
        aria-label="Open Terminal Console"
        data-tip="Live Terminal Console"
        onClick={async () => {
          try {
            await api.openTerminal();
          } catch (e) {
            console.error('Failed to open terminal:', e);
          }
        }}
      >
        <Terminal size={17} strokeWidth={1.75} />
      </button>

      <button
        className="rail-btn"
        aria-label="Sync sheet"
        data-tip="Sync sheet"
        onClick={onSync}
        disabled={isSyncing}
      >
        <Table2 size={17} strokeWidth={1.75} className={isSyncing ? 'spin' : undefined} />
      </button>
      <button
        className="rail-btn theme-btn"
        aria-label={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        data-tip={theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
        onClick={onToggleTheme}
      >
        {theme === 'dark' ? <Sun size={17} strokeWidth={1.8} /> : <Moon size={17} strokeWidth={1.8} />}
      </button>

      {onCycleAccent && (
        <button
          className="rail-btn"
          aria-label={`Current accent: ${accent}. Click to cycle colors.`}
          data-tip={`Accent Color (${accent})`}
          onClick={onCycleAccent}
          style={{ position: 'relative' }}
        >
          <Palette size={17} strokeWidth={1.8} />
          <span className="rail-accent-dot" aria-hidden="true" />
        </button>
      )}

      <button className="rail-btn" aria-label="Reload data" data-tip="Reload data" onClick={onRefresh}>
        <RefreshCw size={17} strokeWidth={1.75} />
      </button>
    </nav>
  );
};

// [style] glowing tab pill
