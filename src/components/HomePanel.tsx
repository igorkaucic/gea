import { useLayoutEffect, useRef, useState } from 'react';

interface VisionJob {
  id: number;
  prompt: string;
  status: 'running' | 'done' | 'error';
  text: string;
}

interface Props {
  isActive: boolean;
  thoughts: string;
  statusText: string;
  UIState: string;
  visionThoughts: string;
  isGenerating: boolean;
  jobs: VisionJob[];
  connect: (e?: any) => void;
  stopAll: () => void;
  sendTextMessage?: (text: string) => void;
}

const ASCII_LOGO = ` ██████╗ ███████╗ █████╗ 
██╔════╝ ██╔════╝██╔══██╗
██║  ███╗█████╗  ███████║
██║   ██║██╔══╝  ██╔══██║
╚██████╔╝███████╗██║  ██║
 ╚═════╝ ╚══════╝╚═╝  ╚═╝`;

function TerminalChrome({ title, color, isLive, onPasteAction }: { title: string; color: string; isLive?: boolean, onPasteAction?: () => void }) {
  return (
    <div className="term-chrome">
      <div className="term-dots">
        <span className="term-dot" style={{ background: '#FF5F57' }} />
        <span className="term-dot" style={{ background: '#FEBC2E' }} />
        <span className="term-dot" style={{ background: '#28C840' }} />
      </div>
      <span className="term-title" style={{ color }}>{title}</span>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
        {onPasteAction && (
          <button
            onClick={onPasteAction}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '0 4px', fontSize: '14px', opacity: 0.8, color: 'var(--text)' }}
            title="Paste text to Gea"
          >
            📋
          </button>
        )}
        {isLive && <span className="term-live-badge">● LIVE</span>}
      </div>
    </div>
  );
}

export default function HomePanel({ isActive, thoughts, statusText, UIState, visionThoughts, isGenerating, jobs, connect, stopAll, sendTextMessage }: Props) {
  const transcriptRef = useRef<HTMLDivElement>(null);
  const visionRef = useRef<HTMLDivElement>(null);
  const [typeInput, setTypeInput] = useState('');

  useLayoutEffect(() => {
    const el = transcriptRef.current;
    if (!el) return;
    const transcript = el.querySelector('.ai-transcript');
    if (transcript) {
      transcript.innerHTML = thoughts || '<span style="opacity:0.3">$ awaiting connection...</span>';
    }
    el.scrollTop = el.scrollHeight;
    requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight; });
  }, [thoughts, isActive]);

  useLayoutEffect(() => {
    const el = visionRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight; });
    }
  }, [visionThoughts]);

  const handleSendTyped = () => {
    const text = typeInput.trim();
    if (!text || !sendTextMessage) return;
    sendTextMessage(text);
    setTypeInput('');
    window.dispatchEvent(new CustomEvent('SHOW_TOAST', { detail: '✉️ Sent to Gea' }));
  };

  const runningCount = jobs.filter(j => j.status === 'running').length;

  return (
    <div className="terminal-container">
      <pre className="ascii-header">{ASCII_LOGO}</pre>

      {/* ═══ GEA CORE TERMINAL ═══ */}
      <div className="term-window">
        <TerminalChrome
          title="gea@core:~"
          color="var(--phosphor)"
          isLive={isActive && UIState !== 'ready'}
          onPasteAction={isActive && sendTextMessage ? async () => {
            try {
              const text = await navigator.clipboard.readText();
              if (text) sendTextMessage(text);
              window.dispatchEvent(new CustomEvent('SHOW_TOAST', { detail: '📋 Tekst zalijepljen i poslan Gei!' }));
            } catch(e) {
              window.dispatchEvent(new CustomEvent('SHOW_TOAST', { detail: '❌ Clipboard access denied' }));
            }
          } : undefined}
        />
        <div ref={transcriptRef} className="term-body">
          <div className="ai-transcript" />
          {isActive && (
            <div className="term-status-line">
              <span style={{ color: UIState === 'listening' ? 'var(--phosphor)' : UIState === 'speaking' ? '#60a5fa' : 'var(--text-muted)' }}>
                {UIState === 'listening' ? '█ LISTENING' : UIState === 'speaking' ? '█ AUDIO OUT' : '█ PROCESSING'}
              </span>
              <span style={{ color: 'var(--text-muted)' }}>{statusText}</span>
            </div>
          )}
        </div>
      </div>

      {/* ═══ VISION AGENT TERMINAL ═══ */}
      <div className="term-window term-vision">
        <TerminalChrome
          title={`vision@agent:~ ${runningCount > 0 ? `[${runningCount} job${runningCount > 1 ? 's' : ''}]` : ''}`}
          color="var(--amber)"
          isLive={isGenerating}
        />
        <div ref={visionRef} className="term-body term-body-vision">
          <div className="vision-transcript"
            dangerouslySetInnerHTML={{
              __html: visionThoughts || '<span style="opacity:0.3">$ standby — waiting for image dispatch...</span>'
            }}
          />
        </div>
      </div>

      {/* ═══ TYPE TO GEA ═══ */}
      {isActive && sendTextMessage && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
          <input
            value={typeInput}
            onChange={e => setTypeInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendTyped(); } }}
            placeholder="Type to Gea..."
            style={{
              flex: 1,
              background: 'var(--bg-surface)',
              border: '1px solid var(--phosphor-dim)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--phosphor)',
              fontFamily: 'var(--font-mono)',
              fontSize: '13px',
              padding: '10px 14px',
              outline: 'none',
              caretColor: 'var(--phosphor)',
            }}
          />
          <button
            onClick={handleSendTyped}
            disabled={!typeInput.trim()}
            style={{
              background: typeInput.trim() ? 'var(--phosphor-glow)' : 'transparent',
              border: '1px solid var(--phosphor-dim)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--phosphor)',
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
              fontWeight: 800,
              padding: '10px 16px',
              cursor: typeInput.trim() ? 'pointer' : 'default',
              opacity: typeInput.trim() ? 1 : 0.4,
              letterSpacing: '0.5px',
              transition: 'all 0.15s ease',
            }}
          >SEND</button>
        </div>
      )}

      {/* ═══ CONNECT BUTTON ═══ */}
      <button
        className={`connect-btn ${isActive ? 'active' : ''}`}
        onClick={isActive ? stopAll : connect}
        id="btn-connect"
      >
        {isActive ? '● LIVE SESSION ACTIVE' : '▶ START SESSION'}
      </button>
    </div>
  );
}
