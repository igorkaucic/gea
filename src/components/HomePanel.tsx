import { useLayoutEffect, useRef } from 'react';

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

/* Reusable fake terminal chrome bar */
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

  useLayoutEffect(() => {
    const el = transcriptRef.current;
    if (!el) return;
    // Find the inner transcript div
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
