import { useState, useRef } from 'react';

interface Props {
  images: any[];
}

export default function GalleryPanel({ images }: Props) {
  const [fullImage, setFullImage] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const stateRef = useRef({ scale: 1, x: 0, y: 0, lastDist: 0, startX: 0, startY: 0, dragging: false, pinching: false });

  const applyTransform = () => {
    if (imgRef.current) {
      const s = stateRef.current;
      imgRef.current.style.transform = `translate(${s.x}px, ${s.y}px) scale(${s.scale})`;
    }
  };

  const onTouchStart = (e: React.TouchEvent) => {
    const s = stateRef.current;
    if (e.touches.length === 2) {
      s.pinching = true; s.dragging = false;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      s.lastDist = Math.sqrt(dx * dx + dy * dy);
    } else if (e.touches.length === 1) {
      s.dragging = true;
      if (s.scale > 1) {
        // Pan mode
        s.startX = e.touches[0].clientX - s.x;
        s.startY = e.touches[0].clientY - s.y;
      } else {
        // Swipe to close mode
        s.startY = e.touches[0].clientY;
        s.x = 0; s.y = 0;
      }
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (e.cancelable) e.preventDefault();
    const s = stateRef.current;
    if (s.pinching && e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (s.lastDist > 0) { 
        s.scale = Math.max(0.5, Math.min(5, s.scale * (dist / s.lastDist))); 
        applyTransform(); 
      }
      s.lastDist = dist;
    } else if (s.dragging && e.touches.length === 1) {
      if (s.scale > 1) {
        // Panning
        s.x = e.touches[0].clientX - s.startX!;
        s.y = e.touches[0].clientY - s.startY;
        applyTransform();
      } else {
        // Swipe to close
        const deltaY = e.touches[0].clientY - s.startY;
        s.y = deltaY;
        if (imgRef.current) imgRef.current.style.opacity = String(Math.max(0.2, 1 - Math.abs(deltaY) / 400));
        applyTransform();
      }
    }
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const s = stateRef.current;
    if (s.pinching && e.touches.length < 2) {
      s.pinching = false; s.lastDist = 0;
      if (s.scale < 1) { s.scale = 1; s.x = 0; s.y = 0; applyTransform(); }
    }
    if (s.dragging) {
      s.dragging = false;
      if (s.scale <= 1) {
        if (Math.abs(s.y) > 120) { 
          setFullImage(null); 
          stateRef.current = { scale: 1, x: 0, y: 0, lastDist: 0, startX: 0, startY: 0, dragging: false, pinching: false }; 
        } else { 
          s.y = 0; 
          if (imgRef.current) imgRef.current.style.opacity = '1'; 
          applyTransform(); 
        }
      }
    }
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!fullImage) return;
    const a = document.createElement('a');
    a.href = fullImage;
    a.download = `gea_vision_${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <>
      <h1 className="page-header">Gallery</h1>
      {images.length === 0 ? (
        <div className="gallery-empty">
          <div className="gallery-empty-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
            </svg>
          </div>
          <div>No images generated yet.</div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Talk to Gea to create visual concepts.</div>
        </div>
      ) : (
        <div className="gallery-grid">
          {images.map((img: any) => (
            <div key={img.id} className="gallery-item" onClick={() => { stateRef.current = { scale: 1, x: 0, y: 0, lastDist: 0, startX: 0, startY: 0, dragging: false, pinching: false }; setFullImage(img.full_b64); }}>
              <img src={img.thumbnail_b64 || img.full_b64} alt={img.prompt || 'Generated'} loading="lazy" />
            </div>
          ))}
        </div>
      )}

      {fullImage && (
        <div className="lightbox" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
          <img ref={imgRef} src={fullImage} alt="Full view" draggable={false} />
          <button className="lightbox-close" onClick={() => setFullImage(null)}>×</button>
          <button className="lightbox-download" onClick={handleDownload}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
          <div className="lightbox-hint">DRAG ↕ TO CLOSE · PINCH TO ZOOM</div>
        </div>
      )}
    </>
  );
}
