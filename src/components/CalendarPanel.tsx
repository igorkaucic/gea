import { useState } from 'react';

interface Props {
  notes: any[];
  images: any[];
  onNavigateToNotes: (month: Date, day: number, tab?: 'notes' | 'reminders') => void;
  onNavigateToGallery: () => void;
}

export default function CalendarPanel({ notes, images, onNavigateToNotes, onNavigateToGallery }: Props) {
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [selectedDay, setSelectedDay] = useState<number | null>(new Date().getDate());

  const year = calMonth.getFullYear();
  const month = calMonth.getMonth();
  const firstDay = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const isCurrentMonth = today.getMonth() === month && today.getFullYear() === year;

  // Build day activity maps
  const dayNoteCounts: Record<number, number> = {};
  for (const n of notes.filter((n: any) => !n.is_reminder)) {
    const d = new Date(n.timestamp);
    if (d.getMonth() === month && d.getFullYear() === year) {
      dayNoteCounts[d.getDate()] = (dayNoteCounts[d.getDate()] || 0) + 1;
    }
  }
  const dayImageCounts: Record<number, number> = {};
  for (const img of images) {
    const d = new Date(img.timestamp);
    if (d.getMonth() === month && d.getFullYear() === year) {
      dayImageCounts[d.getDate()] = (dayImageCounts[d.getDate()] || 0) + 1;
    }
  }
  // Reminders — keyed by their reminder date (start_time_iso), not creation date
  const dayReminderCounts: Record<number, number> = {};
  for (const n of notes.filter((n: any) => n.is_reminder && n.start_time_iso)) {
    const d = new Date(n.start_time_iso);
    if (d.getMonth() === month && d.getFullYear() === year) {
      dayReminderCounts[d.getDate()] = (dayReminderCounts[d.getDate()] || 0) + 1;
    }
  }

  // Build cells
  const cells: { day: number; type: 'prev' | 'current' | 'next' }[] = [];
  const prevMonthDays = new Date(year, month, 0).getDate();
  for (let i = 0; i < firstDay; i++) cells.push({ day: prevMonthDays - firstDay + i + 1, type: 'prev' });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, type: 'current' });
  const remaining = (7 - (cells.length % 7)) % 7;
  for (let i = 1; i <= remaining; i++) cells.push({ day: i, type: 'next' });

  // Events for selected day
  const events: { type: string; time: string; title: string; sub?: string; thumbnail?: string; full_b64?: string; filename?: string; isReminder?: boolean; isPast?: boolean; }[] = [];
  if (selectedDay) {
    for (const n of notes.filter((n: any) => !n.is_reminder)) {
      const d = new Date(n.timestamp);
      if (d.getDate() === selectedDay && d.getMonth() === month && d.getFullYear() === year) {
        events.push({ type: 'note', time: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), title: n.title || 'Untitled', sub: n.folder_name });
      }
    }
    // Reminders by their reminder time
    for (const n of notes.filter((n: any) => n.is_reminder && n.start_time_iso)) {
      const d = new Date(n.start_time_iso);
      if (d.getDate() === selectedDay && d.getMonth() === month && d.getFullYear() === year) {
        const isPast = d < new Date();
        events.push({ type: 'reminder', time: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), title: n.title || 'Reminder', sub: n.body, isReminder: true, isPast });
      }
    }
      for (const img of images) {
        const d = new Date(img.timestamp);
        if (d.getDate() === selectedDay && d.getMonth() === month && d.getFullYear() === year) {
          events.push({ type: 'image', time: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), title: 'Generated Image', sub: (img.prompt || '').substring(0, 60), thumbnail: img.thumbnail_b64, full_b64: img.full_b64, filename: img.filename });
        }
      }
    events.sort((a, b) => a.time.localeCompare(b.time));
  }

  return (
    <>
      <h1 className="page-header">Calendar</h1>
      <div className="calendar-container">
        <div className="calendar-card">
          <div className="calendar-nav">
            <button className="calendar-nav-btn" onClick={() => setCalMonth(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))}>≪</button>
            <span className="calendar-month">
              {calMonth.toLocaleString('default', { month: 'long' }).toUpperCase()} {year}
            </span>
            <button className="calendar-nav-btn" onClick={() => setCalMonth(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))}>≫</button>
          </div>

          <div className="calendar-weekdays">
            {['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map(d => (
              <div key={d} className="calendar-weekday">{d}</div>
            ))}
          </div>

          <div className="calendar-grid">
            {cells.map((cell, i) => {
              const isBuffer = cell.type !== 'current';
              const isToday = !isBuffer && isCurrentMonth && today.getDate() === cell.day;
              const isSelected = !isBuffer && selectedDay === cell.day;
              const hasNotes = !isBuffer && (dayNoteCounts[cell.day] || 0) > 0;
              const hasImages = !isBuffer && (dayImageCounts[cell.day] || 0) > 0;
              const hasReminders = !isBuffer && (dayReminderCounts[cell.day] || 0) > 0;

              return (
                <div
                  key={i}
                  className={`calendar-day ${isBuffer ? 'buffer' : ''} ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}`}
                  onClick={() => !isBuffer && setSelectedDay(cell.day)}
                >
                  <span>{cell.day}</span>
                  {!isBuffer && (hasNotes || hasImages || hasReminders) && (
                    <div className="calendar-day-dots">
                      {hasNotes && <div className="calendar-day-dot" style={{ background: 'var(--phosphor)' }} />}
                      {hasReminders && <div className="calendar-day-dot" style={{ background: '#ff8c00' }} />}
                      {hasImages && <div className="calendar-day-dot" style={{ background: 'var(--amber)' }} />}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {selectedDay && (
          <div className="calendar-events">
            {events.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', position: 'relative', paddingLeft: '16px' }}>
                <div className="calendar-event-wire" />
                {events.map((ev, i) => (
                  <div
                    key={i}
                    className="calendar-event"
                    style={{ cursor: 'pointer', ...(ev.isReminder ? { borderLeft: '2px solid #ff8c00', paddingLeft: '14px' } : {}) }}
                    onClick={() => {
                      if (ev.type === 'note' || ev.type === 'reminder') {
                        onNavigateToNotes(new Date(year, month, 1), selectedDay, ev.type === 'reminder' ? 'reminders' : 'notes');
                      } else if (ev.type === 'image' && ev.full_b64) {
                        window.dispatchEvent(new CustomEvent('OPEN_LIGHTBOX', { detail: { url: ev.full_b64, filename: ev.filename } }));
                        onNavigateToGallery();
                      }
                    }}
                  >
                    <div className="calendar-event-dot" style={{ background: ev.type === 'reminder' ? '#ff8c00' : ev.type === 'note' ? 'var(--phosphor)' : 'var(--amber)' }} />
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                      <strong style={{ color: ev.type === 'reminder' ? '#ff8c00' : ev.type === 'note' ? 'var(--phosphor)' : 'var(--amber)', fontSize: '13px', fontFamily: 'var(--font-mono)' }}>{ev.isPast ? '⚠ ' : ev.type === 'reminder' ? '⏰ ' : ''}{ev.time}</strong>
                      <div>
                        <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>{ev.title}</div>
                        {ev.sub && <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{ev.sub}</div>}
                        {ev.thumbnail && (
                          <div style={{ marginTop: '8px', borderRadius: '6px', overflow: 'hidden', border: '1px solid var(--border)', maxWidth: '120px' }}>
                            <img src={ev.thumbnail} alt="thumbnail" style={{ display: 'block', width: '100%', height: 'auto' }} />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px', padding: '10px 0', fontStyle: 'italic' }}>
                No activity on this date.
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
