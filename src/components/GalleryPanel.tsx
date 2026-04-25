import { useState, useRef } from 'react';

interface Props {
  images: any[];
}

export default function GalleryPanel({ images }: Props) {
  const [fullImage, setFullImage] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const stateRef = useRef({ scale: 1, x: 0, y: 0, lastDist: 0, startY: 0, dragging: false, pinching: false });

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
    } else if (e.touches.length === 1 && s.scale <= 1) {
      s.dragging = true; s.startY = e.touches[0].clientY; s.x = 0; s.y = 0;
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (e.cancelable) e.preventDefault();
    const s = stateRef.current;
    if (s.pinching && e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (s.lastDist > 0) { s.scale = Math.max(0.5, Math.min(5, s.scale * (dist / s.lastDist))); applyTransform(); }
      s.lastDist = dist;
    } else if (s.dragging && e.touches.length === 1) {
      const deltaY = e.touches[0].clientY - s.startY;
      s.y = deltaY;
      if (imgRef.current) imgRef.current.style.opacity = String(Math.max(0.2, 1 - Math.abs(deltaY) / 400));
      applyTransform();
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
      if (Math.abs(s.y) > 120) { setFullImage(null); stateRef.current = { scale: 1, x: 0, y: 0, lastDist: 0, startY: 0, dragging: false, pinching: false }; }
      else { s.y = 0; if (imgRef.current) imgRef.current.style.opacity = '1'; applyTransform(); }
    }
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
            <div key={img.id} className="gallery-item" onClick={() => { stateRef.current = { scale: 1, x: 0, y: 0, lastDist: 0, startY: 0, dragging: false, pinching: false }; setFullImage(img.full_b64); }}>
              <img src={img.thumbnail_b64} alt={img.prompt || 'Generated'} loading="lazy" />
            </div>
          ))}
        </div>
      )}

      {fullImage && (
        <div className="lightbox" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
          <img ref={imgRef} src={fullImage} alt="Full view" draggable={false} />
          <button className="lightbox-close" onClick={() => setFullImage(null)}>×</button>
          <div className="lightbox-hint">DRAG ↕ TO CLOSE · PINCH TO ZOOM</div>
        </div>
      )}
    </>
  );
}
