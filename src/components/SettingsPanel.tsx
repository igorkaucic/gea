import { APP_VERSION } from '../version';
import { useEffect, useRef, useState } from 'react';

interface Props {
  apiKey: string;
  setApiKey: (k: string) => void;
  userInfo: { name: string; email: string; picture: string } | null;
  isSyncing: boolean;
  syncDrive: () => void;
  logoutDrive: () => void;
  copyLogs: () => void;
  scribeLensEnabled: boolean;
  setScribeLensEnabled: (v: boolean) => void;
}

export default function SettingsPanel({ apiKey, setApiKey, userInfo, isSyncing, syncDrive, logoutDrive, copyLogs, scribeLensEnabled, setScribeLensEnabled }: Props) {
  const saveKey = () => {
    localStorage.setItem('gemini_api_key', apiKey);
    window.dispatchEvent(new CustomEvent('SHOW_TOAST', { detail: '✅ API key saved.' }));
  };

  const [syncLog, setSyncLog] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const msg = (e as CustomEvent).detail as string;
      setSyncLog(prev => [...prev.slice(-49), msg]);
    };
    window.addEventListener('SYNC_PROGRESS', handler);
    return () => window.removeEventListener('SYNC_PROGRESS', handler);
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [syncLog]);

  const clearLog = () => setSyncLog([]);

  return (
    <>
      <h1 className="page-header">Settings</h1>
      <div className="settings-container">
        {/* API Key */}
        <div className="settings-section">
          <div className="settings-label">GEMINI API KEY</div>
          <input
            type="password"
            className="settings-input"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="Paste your API key..."
          />
          <button className="settings-btn settings-btn-save" onClick={saveKey}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px', verticalAlign: 'middle' }}>
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" />
            </svg>
            Save Key
          </button>
        </div>

        {/* Google Drive */}
        <div className="settings-section">
          <div className="settings-label">GOOGLE DRIVE SYNC</div>

          {userInfo && (
            <div className="settings-user-card">
              {userInfo.picture && <img src={userInfo.picture} alt="Profile" className="settings-user-avatar" />}
              <div style={{ flex: 1 }}>
                <div className="settings-user-name">{userInfo.name}</div>
                <div className="settings-user-email">{userInfo.email}</div>
              </div>
              <button className="settings-logout-btn" onClick={logoutDrive}>Log out</button>
            </div>
          )}

          {userInfo && (
            <div className="settings-sync-status" style={{ background: 'var(--phosphor-glow)', color: 'var(--phosphor)' }}>
              {isSyncing ? '🔄 Syncing...' : '✅ Auto-sync is active.'}
            </div>
          )}

          {syncLog.length > 0 && (
            <div style={{
              marginTop: '8px',
              background: 'rgba(0,0,0,0.35)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              padding: '8px 10px',
              maxHeight: '160px',
              overflowY: 'auto',
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              color: 'var(--text-muted)',
              lineHeight: '1.6',
            }} ref={logRef}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', opacity: 0.6 }}>
                <span>SYNC LOG</span>
                <span style={{ cursor: 'pointer' }} onClick={clearLog}>✕ clear</span>
              </div>
              {syncLog.map((line, i) => (
                <div key={i} style={{ color: line.toLowerCase().includes('complete') ? 'var(--phosphor)' : 'var(--text-muted)' }}>
                  › {line}
                </div>
              ))}
            </div>
          )}

          <button className="settings-btn settings-btn-google" onClick={() => { clearLog(); syncDrive(); }} disabled={isSyncing}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            {isSyncing ? 'Syncing...' : userInfo ? 'Sync Now' : 'Connect Google Account'}
          </button>
        </div>

        {/* Hue Bridge */}
        <div className="settings-section">
          <div className="settings-label">PHILIPS HUE BRIDGE</div>
          <button
            className="settings-btn settings-btn-secondary"
            onClick={() => window.open('https://192.168.178.20:5056', '_blank')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px', verticalAlign: 'middle' }}>
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            Trust Hue Bridge Certificate
          </button>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px', lineHeight: '1.4' }}>
            Opens the bridge URL in Safari. Tap "Advanced" → "Proceed" to trust the self-signed cert. Only needed once.
          </div>
        </div>

        {/* ScribeLens Integration */}
        <div className="settings-section">
          <div className="settings-label">SCRIBELENS INTEGRATION</div>
          <button
            className={`settings-btn ${scribeLensEnabled ? 'settings-btn-save' : 'settings-btn-secondary'}`}
            onClick={() => {
              const val = !scribeLensEnabled;
              setScribeLensEnabled(val);
              localStorage.setItem('gea_scribelens_enabled', val ? '1' : '0');
              window.dispatchEvent(new CustomEvent('SHOW_TOAST', { detail: val ? '✅ ScribeLens Enabled' : '❌ ScribeLens Disabled' }));
            }}
          >
            {scribeLensEnabled ? '🟢 Enabled (On Local Network)' : '🔴 Disabled'}
          </button>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px', lineHeight: '1.4' }}>
            When enabled, GEA can search your meeting transcripts. Only enable this when connected to your local office network.
          </div>
          
          <button
            className="settings-btn settings-btn-secondary"
            onClick={() => window.open('https://192.168.1.72:7777/api/global_status', '_blank')}
            style={{ marginTop: '12px' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px', verticalAlign: 'middle' }}>
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            Trust ScribeLens Certificate
          </button>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px', lineHeight: '1.4' }}>
            Opens the ScribeLens server. Tap "Advanced" → "Proceed" to trust the self-signed cert. Only needed once per device.
          </div>
        </div>

        {/* Logs */}
        <div className="settings-section">
          <div className="settings-label">DEBUG</div>
          <button className="settings-btn settings-btn-secondary" onClick={copyLogs}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px', verticalAlign: 'middle' }}>
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            Copy Session Log
          </button>
        </div>
        <div style={{ textAlign: 'center', marginTop: '20px', fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          GEA TERMINAL v{APP_VERSION}
        </div>
      </div>
    </>
  );
}
