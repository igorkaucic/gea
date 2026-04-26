import { useState, useRef, useCallback } from 'react';
import { dbGetAll, dbAdd } from '../db/db';

const GDRIVE_CLIENT_ID = '52189932004-5gmr5374et671n3sfpjs6g3ic6f78f20.apps.googleusercontent.com';
const GDRIVE_SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile';
const GEA_ROOT_FOLDER = 'Gea';

export function useGoogleDrive() {
  const [isSyncing, setIsSyncing] = useState(false);
  const [userInfo, setUserInfo] = useState<{name: string, email: string, picture: string} | null>(() => {
    const saved = localStorage.getItem('gdrive_user');
    return saved ? JSON.parse(saved) : null;
  });
  const tokenClientRef = useRef<any>(null);
  const cachedTokenRef = useRef<string | null>(localStorage.getItem('gdrive_token'));

  const initTokenClient = () => {
    if (tokenClientRef.current) return true;
    if (typeof (window as any).google === 'undefined' || !(window as any).google.accounts) {
      alert('Google SDK not loaded. Check your internet or adblocker.');
      return false;
    }
    tokenClientRef.current = (window as any).google.accounts.oauth2.initTokenClient({
      client_id: GDRIVE_CLIENT_ID,
      scope: GDRIVE_SCOPES,
      callback: () => {}
    });
    return true;
  };

  const fetchUserInfo = async (token: string) => {
    try {
      const resp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      const data = await resp.json();
      if (data.email) {
        const info = { name: data.name, email: data.email, picture: data.picture };
        setUserInfo(info);
        localStorage.setItem('gdrive_user', JSON.stringify(info));
      }
    } catch (e) {
      console.warn("Could not fetch user profile", e);
    }
  };

  const getToken = async (interactive: boolean = false): Promise<string> => {
    return new Promise((resolve, reject) => {
      if (!initTokenClient()) return reject(new Error('No SDK'));

      const tc = tokenClientRef.current;
      
      let timeoutId: any = null;
      if (!interactive) {
        timeoutId = setTimeout(() => {
          reject(new Error('Popup blocked or timed out by browser.'));
        }, 3000);
      }

      tc.callback = async (resp: any) => {
        if (timeoutId) clearTimeout(timeoutId);
        if (resp.error) {
          reject(new Error(resp.error));
          return;
        }
        cachedTokenRef.current = resp.access_token;
        localStorage.setItem('gdrive_token', resp.access_token);
        await fetchUserInfo(resp.access_token);
        resolve(resp.access_token);
      };

      if (interactive) {
        tc.requestAccessToken();
      } else {
        tc.requestAccessToken({ prompt: '' });
      }
    });
  };

  // --- Google Drive API helpers ---

  const driveRequest = async (token: string, url: string, options: RequestInit = {}): Promise<any> => {
    const resp = await fetch(url, {
      ...options,
      headers: { 'Authorization': 'Bearer ' + token, ...(options.headers || {}) }
    });
    if (resp.status === 401) {
      // Token expired — try silent refresh before giving up
      console.warn('[DRIVE] Token expired. Attempting silent refresh...');
      try {
        const newToken = await getToken(false);
        // Retry the request with the fresh token
        const retry = await fetch(url, {
          ...options,
          headers: { 'Authorization': 'Bearer ' + newToken, ...(options.headers || {}) }
        });
        if (!retry.ok) throw new Error(`Drive API error after refresh: ${retry.status}`);
        return retry.json();
      } catch (refreshErr) {
        // Silent refresh failed — clear everything
        cachedTokenRef.current = null;
        localStorage.removeItem('gdrive_token');
        throw new Error('Session expired. Tap Sync in Settings to reconnect.');
      }
    }
    if (!resp.ok) throw new Error(`Drive API error: ${resp.status} ${resp.statusText}`);
    return resp.json();
  };

  const findFolder = async (token: string, name: string, parentId?: string): Promise<string | null> => {
    let q = `mimeType='application/vnd.google-apps.folder' and name='${name}' and trashed=false`;
    if (parentId) q += ` and '${parentId}' in parents`;
    const data = await driveRequest(token, `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`);
    return data.files?.[0]?.id || null;
  };

  const createFolder = async (token: string, name: string, parentId?: string): Promise<string> => {
    const metadata: any = {
      name,
      mimeType: 'application/vnd.google-apps.folder'
    };
    if (parentId) metadata.parents = [parentId];
    const data = await driveRequest(token, 'https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata)
    });
    return data.id;
  };

  const findOrCreateFolder = async (token: string, name: string, parentId?: string): Promise<string> => {
    const existing = await findFolder(token, name, parentId);
    if (existing) return existing;
    return createFolder(token, name, parentId);
  };

  const listFilesInFolder = async (token: string, folderId: string): Promise<{id: string, name: string}[]> => {
    const q = `'${folderId}' in parents and trashed=false`;
    const data = await driveRequest(token, `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1000`);
    return data.files || [];
  };

  const uploadMarkdownFile = async (token: string, fileName: string, content: string, folderId: string, existingFileId?: string) => {
    const metadata: any = { name: fileName, mimeType: 'text/markdown' };
    if (!existingFileId) metadata.parents = [folderId];

    const boundary = '---gea_boundary_' + Date.now();
    const body = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      'Content-Type: text/markdown; charset=UTF-8',
      '',
      content,
      `--${boundary}--`
    ].join('\r\n');

    const url = existingFileId
      ? `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart`
      : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';

    const resp = await fetch(url, {
      method: existingFileId ? 'PATCH' : 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body
    });
    if (!resp.ok) throw new Error(`Upload failed: ${resp.status}`);
    return resp.json();
  };

  const uploadImageFile = async (token: string, fileName: string, b64Data: string, folderId: string, existingFileId?: string) => {
    const mimeType = b64Data.split(';')[0].split(':')[1];
    const base64String = b64Data.split(',')[1];
    
    const metadata: any = { name: fileName, mimeType };
    if (!existingFileId) metadata.parents = [folderId];

    const boundary = '---gea_boundary_' + Date.now();
    const body = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      `Content-Type: ${mimeType}`,
      'Content-Transfer-Encoding: base64',
      '',
      base64String,
      `--${boundary}--`
    ].join('\r\n');

    const url = existingFileId
      ? `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart`
      : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';

    const resp = await fetch(url, {
      method: existingFileId ? 'PATCH' : 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body
    });
    if (!resp.ok) throw new Error(`Image Upload failed: ${resp.status}`);
    return resp.json();
  };

  const deleteFile = async (token: string, fileId: string) => {
    await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token }
    });
  };

  // --- Core sync logic: Destructive Mirror ---

  const syncNotesToDrive = async (token: string, rootId: string) => {
    // 1. Get all local notes
    const allNotes = await dbGetAll('notes');

    // 2. Get existing subfolders in Gea/
    const existingFolders = await listFilesInFolder(token, rootId);

    // SAFETY LOCK: Auto-Restore
    if (allNotes.length === 0 && existingFolders.length > 0) {
      window.dispatchEvent(new CustomEvent('SHOW_TOAST', {detail: '⬇️ Local DB empty. Restoring notes from Drive...'}));
      
      for (const folder of existingFolders) {
        if (folder.name === 'Images') continue;
        const files = await listFilesInFolder(token, folder.id);
        for (const file of files) {
          if (!file.name.endsWith('.md')) continue;
          try {
            const rawRes = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
              headers: { 'Authorization': 'Bearer ' + token }
            });
            const text = await rawRes.text();
            
            let title = 'Untitled';
            let timestamp = new Date().toISOString();
            let folderName = folder.name;
            
            const lines = text.split('\n');
            let bodyLines = [];
            let parsingMeta = false;
            
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              if (i === 0 && line.startsWith('# ')) { title = line.substring(2).trim(); continue; }
              if (line.trim() === '---' && i >= lines.length - 5) { parsingMeta = true; continue; }
              if (parsingMeta) {
                if (line.startsWith('*Created: ')) timestamp = line.replace('*Created: ', '').replace(/\*/g, '').trim();
                if (line.startsWith('*Folder: ')) folderName = line.replace('*Folder: ', '').replace(/\*/g, '').trim();
                continue;
              }
              bodyLines.push(line);
            }
            await dbAdd('notes', { title, body: bodyLines.join('\n').trim(), timestamp, folder_name: folderName });
          } catch (e) { console.error("Restore note failed", e); }
        }
      }
      
      window.dispatchEvent(new CustomEvent('DATA_CHANGED'));
      return; // Do not execute destructive mirror after restoring
    }

    if (allNotes.length === 0) return;

    // 2. Group notes by folder_name
    const grouped: Record<string, any[]> = {};
    for (const note of allNotes) {
      const folder = note.folder_name || 'Unsorted';
      if (!grouped[folder]) grouped[folder] = [];
      grouped[folder].push(note);
    }

    // 4. (existingFolders already fetched at top for safety lock)
    const existingFolderMap: Record<string, string> = {};
    for (const f of existingFolders) {
      existingFolderMap[f.name] = f.id;
    }

    // 5. Sync each folder
    const syncedFolderNames = new Set<string>();
    for (const [folderName, notes] of Object.entries(grouped)) {
      syncedFolderNames.add(folderName);

      // Find or create the subfolder
      const folderId = await findOrCreateFolder(token, folderName, rootId);

      // Get existing files in this folder
      const existingFiles = await listFilesInFolder(token, folderId);
      const existingFileMap: Record<string, string> = {};
      for (const f of existingFiles) {
        existingFileMap[f.name] = f.id;
      }

      // Upload/update each note as .md
      const syncedFileNames = new Set<string>();
      for (const note of notes) {
        const fileName = `${(note.title || 'Untitled').replace(/[/\\?%*:|"<>]/g, '_')}.md`;
        syncedFileNames.add(fileName);

        const content = `# ${note.title || 'Untitled'}\n\n${note.body || ''}\n\n---\n*Created: ${note.timestamp || 'Unknown'}*\n*Folder: ${note.folder_name || 'N/A'}*\n*ID: ${note.id}*\n`;

        const existingId = existingFileMap[fileName];
        await uploadMarkdownFile(token, fileName, content, folderId, existingId);
      }

      // Delete files that no longer exist locally (destructive mirror)
      for (const [fileName, fileId] of Object.entries(existingFileMap)) {
        if (!syncedFileNames.has(fileName)) {
          await deleteFile(token, fileId);
        }
      }
    }

    // 6. Delete folders that no longer have notes (destructive mirror)
    for (const [folderName, folderId] of Object.entries(existingFolderMap)) {
      if (!syncedFolderNames.has(folderName)) {
        await deleteFile(token, folderId);
      }
    }
  };

  const syncImagesToDrive = async (token: string, rootId: string) => {
    const allImages = await dbGetAll('images');
    const imagesRootId = await findOrCreateFolder(token, 'Images', rootId);
    const existingFolders = await listFilesInFolder(token, imagesRootId);

    // SAFETY LOCK: Auto-Restore
    if (allImages.length === 0 && existingFolders.length > 0) {
      window.dispatchEvent(new CustomEvent('SHOW_TOAST', {detail: '🖼️ Restoring images from Drive...'}));
      
      for (const folder of existingFolders) {
        const files = await listFilesInFolder(token, folder.id);
        for (const file of files) {
          if (!file.name.endsWith('.png')) continue;
          try {
            const rawRes = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
              headers: { 'Authorization': 'Bearer ' + token }
            });
            const blob = await rawRes.blob();
            
            const reader = new FileReader();
            const base64Promise = new Promise<string>((resolve) => {
              reader.onloadend = () => resolve(reader.result as string);
            });
            reader.readAsDataURL(blob);
            const full_b64 = await base64Promise;
            
            const filename = file.name.replace('.png', '').split('_')[0] || 'gea_image';
            await dbAdd('images', { filename, full_b64, thumbnail_b64: full_b64, prompt: filename, timestamp: new Date().toISOString() });
          } catch (e) { console.error("Restore image failed", e); }
        }
      }
      
      window.dispatchEvent(new CustomEvent('DATA_CHANGED'));
      return;
    }

    if (allImages.length === 0) return;

    // Group images by YYYY-MM
    const grouped: Record<string, any[]> = {};
    for (const img of allImages) {
      const d = new Date(img.timestamp);
      const folderName = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!grouped[folderName]) grouped[folderName] = [];
      grouped[folderName].push(img);
    }

    // (existingFolders already fetched at top for safety lock)
    const existingFolderMap: Record<string, string> = {};
    for (const f of existingFolders) existingFolderMap[f.name] = f.id;

    const syncedFolderNames = new Set<string>();

    for (const [folderName, images] of Object.entries(grouped)) {
      syncedFolderNames.add(folderName);
      const folderId = await findOrCreateFolder(token, folderName, imagesRootId);
      
      const existingFiles = await listFilesInFolder(token, folderId);
      const existingFileMap: Record<string, string> = {};
      for (const f of existingFiles) existingFileMap[f.name] = f.id;

      const syncedFileNames = new Set<string>();

      for (const img of images) {
        const baseName = img.filename || `gea_image`;
        const fileName = `${baseName}_${img.id}.png`;
        syncedFileNames.add(fileName);

        if (!existingFileMap[fileName]) {
           await uploadImageFile(token, fileName, img.full_b64, folderId);
        }
      }

      for (const [fileName, fileId] of Object.entries(existingFileMap)) {
        if (!syncedFileNames.has(fileName)) await deleteFile(token, fileId);
      }
    }

    // Delete empty month folders
    for (const [folderName, folderId] of Object.entries(existingFolderMap)) {
      if (!syncedFolderNames.has(folderName)) await deleteFile(token, folderId);
    }
  };

  const isSyncingRef = useRef(false);
  const queuedSyncRef = useRef(false);

  const syncDrive = useCallback(async () => {
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;
    setIsSyncing(true);
    try {
      const token = await getToken(true);
      const rootId = await findOrCreateFolder(token, GEA_ROOT_FOLDER);
      
      // Sync Notes
      await syncNotesToDrive(token, rootId);
      
      // Sync Images
      await syncImagesToDrive(token, rootId);
      
      window.dispatchEvent(new CustomEvent('SHOW_TOAST', {detail: '✅ Notes & Images synced to Google Drive!'}));
    } catch (e: any) {
      window.dispatchEvent(new CustomEvent('SHOW_TOAST', {detail: '❌ Drive Error: ' + e.message}));
      console.error(e);
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
    }
  }, []);

  const trySilentSync = useCallback(async () => {
    if (isSyncingRef.current) {
      queuedSyncRef.current = true;
      return;
    }
    isSyncingRef.current = true;
    setIsSyncing(true);

    try {
      do {
        queuedSyncRef.current = false;
        let token = cachedTokenRef.current;
        if (!token) {
          // In standalone PWA mode, popups are blocked so we can't acquire tokens silently.
          // User needs to manually sync via Settings to establish a session.
          console.warn('[DRIVE SYNC] No cached token — skipping auto-sync. Reconnect in Settings.');
          window.dispatchEvent(new CustomEvent('SHOW_TOAST', {detail: 'ℹ️ Drive not connected. Tap Sync in Settings to reconnect.'}));
          return;
        }
        if (token) {
          const rootId = await findOrCreateFolder(token, GEA_ROOT_FOLDER);
          await syncNotesToDrive(token, rootId);
          await syncImagesToDrive(token, rootId);
          console.log('🔄 [DRIVE SYNC] Silent auto-sync successfully uploaded files to cloud.');
          window.dispatchEvent(new CustomEvent('SHOW_TOAST', {detail: '✅ Auto-sync complete!'}));
        }
      } while (queuedSyncRef.current);
    } catch (e: any) {
      cachedTokenRef.current = null;
      localStorage.removeItem('gdrive_token');
      console.warn('Silent sync failed:', e.message);
      window.dispatchEvent(new CustomEvent('SHOW_TOAST', {detail: '⚠️ Sync failed: ' + e.message}));
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
    }
  }, []);

  const logoutDrive = useCallback(() => {
    cachedTokenRef.current = null;
    localStorage.removeItem('gdrive_token');
    localStorage.removeItem('gdrive_user');
    setUserInfo(null);
  }, []);

  return { syncDrive, trySilentSync, isSyncing, userInfo, logoutDrive };
}
