

interface Props {
  isActive: boolean;
  isMuted: boolean;
  UIState: string;
  toggleMute: () => void;
  stopAll: () => void;
}

export default function CallControls({ isActive, isMuted, UIState, toggleMute, stopAll }: Props) {
  if (!isActive) return null;

  const stateLabel = isMuted ? 'MUTED' : UIState === 'listening' ? 'LISTENING...' : UIState === 'speaking' ? 'SPEAKING...' : 'PROCESSING...';
  const stateColor = isMuted ? '#FFB300' : 'var(--phosphor)';

  return (
    <div className="call-controls">
      <button className={`call-btn call-btn-mute ${isMuted ? 'muted' : ''}`} onClick={toggleMute}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={stateColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ filter: `drop-shadow(0 0 4px ${stateColor})` }}>
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
          {isMuted && <line x1="1" y1="1" x2="23" y2="23" />}
        </svg>
        <span className="call-btn-label" style={{ color: stateColor, textShadow: `0 0 4px ${stateColor}44` }}>{stateLabel}</span>
      </button>

      <button className="call-btn call-btn-end" onClick={stopAll}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FF4C6A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0 4px rgba(255,76,106,0.6))' }}>
          <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" />
          <line x1="23" y1="1" x2="1" y2="23" />
        </svg>
        <span className="call-btn-label" style={{ color: '#FF4C6A', textShadow: '0 0 4px rgba(255,76,106,0.4)' }}>END</span>
      </button>
    </div>
  );
}
