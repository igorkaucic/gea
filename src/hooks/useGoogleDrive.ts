import { useState, useRef, useCallback } from 'react';
import { dbGetAll } from '../db/db';

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
  const cachedTokenRef = useRef<string | null>(null);

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
      if (!initTokenClient()) return reject('No SDK');

      const tc = tokenClientRef.current;
      tc.callback = async (resp: any) => {
        if (resp.error) {
          reject(resp.error);
          return;
        }
        cachedTokenRef.current = resp.access_token;
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

  const driveRequest = async (token: string, url: string, options: RequestInit = {}) => {
    const resp = await fetch(url, {
      ...options,
      headers: { 'Authorization': 'Bearer ' + token, ...(options.headers || {}) }
    });
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

    // 2. Group notes by folder_name
    const grouped: Record<string, any[]> = {};
    for (const note of allNotes) {
      const folder = note.folder_name || 'Unsorted';
      if (!grouped[folder]) grouped[folder] = [];
      grouped[folder].push(note);
    }

    // 4. Get existing subfolders in Gea/
    const existingFolders = await listFilesInFolder(token, rootId);
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
    if (allImages.length === 0) return;

    const imagesRootId = await findOrCreateFolder(token, 'Images', rootId);

    // Group images by YYYY-MM
    const grouped: Record<string, any[]> = {};
    for (const img of allImages) {
      const d = new Date(img.timestamp);
      const folderName = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!grouped[folderName]) grouped[folderName] = [];
      grouped[folderName].push(img);
    }

    const existingFolders = await listFilesInFolder(token, imagesRootId);
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
          try {
            token = await getToken();
          } catch {
            break;
          }
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
      console.warn('Silent sync failed:', e.message);
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
    }
  }, []);

  const logoutDrive = useCallback(() => {
    cachedTokenRef.current = null;
    localStorage.removeItem('gdrive_user');
    setUserInfo(null);
  }, []);

  return { syncDrive, trySilentSync, isSyncing, userInfo, logoutDrive };
}
