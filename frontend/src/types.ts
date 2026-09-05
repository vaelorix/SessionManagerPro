export interface ProxyConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export interface FingerprintSpec {
  file: string;
  format?: string;
  userAgent: string;
  chromeVersion: string;
  platform: string;
  viewport: {
    width: number;
    height: number;
    deviceScaleFactor: number;
  };
  timezone: string;
  locale: string;
  languages?: string[];
  webgl: {
    vendor: string;
    renderer: string;
  };
  hardwareConcurrency: number;
  deviceMemory: number;
  maxTouchPoints?: number;
}

export interface SessionRecord {
  id: string;
  email: string;
  proxy?: ProxyConfig;
  fingerprintFile?: string;
  fingerprint?: FingerprintSpec;
  userDataDir: string;
  tabs: string[];
  cookieCount: number;
  notes?: string;
  tags?: string[];
  color?: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt?: string;
  status: 'ready' | 'live' | 'queued' | 'error' | 'completed';
  lastResult?: {
    status: string;
    reason: string;
    at: string;
  };
  liveInfo?: {
    id: string;
    startedAt: string;
    url: string;
  } | null;
}

export interface ProxyResource {
  key: string;
  host: string;
  port: number;
  username: string;
  isAssigned: boolean;
  assignedTo: string | null;
  url: string;
  latency?: number;
  testStatus?: 'untested' | 'testing' | 'success' | 'failed';
  testedIp?: string;
  testError?: string;
}

export interface FingerprintResource {
  file: string;
  shortId?: string;
  country?: string;
  browserName?: string;
  format: string;
  userAgent: string;
  chromeVersion: string;
  platform: string;
  viewport: string;
  webglVendor: string;
  webglRenderer: string;
  hardwareConcurrency: number;
  deviceMemory: number;
  lang: string;
  isAssigned: boolean;
  assignedTo: string | null;
  error?: string;
}

export interface LogEntry {
  id: number;
  timestamp: string;
  level: 'info' | 'success' | 'warn' | 'error';
  category: 'SESSION' | 'PROXY' | 'FINGERPRINT' | 'BROWSER' | 'QUEUE' | 'COOKIE';
  message: string;
  sessionId?: string | null;
}

export interface SystemStats {
  sessionsTotal: number;
  proxiesTotal: number;
  proxiesFree: number;
  fingerprintsTotal: number;
  fingerprintsFree: number;
  accountsTotal: number;
  totalCookies: number;
  activeThreads: number;
  threadLimit: number;
  queuedCount: number;
}

export interface PoolStatus {
  live: Array<{
    id: string;
    startedAt: string;
    url: string;
    proxy?: ProxyConfig;
    fingerprintFile?: string;
  }>;
  queued: string[];
  threadLimit: number;
  defaultUrl: string;
  activeCount: number;
  queuedCount: number;
  isFilling?: boolean;
}

export type AccentColor =
  | 'emerald'
  | 'blue'
  | 'purple'
  | 'orange'
  | 'cyan'
  | 'pink'
  | 'amber'
  | 'titanium';

export type CardRadius = 'curved' | 'compact' | 'pill';
export type GlassStyle = 'acrylic' | 'solid';

export interface AccentOption {
  id: AccentColor;
  label: string;
  sublabel: string;
  color: string;
  color2: string;
}

export const ACCENT_OPTIONS: AccentOption[] = [
  { id: 'emerald', label: 'Emerald Mint', sublabel: 'Stealth Default', color: '#10b981', color2: '#059669' },
  { id: 'blue', label: 'Sapphire Blue', sublabel: 'Apple Pro Blue', color: '#007aff', color2: '#0062cc' },
  { id: 'purple', label: 'Electric Violet', sublabel: 'Cyber Electric', color: '#8b5cf6', color2: '#7c3aed' },
  { id: 'orange', label: 'Sunset Coral', sublabel: 'Warm Vibrant', color: '#f97316', color2: '#ea580c' },
  { id: 'cyan', label: 'Neon Cyan', sublabel: 'Teal Matrix', color: '#06b6d4', color2: '#0891b2' },
  { id: 'pink', label: 'Rose Crimson', sublabel: 'Vibrant Fuchsia', color: '#ec4899', color2: '#db2777' },
  { id: 'amber', label: 'Golden Honey', sublabel: 'Warm Amber', color: '#f59e0b', color2: '#d97706' },
  { id: 'titanium', label: 'Titanium Slate', sublabel: 'Monochrome Tech', color: '#94a3b8', color2: '#64748b' },
];

export interface SessionBackup {
  sessionId: string;
  backupName: string;
  label?: string;
  createdAt: string;
  sizeBytes: number;
  fileCount: number;
  cookieCount: number;
  tabs?: string[];
}

export interface SystemReapResult {
  ok: boolean;
  summary: string;
  processesReaped: number;
  profilesCleaned: number;
  locksRemoved: number;
}

export interface ExtensionResource {
  id: string;
  name: string;
  version: string;
  description: string;
  icon: string;
  type: 'xpi' | 'crx' | 'zip' | 'directory';
  path: string;
  isGlobal: boolean;
  assignedProfiles: string[];
}

export interface LaunchOptions {
  threads?: number;
  url?: string;
  startUrls?: string[];
  webrtcPolicy?: 'default' | 'proxy_only' | 'disabled';
  ephemeral?: boolean;
  headless?: boolean;
  extraPrefs?: Record<string, any>;
}

