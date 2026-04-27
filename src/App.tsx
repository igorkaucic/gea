import { useState, useEffect, useRef } from 'react';
import { useGeminiLive } from './hooks/useGeminiLive';
import { useGoogleDrive } from './hooks/useGoogleDrive';
import { useVisionAgent } from './hooks/useVisionAgent';
import { initDB, dbGetAll } from './db/db';
import CallControls from './components/CallControls';
import HomePanel from './components/HomePanel';
import GalleryPanel from './components/GalleryPanel';
import NotesPanel from './components/NotesPanel';
import CalendarPanel from './components/CalendarPanel';
import SettingsPanel from './components/SettingsPanel';
import './index.css';

function App() {
  const [toast, setToast] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState(localStorage.getItem('gemini_api_key') || '');
  const [activePage, setActivePage] = useState('home');
  const [notes, setNotes] = useState<any[]>([]);
  const [images, setImages] = useState<any[]>([]);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [calendarPrompt, setCalendarPrompt] = useState<any>(null);
  const [navigationPrompt, setNavigationPrompt] = useState<any>(null);

  const { isActive, isMuted, UIState, statusText, thoughts, connect, stopAll, toggleMute, sendTextMessage } = useGeminiLive(apiKey, 'Leda');
  const { syncDrive, trySilentSync, isSyncing, userInfo, logoutDrive } = useGoogleDrive();
  const { isGenerating, visionThoughts, jobs, generateImage } = useVisionAgent(apiKey);

  const aiHasSpoken = useRef(false);

  const loadData = async () => {
    try {
      const n = await dbGetAll('notes');
      n.sort((a: any, b: any) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
      setNotes(n);
      const img = await dbGetAll('images');
      img.sort((a: any, b: any) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
      setImages(img);
    } catch (e: any) {
      if (e !== 'DB not initialized' && e?.message !== 'DB not initialized') console.error(e);
    }
  };

  useEffect(() => {
    initDB().then(loadData).catch(console.error);

    // If we just returned from Google OAuth redirect, trigger sync automatically
    if (localStorage.getItem('gdrive_just_authed') === '1') {
      localStorage.removeItem('gdrive_just_authed');
      console.log('[DRIVE] Returned from OAuth redirect — auto-syncing...');
      // Small delay to let React mount fully
      setTimeout(() => syncDrive(), 500);
    }
    const handleToast = (e: any) => { setToast(e.detail); setTimeout(() => setToast(null), 4000); };

    // Debounced sync on data changes (manual deletes, etc.)
    let syncDebounce: any = null;
    const handleDataChanged = () => {
      loadData();
      // Auto-sync after manual changes — debounce 3s, skip if mid-call
      if (syncDebounce) clearTimeout(syncDebounce);
      syncDebounce = setTimeout(() => {
        if (!isActive && !isGenerating) {
          trySilentSync();
        }
      }, 3000);
    };

    window.addEventListener('SHOW_TOAST', handleToast);
    window.addEventListener('DATA_CHANGED', handleDataChanged);
    
    const handleGenerateImage = (e: any) => { generateImage(e.detail.prompt, e.detail.filename); };
    window.addEventListener('GENERATE_IMAGE', handleGenerateImage);

    const handleCalPrompt = (e: any) => {
      setCalendarPrompt(e.detail);
    };
    window.addEventListener('SHOW_CALENDAR_PROMPT', handleCalPrompt);

    const handleNavPrompt = (e: any) => {
      setNavigationPrompt(e.detail);
    };
    window.addEventListener('SHOW_NAVIGATION_PROMPT', handleNavPrompt);

    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    const handleOpenLightbox = () => setActivePage('gallery');
    window.addEventListener('OPEN_LIGHTBOX', handleOpenLightbox);

    return () => { 
      window.removeEventListener('SHOW_TOAST', handleToast); 
      window.removeEventListener('DATA_CHANGED', handleDataChanged); 
      window.removeEventListener('GENERATE_IMAGE', handleGenerateImage); 
      window.removeEventListener('OPEN_LIGHTBOX', handleOpenLightbox);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('SHOW_CALENDAR_PROMPT', handleCalPrompt);
      window.removeEventListener('SHOW_NAVIGATION_PROMPT', handleNavPrompt);
      if (syncDebounce) clearTimeout(syncDebounce);
    };
  }, [isActive, isGenerating]);

  const installApp = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') setDeferredPrompt(null);
  };

  // Auto-sync after AI conversation ends (waits for image gen to finish)
  useEffect(() => {
    if (isActive) { aiHasSpoken.current = true; return; }
    if (!aiHasSpoken.current || !apiKey) return;

    // If vision agent is still generating, poll until it's done
    const trySync = () => {
      if (isGenerating) {
        setTimeout(trySync, 2000);
        return;
      }
      aiHasSpoken.current = false;
      loadData().then(() => {
        window.dispatchEvent(new CustomEvent('SHOW_TOAST', { detail: '🔄 Auto-sync started...' }));
        trySilentSync();
      });
    };
    trySync();
  }, [isActive]);

  const copyLogs = async () => {
    try {
      const logs = (window as any).SESSION_LOGS || [];
      const text = logs.length ? logs.map((l: any) => l.msg).join('\n') : 'No logs found.';
      await navigator.clipboard.writeText(text);
      window.dispatchEvent(new CustomEvent('SHOW_TOAST', { detail: '✅ Logs copied to clipboard!' }));
    } catch (e) {
      window.dispatchEvent(new CustomEvent('SHOW_TOAST', { detail: '❌ Copy error: ' + e }));
    }
  };

  const handleNavigateToNotes = (_month: Date, _day: number) => {
    setActivePage('notes');
  };

  return (
    <div id="app">
      {/* Persistent Call Controls — renders over ALL tabs */}
      <CallControls isActive={isActive} isMuted={isMuted} UIState={UIState} toggleMute={toggleMute} stopAll={stopAll} />

      {/* Toast */}
      {toast && <div className="toast">{toast}</div>}

      {deferredPrompt && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, background: 'var(--cyan)', color: '#000', padding: '12px', zIndex: 9999, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 'bold', fontSize: '14px' }}>Install GEA Terminal</span>
          <div>
            <button onClick={installApp} style={{ background: '#000', color: 'var(--cyan)', border: 'none', padding: '6px 12px', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer', marginRight: '8px' }}>Install</button>
            <button onClick={() => setDeferredPrompt(null)} style={{ background: 'transparent', color: '#000', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>✕</button>
          </div>
        </div>
      )}

      {calendarPrompt && (
        <div style={{
          position: 'fixed', bottom: '80px', left: '20px', right: '20px',
          background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(12px)',
          border: '1.5px solid rgba(255,179,0,0.3)', color: '#FFB300', 
          padding: '16px', borderRadius: '16px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          boxShadow: '0 4px 24px rgba(255,179,0,0.2)', zIndex: 9999,
          animation: 'fadeUp 0.3s ease-out forwards'
        }}>
          <span style={{fontWeight: '800', fontSize: '14px', flex: 1, marginRight: '10px', textShadow: '0 0 4px rgba(255,179,0,0.4)', letterSpacing: '0.5px'}}>📅 {calendarPrompt.title.toUpperCase()}</span>
          <button onClick={() => {
             const blob = new Blob([calendarPrompt.icsContent], { type: 'text/calendar;charset=utf-8' });
             const url = URL.createObjectURL(blob);
             const a = document.createElement('a');
             a.href = url;
             a.download = 'podsjetnik.ics';
             document.body.appendChild(a);
             a.click();
             document.body.removeChild(a);
             setTimeout(() => URL.revokeObjectURL(url), 1000);
             setCalendarPrompt(null);
          }} style={{
            background: 'rgba(255,179,0,0.15)', color: '#FFB300', border: '1.5px solid rgba(255,179,0,0.5)', borderRadius: '8px', 
            padding: '10px 18px', fontWeight: '800', fontSize: '12px', cursor: 'pointer', textShadow: '0 0 4px rgba(255,179,0,0.4)'
          }}>ADD TO CALENDAR</button>
          <button onClick={() => setCalendarPrompt(null)} style={{background: 'transparent', border: 'none', color: '#FFB300', marginLeft: '10px', fontSize: '18px', textShadow: '0 0 4px rgba(255,179,0,0.4)'}}>✕</button>
        </div>
      )}

      {navigationPrompt && (
        <div style={{
          position: 'fixed', bottom: '80px', left: '20px', right: '20px',
          background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(12px)',
          border: '1.5px solid rgba(0,255,136,0.3)', color: 'var(--success)', 
          padding: '16px', borderRadius: '16px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          boxShadow: '0 4px 24px rgba(0,255,136,0.2)', zIndex: 9999,
          animation: 'fadeUp 0.3s ease-out forwards'
        }}>
          <span style={{fontWeight: '800', fontSize: '14px', flex: 1, marginRight: '10px', textShadow: '0 0 4px rgba(0,255,136,0.4)', letterSpacing: '0.5px'}}>📍 {navigationPrompt.odrediste.toUpperCase()}</span>
          <button onClick={() => {
             const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(navigationPrompt.odrediste)}`;
             window.open(url, '_blank');
             setNavigationPrompt(null);
          }} style={{
            background: 'rgba(0,255,136,0.15)', color: 'var(--success)', border: '1.5px solid rgba(0,255,136,0.5)', borderRadius: '8px', 
            padding: '10px 18px', fontWeight: '800', fontSize: '12px', cursor: 'pointer', textShadow: '0 0 4px rgba(0,255,136,0.4)'
          }}>NAVIGATE</button>
          <button onClick={() => setNavigationPrompt(null)} style={{background: 'transparent', border: 'none', color: 'var(--success)', marginLeft: '10px', fontSize: '18px', textShadow: '0 0 4px rgba(0,255,136,0.4)'}}>✕</button>
        </div>
      )}

      {/* Pages */}
      <div className="pages">
        <div className={`page page-no-scroll ${activePage === 'home' ? 'active' : ''}`}>
          <HomePanel isActive={isActive} thoughts={thoughts} statusText={statusText} UIState={UIState} visionThoughts={visionThoughts} isGenerating={isGenerating} jobs={jobs} connect={connect} stopAll={stopAll} sendTextMessage={sendTextMessage} />
        </div>
        <div className={`page ${activePage === 'gallery' ? 'active' : ''}`}>
          <GalleryPanel images={images} loadData={loadData} />
        </div>
        <div className={`page ${activePage === 'notes' ? 'active' : ''}`}>
          <NotesPanel notes={notes} loadData={loadData} trySilentSync={trySilentSync} isActive={isActive} />
        </div>
        <div className={`page ${activePage === 'calendar' ? 'active' : ''}`}>
          <CalendarPanel notes={notes} images={images} onNavigateToNotes={handleNavigateToNotes} onNavigateToGallery={() => setActivePage('gallery')} />
        </div>
        <div className={`page ${activePage === 'settings' ? 'active' : ''}`}>
          <SettingsPanel apiKey={apiKey} setApiKey={setApiKey} userInfo={userInfo} isSyncing={isSyncing} syncDrive={syncDrive} logoutDrive={logoutDrive} copyLogs={copyLogs} />
        </div>
      </div>

      {/* Bottom Navigation */}
      <nav className="bottom-nav">
        <button className={`nav-btn ${activePage === 'home' ? 'active' : ''}`} onClick={() => setActivePage('home')}>
          <span className="nav-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg></span>
          Terminal
        </button>
        <button className={`nav-btn ${activePage === 'gallery' ? 'active' : ''}`} onClick={() => setActivePage('gallery')}>
          <span className="nav-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg></span>
          Gallery
        </button>
        <button className={`nav-btn ${activePage === 'notes' ? 'active' : ''}`} onClick={() => setActivePage('notes')}>
          <span className="nav-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14,2 14,8 20,8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg></span>
          Notes
        </button>
        <button className={`nav-btn ${activePage === 'calendar' ? 'active' : ''}`} onClick={() => setActivePage('calendar')}>
          <span className="nav-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg></span>
          Calendar
        </button>
        <button className={`nav-btn ${activePage === 'settings' ? 'active' : ''}`} onClick={() => setActivePage('settings')}>
          <span className="nav-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg></span>
          Settings
        </button>
      </nav>
    </div>
  );
}

export default App;
