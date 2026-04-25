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
