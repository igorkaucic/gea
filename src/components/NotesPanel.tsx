import { useState, useRef, useEffect } from 'react';
import { dbPut, dbDelete } from '../db/db';

interface Props {
  notes: any[];
  loadData: () => void;
  trySilentSync: () => void;
  isActive: boolean;
}

export default function NotesPanel({ notes, loadData, trySilentSync, isActive }: Props) {
  const [activeTab, setActiveTab] = useState<'notes' | 'reminders'>('notes');
  const [collapsedDirs, setCollapsedDirs] = useState<Record<string, boolean>>({});
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [deletedNote, setDeletedNote] = useState<any>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.style.height = 'auto';
      bodyRef.current.style.height = bodyRef.current.scrollHeight + 'px';
    }
  }, [editBody]);

  const startEdit = (note: any) => {
    setEditingId(note.id);
    setEditTitle(note.title || '');
    setEditBody(note.body || '');
  };

  const saveEdit = async () => {
    if (editingId === null) return;
    const note = notes.find(n => n.id === editingId);
    if (!note) return;
    await dbPut('notes', { ...note, title: editTitle, body: editBody });
    setEditingId(null);
    loadData();
    if (!isActive) trySilentSync();
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const handleDelete = async (note: any) => {
    setDeletedNote(note);
    await dbDelete('notes', note.id);
    loadData();
    if (!isActive) trySilentSync();
    setTimeout(() => setDeletedNote((prev: any) => prev?.id === note.id ? null : prev), 5000);
  };

  const undoDelete = async () => {
    if (!deletedNote) return;
    await dbPut('notes', deletedNote);
    setDeletedNote(null);
    loadData();
    if (!isActive) trySilentSync();
  };

  // Separate reminders from regular notes
  const regularNotes = notes.filter(n => !n.is_reminder);
  const reminders = notes.filter(n => n.is_reminder)
    .sort((a, b) => new Date(a.start_time_iso || a.timestamp).getTime() - new Date(b.start_time_iso || b.timestamp).getTime());

  // Group regular notes by folder
  const grouped: Record<string, any[]> = {};
  for (const note of regularNotes) {
    const folder = note.folder_name || 'Unsorted';
    if (!grouped[folder]) grouped[folder] = [];
    grouped[folder].push(note);
  }

  const sortedFolders = Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b));

  const handleCopyNote = async (note: any) => {
    try {
      const textToCopy = `${note.title || 'Untitled'}\n\n${note.body || ''}`;
      await navigator.clipboard.writeText(textToCopy);
      window.dispatchEvent(new CustomEvent('SHOW_TOAST', { detail: '✅ Note copied to clipboard!' }));
    } catch (e) {
      window.dispatchEvent(new CustomEvent('SHOW_TOAST', { detail: '❌ Failed to copy note.' }));
    }
  };

  return (
    <>
      <h1 className="page-header">Notes</h1>

      {/* ── Tab switcher ── */}
      <div className="notes-tabs">
        <button
          className={`notes-tab ${activeTab === 'notes' ? 'active' : ''}`}
          onClick={() => setActiveTab('notes')}
        >
          NOTES
          {regularNotes.length > 0 && <span className="notes-tab-badge">{regularNotes.length}</span>}
        </button>
        <button
          className={`notes-tab ${activeTab === 'reminders' ? 'active reminder' : ''}`}
          onClick={() => setActiveTab('reminders')}
        >
          ⏰ REMINDERS
          {reminders.length > 0 && <span className="notes-tab-badge reminder">{reminders.length}</span>}
        </button>
      </div>

      <div className="notes-container">
        {activeTab === 'reminders' ? (
          reminders.length === 0 ? (
            <div className="empty-state">
              <div style={{ fontSize: '32px', opacity: 0.3 }}>⏰</div>
              <div>No reminders yet.</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Say "remind me in 3 days to..." and Gea will set it up.</div>
            </div>
          ) : (
            <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {reminders.map((note: any) => {
                const remTime = note.start_time_iso ? new Date(note.start_time_iso) : null;
                const isPast = remTime && remTime < new Date();
                return (
                  <div key={note.id} className="note-card" style={{ border: isPast ? '1px solid rgba(239,68,68,0.4)' : '1px solid rgba(255,140,0,0.35)', background: isPast ? 'rgba(239,68,68,0.04)' : 'rgba(255,140,0,0.04)' }}>
                    {remTime && (
                      <div style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', fontWeight: 800, color: isPast ? '#ef4444' : '#ff8c00', marginBottom: '6px', letterSpacing: '0.5px' }}>
                        {isPast ? '⚠ OVERDUE · ' : '⏰ '}{remTime.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} · {remTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    )}
                    <div className="note-title" style={{ color: 'var(--text-primary)' }}>{note.title || 'Reminder'}</div>
                    {note.body && <div className="note-body">{note.body}</div>}
                    <div className="note-meta">
                      <span className="note-timestamp">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                        Created {note.timestamp ? new Date(note.timestamp).toLocaleDateString() : ''}
                      </span>
                      <button className="note-delete" onClick={() => handleDelete(note)}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : (
          regularNotes.length === 0 ? (
          <div className="empty-state">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.3 }}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14,2 14,8 20,8" />
              <line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10,9 9,9 8,9" />
            </svg>
            <div>No notes yet.</div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Talk to Gea — she'll organize your ideas here.</div>
          </div>
        ) : (
          sortedFolders.map(([folderName, folderNotes]) => (
            <div key={folderName} className="folder-node">
              <div
                className="folder-header"
                onClick={() => setCollapsedDirs(prev => ({ ...prev, [folderName]: prev[folderName] === undefined ? false : !prev[folderName] }))}
              >
                <span className="folder-label">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                </span>
                <span className="folder-name">{folderName.toUpperCase()}</span>
                <span className="folder-count">{folderNotes.length}</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-muted)', transition: 'transform 0.2s', transform: collapsedDirs[folderName] === false ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </div>

              {collapsedDirs[folderName] === false && (
                <div className="folder-children">
                  <div className="folder-wire" />
                  {folderNotes.map((note: any) => (
                    <div key={note.id} className="note-card" style={note.is_reminder ? { border: '1px solid rgba(255, 0, 255, 0.3)', background: 'rgba(255, 0, 255, 0.02)' } : {}}>
                      <div className="note-wire-dot" style={note.is_reminder ? { borderColor: '#FF00FF', background: '#FF00FF', boxShadow: '0 0 8px #FF00FF' } : {}} />
                      <div className="note-wire-line" />

                      {editingId === note.id ? (
                        /* EDIT MODE */
                        <div>
                          <input
                            value={editTitle}
                            onChange={e => setEditTitle(e.target.value)}
                            style={{ width: '100%', background: 'var(--bg-surface)', border: '1px solid var(--phosphor-dim)', borderRadius: '6px', padding: '8px 12px', color: 'var(--text-primary)', fontFamily: 'var(--font-ui)', fontSize: '15px', fontWeight: 700, marginBottom: '8px', outline: 'none' }}
                            placeholder="Title"
                          />
                          <textarea
                            ref={bodyRef}
                            value={editBody}
                            onChange={e => setEditBody(e.target.value)}
                            style={{ width: '100%', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '6px', padding: '8px 12px', color: 'var(--text-secondary)', fontFamily: 'var(--font-ui)', fontSize: '13px', lineHeight: '1.6', resize: 'none', outline: 'none', minHeight: '80px' }}
                            placeholder="Note body..."
                          />
                          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                            <button onClick={saveEdit} style={{ flex: 1, padding: '8px', background: 'var(--phosphor-glow)', color: 'var(--phosphor)', border: '1px solid var(--phosphor-dim)', borderRadius: '6px', fontWeight: 700, fontSize: '12px', cursor: 'pointer', fontFamily: 'var(--font-mono)' }}>
                              ✓ SAVE
                            </button>
                            <button onClick={cancelEdit} style={{ flex: 1, padding: '8px', background: 'var(--bg-surface)', color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: '6px', fontWeight: 700, fontSize: '12px', cursor: 'pointer', fontFamily: 'var(--font-mono)' }}>
                              ✕ CANCEL
                            </button>
                          </div>
                        </div>
                      ) : (
                        /* VIEW MODE */
                        <>
                          <div className="note-title" style={note.is_reminder ? { color: '#FF00FF', display: 'flex', alignItems: 'center', gap: '6px' } : {}}>
                            {note.is_reminder && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>}
                            {note.title || 'Untitled'}
                          </div>
                          {note.body && <div className="note-body" style={note.is_reminder ? { borderLeft: '2px solid #FF00FF', paddingLeft: '8px' } : {}}>{note.body}</div>}
                          {note.is_reminder && note.start_time_iso && (
                            <div style={{ fontSize: '11px', color: '#FF00FF', marginTop: '6px', fontWeight: 'bold' }}>
                              ⏰ {new Date(note.start_time_iso).toLocaleString()}
                            </div>
                          )}
                          <div className="note-meta">
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span className="note-timestamp">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                                {note.timestamp ? new Date(note.timestamp).toLocaleString() : ''}
                              </span>
                              <button onClick={() => startEdit(note)} style={{ background: 'rgba(255,255,255,0.03)', color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: '4px', padding: '2px 8px', fontSize: '10px', cursor: 'pointer', fontWeight: 'bold', fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                                EDIT
                              </button>
                              <button onClick={() => handleCopyNote(note)} style={{ background: 'rgba(255,255,255,0.03)', color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: '4px', padding: '2px 8px', fontSize: '10px', cursor: 'pointer', fontWeight: 'bold', fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                                COPY
                              </button>
                            </div>
                            <button className="note-delete" onClick={() => handleDelete(note)}>
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )
        )}
      </div>

      {deletedNote && (
        <div className="undo-bar">
          <span className="undo-bar-text">Note deleted</span>
          <button className="undo-bar-btn" onClick={undoDelete}>UNDO</button>
        </div>
      )}
    </>
  );
}
