import React from 'react';
import { Cookie, Fingerprint, Globe, Layers, Play, Wifi } from 'lucide-react';

interface Props {
  totalProfiles: number;
  activeCount: number;
  queuedCount: number;
  totalCookies: number;
  proxiesFree: number;
  proxiesTotal: number;
  fpFree: number;
  fpTotal: number;
}

export const StatusBar: React.FC<Props> = ({
  totalProfiles,
  activeCount,
  queuedCount,
  totalCookies,
  proxiesFree,
  proxiesTotal,
  fpFree,
  fpTotal,
}) => (
  <div className="stats-bar" role="status" aria-label="Dashboard statistics">
    <div className="stat-card stat-blue">
      <div className="stat-icon-wrap">
        <Layers size={18} strokeWidth={2.2} />
      </div>
      <div className="stat-content">
        <span className="stat-val">{totalProfiles}</span>
        <span className="stat-label">Profiles</span>
      </div>
    </div>

    <div className={`stat-card stat-green${activeCount > 0 ? ' live' : ''}`}>
      <div className="stat-icon-wrap">
        <Play size={18} strokeWidth={2.2} />
      </div>
      <div className="stat-content">
        <span className="stat-val">{activeCount}</span>
        <span className="stat-label">Active</span>
      </div>
    </div>

    {queuedCount > 0 && (
      <div className="stat-card stat-orange">
        <div className="stat-icon-wrap">
          <Wifi size={18} strokeWidth={2.2} />
        </div>
        <div className="stat-content">
          <span className="stat-val">{queuedCount}</span>
          <span className="stat-label">Queued</span>
        </div>
      </div>
    )}

    <div className="stat-card stat-purple">
      <div className="stat-icon-wrap">
        <Cookie size={18} strokeWidth={2.2} />
      </div>
      <div className="stat-content">
        <span className="stat-val">{totalCookies.toLocaleString()}</span>
        <span className="stat-label">Cookies</span>
      </div>
    </div>

    <div className="stat-card stat-cyan">
      <div className="stat-icon-wrap">
        <Globe size={18} strokeWidth={2.2} />
      </div>
      <div className="stat-content">
        <span className="stat-val">{proxiesFree}/{proxiesTotal}</span>
        <span className="stat-label">Proxies Free</span>
      </div>
    </div>

    <div className="stat-card stat-pink">
      <div className="stat-icon-wrap">
        <Fingerprint size={18} strokeWidth={2.2} />
      </div>
      <div className="stat-content">
        <span className="stat-val">{fpFree}/{fpTotal}</span>
        <span className="stat-label">Prints Free</span>
      </div>
    </div>
  </div>
);
