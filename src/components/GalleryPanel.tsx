import { useState, useRef, useCallback, useEffect } from 'react';
import { dbDelete } from '../db/db';

interface Props {
  images: any[];
  loadData: () => Promise<void>;
}

interface TouchState {
  scale: number; x: number; y: number;
  pinching: boolean; lastDist: number; lastMidX: number; lastMidY: number;
  dragging: boolean; startX: number; startY: number;
}

const freshState = (): TouchState => ({
  scale: 1, x: 0, y: 0,
  pinching: false, lastDist: 0, lastMidX: 0, lastMidY: 0,
  dragging: false, startX: 0, startY: 0,
});

export default function GalleryPanel({ images, loadData }: Props) {
  const [fullIndex, setFullIndex] = useState<number | null>(null);
  const [lightboxDeleteArmed, setLightboxDeleteArmed] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isSelecting, setIsSelecting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const longPressTimer = useRef<any>(null);
  const longPressTriggered = useRef(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const stateRef = useRef<TouchState>(freshState());
  const lastTapTime = useRef<number>(0);

  const fullImage = fullIndex !== null ? images[fullIndex] : null;

  const applyTransform = (animated = false) => {
    if (!imgRef.current) return;
    const s = stateRef.current;
    imgRef.current.style.transition = animated ? 'transform 0.25s ease, opacity 0.2s ease' : 'none';
    imgRef.current.style.transform = `translate(${s.x}px, ${s.y}px) scale(${s.scale})`;
  };

  const openLightbox = (index: number) => {
    stateRef.current = freshState();
    setLightboxDeleteArmed(false);
    setFullIndex(index);
  };

  const closeLightbox = useCallback(() => {
    stateRef.current = freshState();
    setFullIndex(null);
    setLightboxDeleteArmed(false);
    if (imgRef.current) { imgRef.current.style.transform = ''; imgRef.current.style.opacity = '1'; }
  }, []);

  const goNext = useCallback(() => {
    if (fullIndex === null) return;
    stateRef.current = freshState();
    setLightboxDeleteArmed(false);
    setFullIndex((fullIndex + 1) % images.length);
  }, [fullIndex, images.length]);

  const goPrev = useCallback(() => {
    if (fullIndex === null) return;
    stateRef.current = freshState();
    setLightboxDeleteArmed(false);
    setFullIndex((fullIndex - 1 + images.length) % images.length);
  }, [fullIndex, images.length]);

  // External Lightbox API (from HomePanel etc)
  useEffect(() => {
    const handler = (e: any) => {
      const idx = images.findIndex((img: any) => img.id === e.detail.id);
      if (idx !== -1) openLightbox(idx);
    };
    window.addEventListener('OPEN_LIGHTBOX', handler);
    return () => window.removeEventListener('OPEN_LIGHTBOX', handler);
  }, [images]);

  // Long-press (grid selection mode)
  const startLongPress = useCallback((id: number) => {
    longPressTriggered.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true;
      if (navigator.vibrate) navigator.vibrate(30);
      setIsSelecting(true);
      setSelectedIds(new Set([id]));
    }, 400);
  }, []);

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  }, []);

  const handleItemClick = useCallback((img: any, index: number) => {
    if (longPressTriggered.current) { longPressTriggered.current = false; return; }
    if (isSelecting) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.has(img.id) ? next.delete(img.id) : next.add(img.id);
        if (next.size === 0) setIsSelecting(false);
        return next;
      });
      return;
    }
    openLightbox(index);
  }, [isSelecting]);

  const cancelSelection = useCallback(() => { setIsSelecting(false); setSelectedIds(new Set()); }, []);
  const selectAll = useCallback(() => { setSelectedIds(new Set(images.map(img => img.id))); }, [images]);

  const deleteSelected = useCallback(async () => {
    if (selectedIds.size === 0) return;
    setIsDeleting(true);
    try {
      for (const id of selectedIds) await dbDelete('images', id);
      window.dispatchEvent(new CustomEvent('DATA_CHANGED'));
      window.dispatchEvent(new CustomEvent('SHOW_TOAST', { detail: `🗑️ Deleted ${selectedIds.size} image${selectedIds.size > 1 ? 's' : ''}` }));
      setSelectedIds(new Set());
      setIsSelecting(false);
      await loadData();
    } catch (err) {
      window.dispatchEvent(new CustomEvent('SHOW_TOAST', { detail: '❌ Delete failed: ' + err }));
    } finally { setIsDeleting(false); }
  }, [selectedIds, loadData]);

  // ── Lightbox touch handlers ──────────────────────────────────────────────
  const onTouchStart = (e: React.TouchEvent) => {
    const s = stateRef.current;
    if (e.touches.length === 2) {
      s.pinching = true; s.dragging = false;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      s.lastDist = Math.sqrt(dx * dx + dy * dy);
      s.lastMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      s.lastMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      return;
    }
    if (e.touches.length === 1) {
      const now = Date.now();
      const touch = e.touches[0];
      // Double-tap
      if (now - lastTapTime.current < 300) {
        lastTapTime.current = 0;
        if (s.scale > 1) {
          s.scale = 1; s.x = 0; s.y = 0; applyTransform(true);
        } else {
          const newScale = 2.5;
          s.x = (window.innerWidth / 2 - touch.clientX) * (newScale - 1);
          s.y = (window.innerHeight / 2 - touch.clientY) * (newScale - 1);
          s.scale = newScale; applyTransform(true);
        }
        return;
      }
      lastTapTime.current = now;
      s.dragging = true;
      // Store touch start relative to current position
      s.startX = touch.clientX;
      s.startY = touch.clientY;
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (e.cancelable) e.preventDefault();
    const s = stateRef.current;

    if (s.pinching && e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      if (s.lastDist > 0) {
        const ratio = dist / s.lastDist;
        const newScale = Math.max(0.5, Math.min(6, s.scale * ratio));
        // Zoom centered on pinch midpoint (iOS-style)
        const originX = midX - window.innerWidth / 2;
        const originY = midY - window.innerHeight / 2;
        s.x = originX + (s.x - originX) * (newScale / s.scale);
        s.y = originY + (s.y - originY) * (newScale / s.scale);
        s.scale = newScale;
        applyTransform();
      }
      s.lastDist = dist; s.lastMidX = midX; s.lastMidY = midY;
      return;
    }

    if (s.dragging && e.touches.length === 1) {
      const touch = e.touches[0];
      const rawDX = touch.clientX - s.startX;
      const rawDY = touch.clientY - s.startY;

      if (s.scale > 1) {
        // Pan while zoomed — free movement
        s.x += rawDX; s.y += rawDY;
        s.startX = touch.clientX; s.startY = touch.clientY;
        applyTransform();
      } else {
        // At scale 1: detect dominant swipe axis
        if (Math.abs(rawDX) > Math.abs(rawDY) && Math.abs(rawDX) > 6) {
          s.x = rawDX; s.y = 0;
          if (imgRef.current) imgRef.current.style.opacity = '1';
        } else if (Math.abs(rawDY) > Math.abs(rawDX) && Math.abs(rawDY) > 6) {
          s.y = rawDY; s.x = 0;
          if (imgRef.current) imgRef.current.style.opacity = String(Math.max(0.2, 1 - Math.abs(rawDY) / 350));
        }
        applyTransform();
      }
    }
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const s = stateRef.current;

    if (s.pinching && e.touches.length < 2) {
      s.pinching = false; s.lastDist = 0;
      if (s.scale < 1) { s.scale = 1; s.x = 0; s.y = 0; applyTransform(true); }
    }

    if (s.dragging && e.touches.length === 0) {
      s.dragging = false;
      if (s.scale <= 1) {
        const absX = Math.abs(s.x);
        const absY = Math.abs(s.y);
        if (absX > absY && absX > 60) {
          if (s.x < 0) goNext(); else goPrev();
        } else if (absY > absX && absY > 100) {
          closeLightbox();
        } else {
          s.x = 0; s.y = 0;
          if (imgRef.current) imgRef.current.style.opacity = '1';
          applyTransform(true);
        }
      } else {
        // Clamp pan
        const maxX = (window.innerWidth / 2) * s.scale;
        const maxY = (window.innerHeight / 2) * s.scale;
        s.x = Math.max(-maxX, Math.min(maxX, s.x));
        s.y = Math.max(-maxY, Math.min(maxY, s.y));
        applyTransform(true);
      }
    }
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!fullImage) return;
    const a = document.createElement('a');
    a.href = fullImage.full_b64;
    a.download = fullImage.filename.endsWith('.png') ? fullImage.filename : `${fullImage.filename}.png`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const handleLightboxDelete = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!fullImage) return;
    if (!lightboxDeleteArmed) {
      setLightboxDeleteArmed(true);
      setTimeout(() => setLightboxDeleteArmed(false), 3000);
      return;
    }
    try {
      await dbDelete('images', fullImage.id);
      window.dispatchEvent(new CustomEvent('DATA_CHANGED'));
      window.dispatchEvent(new CustomEvent('SHOW_TOAST', { detail: '🗑️ Image deleted' }));
      setLightboxDeleteArmed(false);
      if (images.length <= 1) { closeLightbox(); await loadData(); return; }
      const newIdx = fullIndex! >= images.length - 1 ? fullIndex! - 1 : fullIndex!;
      await loadData();
      setFullIndex(newIdx);
    } catch (err) {
      window.dispatchEvent(new CustomEvent('SHOW_TOAST', { detail: '❌ Delete failed: ' + err }));
    }
  }, [fullImage, lightboxDeleteArmed, fullIndex, images.length, loadData, closeLightbox]);

  return (
    <>
      {isSelecting && (
        <div className="gallery-toolbar">
          <button className="gallery-toolbar-btn" onClick={cancelSelection}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <span className="gallery-toolbar-count">{selectedIds.size} selected</span>
          <button className="gallery-toolbar-btn" onClick={selectAll}>All</button>
          <button className="gallery-toolbar-delete" onClick={deleteSelected} disabled={isDeleting || selectedIds.size === 0}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        </div>
      )}

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
          {images.map((img: any, index: number) => (
            <div
              key={img.id}
              className={`gallery-item ${selectedIds.has(img.id) ? 'selected' : ''}`}
              onClick={() => handleItemClick(img, index)}
              onTouchStart={() => startLongPress(img.id)}
              onTouchEnd={cancelLongPress}
              onTouchMove={cancelLongPress}
              onMouseDown={() => startLongPress(img.id)}
              onMouseUp={cancelLongPress}
              onMouseLeave={cancelLongPress}
            >
              <img src={img.thumbnail_b64 || img.full_b64} alt={img.prompt || 'Generated'} loading="lazy" draggable={false} />
              {isSelecting && (
                <div className={`gallery-check ${selectedIds.has(img.id) ? 'checked' : ''}`}>
                  {selectedIds.has(img.id) && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Lightbox ── */}
      {fullImage && (
        <div className="lightbox" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
          <div className="lightbox-overlay" onClick={closeLightbox} />
          <img ref={imgRef} src={fullImage.full_b64} alt="Full view" draggable={false} />

          <button className="lightbox-close" onClick={closeLightbox}>×</button>

          <button className="lightbox-download" onClick={handleDownload}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>

          <button
            className="lightbox-delete"
            onClick={handleLightboxDelete}
            style={{
              background: lightboxDeleteArmed ? 'rgba(220,38,38,0.85)' : 'rgba(0,0,0,0.55)',
              borderColor: lightboxDeleteArmed ? '#ef4444' : 'rgba(255,255,255,0.15)',
              transition: 'background 0.2s, border-color 0.2s',
            }}
          >
            {lightboxDeleteArmed
              ? <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px' }}>CONFIRM</span>
              : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
            }
          </button>

          {images.length > 1 && (
            <div className="lightbox-counter">{(fullIndex ?? 0) + 1} / {images.length}</div>
          )}

          <div className="lightbox-hint">SWIPE ↕ CLOSE · ← → NAVIGATE · PINCH / DOUBLE-TAP ZOOM</div>
        </div>
      )}
    </>
  );
}
