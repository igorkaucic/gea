import { useState, useRef, useCallback, useEffect } from 'react';
import { dbDelete } from '../db/db';

interface Props {
  images: any[];
  loadData: () => Promise<void>;
}

export default function GalleryPanel({ images, loadData }: Props) {
  const [fullImage, setFullImage] = useState<{ url: string; filename: string } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isSelecting, setIsSelecting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const longPressTimer = useRef<any>(null);
  const longPressTriggered = useRef(false);

  const imgRef = useRef<HTMLImageElement>(null);
  const stateRef = useRef({ scale: 1, x: 0, y: 0, lastDist: 0, startX: 0, startY: 0, dragging: false, pinching: false });

  const applyTransform = () => {
    if (imgRef.current) {
      const s = stateRef.current;
      imgRef.current.style.transform = `translate(${s.x}px, ${s.y}px) scale(${s.scale})`;
    }
  };

  // ─── External Lightbox API ───
  useEffect(() => {
    const handleOpenLightbox = (e: any) => {
      setFullImage(e.detail);
      stateRef.current = { scale: 1, x: 0, y: 0, lastDist: 0, startX: 0, startY: 0, dragging: false, pinching: false };
    };
    window.addEventListener('OPEN_LIGHTBOX', handleOpenLightbox);
    return () => window.removeEventListener('OPEN_LIGHTBOX', handleOpenLightbox);
  }, []);

  // ─── Long-press handlers ───
  const startLongPress = useCallback((id: number) => {
    longPressTriggered.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true;
      // Haptic feedback if available
      if (navigator.vibrate) navigator.vibrate(30);
      setIsSelecting(true);
      setSelectedIds(new Set([id]));
    }, 400);
  }, []);

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handleItemClick = useCallback((img: any) => {
    if (longPressTriggered.current) {
      longPressTriggered.current = false;
      return; // Long press just triggered, don't open
    }

    if (isSelecting) {
      // Toggle selection
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(img.id)) {
          next.delete(img.id);
        } else {
          next.add(img.id);
        }
        // Exit selection mode if nothing selected
        if (next.size === 0) setIsSelecting(false);
        return next;
      });
      return;
    }

    // Normal tap — open lightbox
    stateRef.current = { scale: 1, x: 0, y: 0, lastDist: 0, startX: 0, startY: 0, dragging: false, pinching: false };
    setFullImage({ url: img.full_b64, filename: img.filename });
  }, [isSelecting]);

  const cancelSelection = useCallback(() => {
    setIsSelecting(false);
    setSelectedIds(new Set());
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(images.map(img => img.id)));
  }, [images]);

  const deleteSelected = useCallback(async () => {
    if (selectedIds.size === 0) return;
    setIsDeleting(true);
    try {
      for (const id of selectedIds) {
        await dbDelete('images', id);
      }
      window.dispatchEvent(new CustomEvent('DATA_CHANGED'));
      window.dispatchEvent(new CustomEvent('SHOW_TOAST', { detail: `🗑️ Deleted ${selectedIds.size} image${selectedIds.size > 1 ? 's' : ''}` }));
      setSelectedIds(new Set());
      setIsSelecting(false);
      await loadData();
    } catch (err) {
      window.dispatchEvent(new CustomEvent('SHOW_TOAST', { detail: '❌ Delete failed: ' + err }));
    } finally {
      setIsDeleting(false);
    }
  }, [selectedIds, loadData]);

  const lastTapTime = useRef<number>(0);

  // ─── Lightbox touch handlers ───
  const onTouchStart = (e: React.TouchEvent) => {
    const s = stateRef.current;
    if (e.touches.length === 2) {
      s.pinching = true; s.dragging = false;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      s.lastDist = Math.sqrt(dx * dx + dy * dy);
    } else if (e.touches.length === 1) {
      const now = Date.now();
      if (now - lastTapTime.current < 300) {
        // Double tap
        s.scale = s.scale > 1 ? 1 : 2.5;
        s.x = 0; s.y = 0;
        applyTransform();
        lastTapTime.current = 0;
        return;
      }
      lastTapTime.current = now;

      s.dragging = true;
      if (s.scale > 1) {
        s.startX = e.touches[0].clientX - s.x;
        s.startY = e.touches[0].clientY - s.y;
      } else {
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
        s.x = e.touches[0].clientX - s.startX!;
        s.y = e.touches[0].clientY - s.startY;
        applyTransform();
      } else {
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
    a.href = fullImage.url;
    a.download = fullImage.filename.endsWith('.png') ? fullImage.filename : `${fullImage.filename}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <>
      {/* ─── Selection toolbar ─── */}
      {isSelecting && (
        <div className="gallery-toolbar">
          <button className="gallery-toolbar-btn" onClick={cancelSelection}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <span className="gallery-toolbar-count">{selectedIds.size} selected</span>
          <button className="gallery-toolbar-btn" onClick={selectAll}>
            All
          </button>
          <button
            className="gallery-toolbar-delete"
            onClick={deleteSelected}
            disabled={isDeleting || selectedIds.size === 0}
          >
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
          {images.map((img: any) => (
            <div
              key={img.id}
              className={`gallery-item ${selectedIds.has(img.id) ? 'selected' : ''}`}
              onClick={() => handleItemClick(img)}
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

      {/* ─── Lightbox ─── */}
      {fullImage && (
        <div className="lightbox" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
          <div className="lightbox-overlay" onClick={() => { setFullImage(null); stateRef.current.scale = 1; stateRef.current.x = 0; stateRef.current.y = 0; }} />
          <img ref={imgRef} src={fullImage.url} alt="Full view" draggable={false} />
          <button className="lightbox-close" onClick={() => setFullImage(null)}>×</button>
          <button className="lightbox-download" onClick={handleDownload}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
          <div className="lightbox-hint">DRAG ↕ TO CLOSE · PINCH / DOUBLE-TAP TO ZOOM</div>
        </div>
      )}
    </>
  );
}
