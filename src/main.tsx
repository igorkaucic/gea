// ═══════════════════════════════════════════════════════════════
// POLYFILL: ReadableStream async iterator for iOS WKWebView
// iOS standalone PWA mode uses WKWebView which may lack
// ReadableStream[Symbol.asyncIterator], breaking `for await`
// streaming in the @google/genai SDK's generateContentStream.
// ═══════════════════════════════════════════════════════════════
if (typeof ReadableStream !== 'undefined' && !ReadableStream.prototype[Symbol.asyncIterator]) {
  (ReadableStream.prototype as any)[Symbol.asyncIterator] = async function* (this: ReadableStream) {
    const reader = this.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  };
}

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const isDebugMode = true;

declare global {
  interface Window {
    SESSION_LOGS: { time: number; msg: string }[];
  }
}
window.SESSION_LOGS = [];

function remoteLog(type: string, data: any) {
  if (!isDebugMode) return;
  const now = Date.now();
  const msg = `[${new Date(now).toISOString()}] [${type}] ${typeof data === 'object' ? JSON.stringify(data) : data}`;
  window.SESSION_LOGS.push({ time: now, msg });

  // Keep only logs from the last 30 minutes
  const cutoff = now - 30 * 60 * 1000;
  window.SESSION_LOGS = window.SESSION_LOGS.filter(log => log.time > cutoff);

  fetch('/api/log', { method: 'POST', body: JSON.stringify({ message: msg }) }).catch(() => {});
}

// Override console globally
const oldLog = console.log;
const oldError = console.error;
const oldWarn = console.warn;
console.log = (...args) => { oldLog(...args); remoteLog('INFO', args.join(' ')); };
console.error = (...args) => { oldError(...args); remoteLog('ERROR', args.join(' ')); };
console.warn = (...args) => { oldWarn(...args); remoteLog('WARN', args.join(' ')); };

// Global touch/click events
window.addEventListener('click', (e) => {
  let target = e.target as HTMLElement;
  const path = [];
  while(target && target.tagName && target.tagName !== 'HTML') {
    const cls = typeof target.className === 'string' ? target.className.split(' ')[0] : '';
    path.push(`${target.tagName.toLowerCase()}${target.id ? '#'+target.id : ''}${cls ? '.'+cls : ''}`);
    if(!target.parentElement) break;
    target = target.parentElement;
  }
  remoteLog('TOUCH', `Clicked on: ${path.slice(0, 3).join(' < ')}`);
}, true);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// ═══════════════════════════════════════════════════════════════
// SERVICE WORKER: Register + Auto-Update
// When a new SW is detected (version bump in sw.js), the page
// reloads automatically so the PWA always serves fresh code.
// ═══════════════════════════════════════════════════════════════
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then(reg => {
      console.log('[SW] Registered. Scope:', reg.scope);

      // Check for updates every 60 seconds
      setInterval(() => reg.update(), 60 * 1000);

      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        console.log('[SW] Update found — new worker installing...');

        newWorker.addEventListener('statechange', () => {
          // New SW is active and there was a previous one — reload
          if (newWorker.state === 'activated' && navigator.serviceWorker.controller) {
            console.log('[SW] New version activated — reloading...');
            window.location.reload();
          }
        });
      });
    }).catch(err => {
      console.error('[SW] Registration failed:', err);
    });

    // Also reload if the controlling SW changes (covers skipWaiting)
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      console.log('[SW] Controller changed — reloading...');
      window.location.reload();
    });
  });
}
