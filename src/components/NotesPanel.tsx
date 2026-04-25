import { useState, useRef, useEffect } from 'react';
import { dbPut, dbDelete } from '../db/db';

interface Props {
  notes: any[];
  loadData: () => void;
  trySilentSync: () => void;
  isActive: boolean;
}

export default function NotesPanel({ notes, loadData, trySilentSync, isActive }: Props) {
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
    const { id, ...rest } = deletedNote;
    await dbPut('notes', deletedNote);
    setDeletedNote(null);
    loadData();
    if (!isActive) trySilentSync();
  };

  // Group notes by folder
  const grouped: Record<string, any[]> = {};
  for (const note of notes) {
    const folder = note.folder_name || 'Unsorted';
    if (!grouped[folder]) grouped[folder] = [];
    grouped[folder].push(note);
  }

  const sortedFolders = Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b));

  return (
    <>
      <h1 className="page-header">Notes</h1>
      <div className="notes-container">
        {notes.length === 0 ? (
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
                    <div key={note.id} className="note-card">
                      <div className="note-wire-dot" />
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
                          <div className="note-title">{note.title || 'Untitled'}</div>
                          {note.body && <div className="note-body">{note.body}</div>}
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
