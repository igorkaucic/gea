import { APP_VERSION } from '../version';

interface Props {
  apiKey: string;
  setApiKey: (k: string) => void;
  userInfo: { name: string; email: string; picture: string } | null;
  isSyncing: boolean;
  syncDrive: () => void;
  logoutDrive: () => void;
  copyLogs: () => void;
}

export default function SettingsPanel({ apiKey, setApiKey, userInfo, isSyncing, syncDrive, logoutDrive, copyLogs }: Props) {
  const saveKey = () => {
    localStorage.setItem('gemini_api_key', apiKey);
    window.dispatchEvent(new CustomEvent('SHOW_TOAST', { detail: '✅ API key saved.' }));
  };

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

          {userInfo ? (
            <div className="settings-sync-status" style={{ background: 'var(--phosphor-glow)', color: 'var(--phosphor)' }}>
              {isSyncing ? '🔄 Syncing...' : '✅ Auto-sync is active.'}
            </div>
          ) : (
            <button className="settings-btn settings-btn-google" onClick={syncDrive} disabled={isSyncing}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              {isSyncing ? 'Loading...' : 'Connect Google Account'}
            </button>
          )}
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
