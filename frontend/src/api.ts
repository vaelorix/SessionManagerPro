import type {
  SessionRecord,
  SystemStats,
  ProxyResource,
  FingerprintResource,
  LogEntry,
  PoolStatus,
  SessionBackup,
  SystemReapResult,
  ExtensionResource,
  LaunchOptions,
} from './types';

const BASE = '';

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(BASE + url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = `HTTP error ${res.status}`;
    try {
      const parsed = JSON.parse(text);
      if (parsed.error) msg = parsed.error;
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export const api = {
  getStats: () => fetchJson<SystemStats>('/api/stats'),
  getSessions: () => fetchJson<SessionRecord[]>('/api/sessions'),
  createSession: (data: { name: string; proxy?: any; fingerprintFile?: string }) =>
    fetchJson<SessionRecord>('/api/sessions/create', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  autoGenerateSessions: (count: number, prefix: string) =>
    fetchJson<{ created: SessionRecord[]; existing: SessionRecord[] }>('/api/sessions/auto', {
      method: 'POST',
      body: JSON.stringify({ count, prefix }),
    }),
  launchSessions: (
    ids: string[],
    threadsOrOptions?: number | LaunchOptions,
    url?: string
  ) => {
    let payload: any = { ids };
    if (typeof threadsOrOptions === 'number') {
      payload.threads = threadsOrOptions;
      if (url) payload.url = url;
    } else if (threadsOrOptions && typeof threadsOrOptions === 'object') {
      payload = { ...payload, ...threadsOrOptions };
      if (url && !payload.url) payload.url = url;
    }
    return fetchJson<{ ok: boolean; count: number }>('/api/sessions/launch', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  stopSession: (id: string) =>
    fetchJson<{ ok: boolean; id: string }>('/api/sessions/stop', {
      method: 'POST',
      body: JSON.stringify({ id }),
    }),
  stopAllSessions: () =>
    fetchJson<{ ok: boolean; stopped: string }>('/api/sessions/stop', {
      method: 'POST',
      body: JSON.stringify({ all: true }),
    }),
  deleteSession: (id: string) =>
    fetchJson<{ ok: boolean; id: string }>(`/api/sessions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  patchSession: (id: string, patch: any) =>
    fetchJson<SessionRecord>(`/api/sessions/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  getResources: () =>
    fetchJson<{
      proxies: ProxyResource[];
      fingerprints: FingerprintResource[];
      accounts: string[];
    }>('/api/resources'),
  testProxy: (proxy: any) =>
    fetchJson<{ ok: boolean; latency?: number; ip?: string; error?: string }>('/api/proxies/test', {
      method: 'POST',
      body: JSON.stringify(proxy),
    }),
  importAccounts: (csvContent: string) =>
    fetchJson<{ ok: boolean; count: number; accounts: string[] }>('/api/accounts/import', {
      method: 'POST',
      body: JSON.stringify({ csvContent }),
    }),
  syncSheet: () => fetchJson<{ updated: number; created: number }>('/api/sheet/sync', { method: 'POST' }),
  getLogs: (limit = 100) => fetchJson<LogEntry[]>(`/api/logs?limit=${limit}`),
  getPool: () => fetchJson<PoolStatus>('/api/pool'),
  setThreadLimit: (threads: number) =>
    fetchJson<PoolStatus>('/api/pool', {
      method: 'POST',
      body: JSON.stringify({ threads }),
    }),
  openTerminal: () =>
    fetchJson<{ ok: boolean }>('/api/terminal/open', {
      method: 'POST',
    }),
  reapSystem: () =>
    fetchJson<SystemReapResult>('/api/system/reap', {
      method: 'POST',
    }),
  getSessionBackups: (id: string) =>
    fetchJson<SessionBackup[]>(`/api/sessions/${encodeURIComponent(id)}/backups`),
  createSessionBackup: (id: string, label = 'manual') =>
    fetchJson<{ ok: boolean; manifest: SessionBackup }>(`/api/sessions/${encodeURIComponent(id)}/backup`, {
      method: 'POST',
      body: JSON.stringify({ label }),
    }),
  restoreSessionBackup: (id: string, backupName?: string) =>
    fetchJson<{ ok: boolean; sessionId: string; restoredBackup: string; restoredCount: number }>(
      `/api/sessions/${encodeURIComponent(id)}/restore`,
      {
        method: 'POST',
        body: JSON.stringify({ backupName }),
      }
    ),
  deleteSessionBackup: (id: string, backupName: string) =>
    fetchJson<{ ok: boolean; deleted: string }>(
      `/api/sessions/${encodeURIComponent(id)}/backups/${encodeURIComponent(backupName)}`,
      {
        method: 'DELETE',
      }
    ),
  getExtensions: () => fetchJson<ExtensionResource[]>('/api/extensions'),
  uploadExtension: (filename: string, base64: string) =>
    fetchJson<{ ok: boolean; extension: ExtensionResource }>('/api/extensions/upload', {
      method: 'POST',
      body: JSON.stringify({ filename, base64 }),
    }),
  toggleExtensionGlobal: (id: string, isGlobal: boolean) =>
    fetchJson<{ ok: boolean; id: string; isGlobal: boolean }>(`/api/extensions/${encodeURIComponent(id)}/toggle`, {
      method: 'POST',
      body: JSON.stringify({ isGlobal }),
    }),
  assignExtensionToProfiles: (id: string, profileIds: string[]) =>
    fetchJson<{ ok: boolean; id: string; assignedProfiles: string[] }>(`/api/extensions/${encodeURIComponent(id)}/assign`, {
      method: 'POST',
      body: JSON.stringify({ profileIds }),
    }),
  deleteExtension: (id: string) =>
    fetchJson<{ ok: boolean; id: string }>(`/api/extensions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
};

