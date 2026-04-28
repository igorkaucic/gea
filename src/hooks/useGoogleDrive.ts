import { useState, useRef, useCallback } from 'react';
import { dbGetAll, dbPut } from '../db/db';

const hashObject = async (obj: any): Promise<string> => {
  const str = JSON.stringify(obj);
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(str));
  const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  return hex.substring(0, 6);
};

const GDRIVE_CLIENT_ID = '52189932004-5gmr5374et671n3sfpjs6g3ic6f78f20.apps.googleusercontent.com';
const GDRIVE_SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile';
const GEA_ROOT_FOLDER = 'Gea';

const IS_STANDALONE = window.matchMedia('(display-mode: standalone)').matches ||
  (window.navigator as any).standalone === true;

// On redirect return, extract token from URL hash BEFORE React mounts
function extractRedirectToken(): string | null {
  const hash = window.location.hash;
  if (!hash || !hash.includes('access_token')) return null;
  const params = new URLSearchParams(hash.substring(1));
  const token = params.get('access_token');
  if (token) {
    localStorage.setItem('gdrive_token', token);
    // Store a flag so we know we just came back from auth
    localStorage.setItem('gdrive_just_authed', '1');
    // Clean URL
    window.history.replaceState({}, '', window.location.pathname);
    console.log('[DRIVE] Token extracted from redirect URL');
  }
  return token;
}

// Run immediately on module load
const REDIRECT_TOKEN = extractRedirectToken();

export function useGoogleDrive() {
  const [isSyncing, setIsSyncing] = useState(false);
  const [userInfo, setUserInfo] = useState<{name: string, email: string, picture: string} | null>(() => {
    const saved = localStorage.getItem('gdrive_user');
    return saved ? JSON.parse(saved) : null;
  });
  const tokenClientRef = useRef<any>(null);
  const cachedTokenRef = useRef<string | null>(REDIRECT_TOKEN || localStorage.getItem('gdrive_token'));

  const initTokenClient = () => {
    if (tokenClientRef.current) return true;
    if (typeof (window as any).google === 'undefined' || !(window as any).google.accounts) {
      console.warn('[DRIVE] Google SDK not loaded');
      return false;
    }
    tokenClientRef.current = (window as any).google.accounts.oauth2.initTokenClient({
      client_id: GDRIVE_CLIENT_ID,
      scope: GDRIVE_SCOPES,
      callback: () => {},
      error_callback: (err: any) => {
        console.error('[DRIVE] Token client error:', err.type);
      }
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

  // Manual OAuth 2.0 implicit flow redirect for PWA standalone mode
  // (initTokenClient only supports popup — per official Google docs, no ux_mode for token client)
  const redirectToGoogleAuth = () => {
    const redirectUri = (window.location.origin + window.location.pathname).replace(/\/$/, '');
    const params = new URLSearchParams({
      client_id: GDRIVE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'token',
      scope: GDRIVE_SCOPES,
      include_granted_scopes: 'true'
    });
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    console.log('[DRIVE] Redirecting to Google OAuth...');
    window.location.href = authUrl;
  };

  const getToken = async (interactive: boolean = false): Promise<string> => {
    // If we have a cached token, always try it first
    if (cachedTokenRef.current) return cachedTokenRef.current;

    // In standalone mode, use manual redirect (no popup support on iOS PWA)
    if (IS_STANDALONE && interactive) {
      redirectToGoogleAuth();
      throw new Error('Redirecting to Google...');
    }

    // In browser mode, use popup via GIS token client
    return new Promise((resolve, reject) => {
      if (!initTokenClient()) {
        if (interactive) { redirectToGoogleAuth(); return; }
        return reject(new Error('No SDK'));
      }

      const tc = tokenClientRef.current;

      let timeoutId: any = null;
      if (!interactive) {
        timeoutId = setTimeout(() => {
          reject(new Error('Silent token refresh timed out.'));
        }, 3000);
      }

      tc.callback = async (resp: any) => {
        if (timeoutId) clearTimeout(timeoutId);
        if (resp.error) { reject(new Error(resp.error)); return; }
        cachedTokenRef.current = resp.access_token;
        localStorage.setItem('gdrive_token', resp.access_token);
        await fetchUserInfo(resp.access_token);
        resolve(resp.access_token);
      };

      tc.error_callback = (err: any) => {
        if (timeoutId) clearTimeout(timeoutId);
        console.error('[DRIVE] Popup error:', err.type);
        if (interactive && err.type === 'popup_failed_to_open') {
          redirectToGoogleAuth();
        } else {
          reject(new Error('Auth failed: ' + err.type));
        }
      };

      if (interactive) {
        tc.requestAccessToken();
      } else {
        tc.requestAccessToken({ prompt: '' });
      }
    });
  };

  // --- Google Drive API helpers ---

  const driveRequest = async (url: string, options: RequestInit = {}, expectsJson: boolean = true): Promise<any> => {
    let currentToken = cachedTokenRef.current;
    if (!currentToken) throw new Error('No token available');

    const doFetch = (t: string) => fetch(url, {
      ...options,
      headers: { 'Authorization': 'Bearer ' + t, ...(options.headers || {}) }
    });

    let resp = await doFetch(currentToken);

    if (resp.status === 401) {
      console.warn('[DRIVE] Token expired. Attempting silent refresh...');
      try {
        currentToken = await getToken(false);
        resp = await doFetch(currentToken);
        if (!resp.ok) throw new Error(`Drive API error after refresh: ${resp.status}`);
      } catch (refreshErr) {
        cachedTokenRef.current = null;
        localStorage.removeItem('gdrive_token');
        throw new Error('Session expired. Tap Sync in Settings to reconnect.');
      }
    }
    
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`Drive API error: ${resp.status} ${resp.statusText} - ${errText}`);
    }
    
    if (!expectsJson) return resp.text();
    return resp.json();
  };

  const findOrCreateFolder = async (name: string, parentId?: string): Promise<string> => {
    const cacheKey = `gdrive_folder_${name}_${parentId || 'root'}`;
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) return cached;

    let q = `mimeType='application/vnd.google-apps.folder' and name='${name}' and trashed=false`;
    if (parentId) q += ` and '${parentId}' in parents`;
    
    const searchData = await driveRequest(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`);
    
    if (searchData.files && searchData.files.length > 0) {
      sessionStorage.setItem(cacheKey, searchData.files[0].id);
      return searchData.files[0].id;
    }

    const metadata: any = { name, mimeType: 'application/vnd.google-apps.folder' };
    if (parentId) metadata.parents = [parentId];
    
    const folder = await driveRequest('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata)
    });
    
    sessionStorage.setItem(cacheKey, folder.id);
    return folder.id;
  };

  const listFilesInFolder = async (folderId: string): Promise<{id: string, name: string}[]> => {
    const q = `'${folderId}' in parents and trashed=false`;
    const data = await driveRequest(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1000`);
    return data.files || [];
  };

  const uploadGoogleDoc = async (title: string, htmlContent: string, folderId: string, existingFileId?: string) => {
    const metadata: any = { name: title, mimeType: 'application/vnd.google-apps.document' };
    if (!existingFileId) metadata.parents = [folderId];

    const boundary = '---gea_boundary_' + Date.now();
    const body = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      '',
      htmlContent,
      `--${boundary}--`
    ].join('\r\n');

    const url = existingFileId
      ? `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart`
      : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';

    return await driveRequest(url, {
      method: existingFileId ? 'PATCH' : 'POST',
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body
    });
  };

  const noteToHtml = (note: any): string => {
    const body = (note.body || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const paragraphs = body.split('\n').map((line: string) => 
      line.trim() ? `<p>${line}</p>` : '<br/>'
    ).join('\n');
    return `<html><body>
<h1>${(note.title || 'Untitled').replace(/</g, '&lt;')}</h1>
${paragraphs}
<hr/>
<p style="color:#888;font-size:10px;">Created: ${note.timestamp || 'Unknown'} · Folder: ${note.folder_name || 'N/A'} · ID: ${note.id}</p>
</body></html>`;
  };

  const uploadImageFile = async (fileName: string, b64Data: string, folderId: string, existingFileId?: string) => {
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

    return await driveRequest(url, {
      method: existingFileId ? 'PATCH' : 'POST',
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body
    });
  };

  const deleteFile = async (fileId: string) => {
    await driveRequest(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
      method: 'DELETE'
    }, false);
  };

  // --- Core sync logic: Destructive Mirror ---

  const syncNotesToDrive = async (rootId: string, emitProgress: (msg: string) => void) => {
    emitProgress('Dohvaćam lokalne bilješke...');
    const allNotes = await dbGetAll('notes');
    if (allNotes.length === 0) return;

    emitProgress('Pripremam strukturu direktorija za bilješke...');
    const grouped: Record<string, any[]> = {};
    for (const note of allNotes) {
      const folder = note.folder_name || 'Unsorted';
      if (!grouped[folder]) grouped[folder] = [];
      grouped[folder].push(note);
    }

    const existingFolders = await listFilesInFolder(rootId);
    const existingFolderMap: Record<string, string> = {};
    for (const f of existingFolders) existingFolderMap[f.name] = f.id;

    const syncedFolderNames = new Set<string>();
    for (const [folderName, notes] of Object.entries(grouped)) {
      syncedFolderNames.add(folderName);
      const folderId = await findOrCreateFolder(folderName, rootId);

      const existingFiles = await listFilesInFolder(folderId);
      const existingFileMap: Record<string, string> = {};
      for (const f of existingFiles) existingFileMap[f.name] = f.id;

      const syncedFileNames = new Set<string>();
      for (const note of notes) {
        const docTitleBase = (note.title || 'Untitled').replace(/[/\\?%*:"|<>]/g, '_');
        const htmlContent = noteToHtml(note);
        
        // Hash for differential sync
        const noteHash = await hashObject({ htmlContent, folder: note.folder_name });
        const docTitle = `${docTitleBase}_${noteHash}`;
        syncedFileNames.add(docTitle);

        if (!existingFileMap[docTitle]) {
          emitProgress(`Spremam bilješku: ${docTitleBase}...`);
          await uploadGoogleDoc(docTitle, htmlContent, folderId);
        }
      }

      // Cleanup old versions
      for (const [fileName, fileId] of Object.entries(existingFileMap)) {
        if (!syncedFileNames.has(fileName)) {
          emitProgress(`Brišem staru verziju: ${fileName}...`);
          await deleteFile(fileId);
        }
      }
    }

    for (const [folderName, folderId] of Object.entries(existingFolderMap)) {
      if (folderName !== 'Images' && !syncedFolderNames.has(folderName) && !folderName.startsWith('database_backup_')) {
        await deleteFile(folderId);
      }
    }
  };

  const syncImagesToDrive = async (rootId: string, emitProgress: (msg: string) => void) => {
    emitProgress('Dohvaćam lokalne slike...');
    const allImages = await dbGetAll('images');
    if (allImages.length === 0) return;

    const imagesRootId = await findOrCreateFolder('Images', rootId);
    const existingFolders = await listFilesInFolder(imagesRootId);

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
      const folderId = await findOrCreateFolder(folderName, imagesRootId);
      
      const existingFiles = await listFilesInFolder(folderId);
      const existingFileMap: Record<string, string> = {};
      for (const f of existingFiles) existingFileMap[f.name] = f.id;

      const syncedFileNames = new Set<string>();

      for (const img of images) {
        const baseName = img.filename || `gea_image`;
        // Since image ID implies immutability, we just use it as the hash basically
        const fileName = `${baseName}_${img.id}.png`;
        syncedFileNames.add(fileName);

        if (!existingFileMap[fileName]) {
           emitProgress(`Spremam sliku: ${fileName}...`);
           await uploadImageFile(fileName, img.full_b64, folderId);
        }
      }

      for (const [fileName, fileId] of Object.entries(existingFileMap)) {
        if (!syncedFileNames.has(fileName)) await deleteFile(fileId);
      }
    }

    // Delete empty month folders
    for (const [folderName, folderId] of Object.entries(existingFolderMap)) {
      if (!syncedFolderNames.has(folderName)) await deleteFile(folderId);
    }
  };

  const isSyncingRef = useRef(false);
  const queuedSyncRef = useRef(false);

  const syncDrive = useCallback(async () => {
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;
    setIsSyncing(true);
    console.log('[DRIVE] Manual sync initiated...');
    
    let lastTime = Date.now();
    const emitProgress = (msg: string) => {
      const now = Date.now();
      const diff = now - lastTime;
      lastTime = now;
      console.log(`[DRIVE_TIMING] +${diff}ms : ${msg}`);
      window.dispatchEvent(new CustomEvent('SYNC_PROGRESS', { detail: msg }));
    };

    try {
      const token = await getToken(true);
      console.log('[DRIVE] Token acquired:', token ? 'OK' : 'FAILED');

      if (token && !localStorage.getItem('gdrive_user')) {
        await fetchUserInfo(token);
      }

      emitProgress('Učitavam lokalnu bazu...');
      const notes = await dbGetAll('notes');
      const images = await dbGetAll('images');

      emitProgress('Tražim glavni direktorij...');
      const rootId = await findOrCreateFolder(GEA_ROOT_FOLDER);
      
      // --- AUTOMATIC BACKUP & RESTORE LOGIC ---
      if (notes.length === 0 && images.length === 0) {
        emitProgress('Lokalna baza je prazna! Tražim sigurnosnu kopiju na Drive-u...');
        const rootFiles = await listFilesInFolder(rootId);
        const backupFile = rootFiles.find(f => f.name.startsWith('database_backup_'));
        
        if (backupFile) {
          emitProgress('Pronađena sigurnosna kopija! Vraćam podatke...');
          try {
            const backupData = await driveRequest(`https://www.googleapis.com/drive/v3/files/${backupFile.id}?alt=media`);
            for (const n of backupData.notes || []) await dbPut('notes', n);
            for (const img of backupData.images || []) await dbPut('images', img);
            
            window.dispatchEvent(new CustomEvent('SHOW_TOAST', {detail: '✅ Baza podataka je uspješno vraćena! Osvježavam aplikaciju...'}));
            setTimeout(() => window.location.reload(), 1500);
            return;
          } catch (e) {
            console.error('Failed to restore backup', e);
            window.dispatchEvent(new CustomEvent('SHOW_TOAST', {detail: '❌ Greška pri vraćanju baze!'}));
          }
        } else {
          emitProgress('Nema sigurnosne kopije. Nastavljam s praznom bazom...');
        }
      }

      // Backup current DB state silently
      emitProgress('Spremam sigurnosnu kopiju baze...');
      try {
        const backupJson = JSON.stringify({ notes, images });
        const backupHash = await hashObject({ backupJson });
        const backupFilename = `database_backup_${backupHash}.json`;
        const rootFiles = await listFilesInFolder(rootId);
        const oldBackup = rootFiles.find(f => f.name.startsWith('database_backup_'));
        
        if (!oldBackup || oldBackup.name !== backupFilename) {
          if (oldBackup) await deleteFile(oldBackup.id);
          
          const metadata: any = { name: backupFilename, parents: [rootId] };
          const boundary = '---gea_boundary_' + Date.now();
          const body = [
            `--${boundary}`,
            'Content-Type: application/json; charset=UTF-8',
            '',
            JSON.stringify(metadata),
            `--${boundary}`,
            'Content-Type: application/json; charset=UTF-8',
            '',
            backupJson,
            `--${boundary}--`
          ].join('\r\n');

          await driveRequest('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
            method: 'POST',
            headers: {
              'Content-Type': `multipart/related; boundary=${boundary}`
            },
            body
          });
        }
      } catch (e) {
        console.warn('Failed to upload JSON backup', e);
      }
      
      // Sync Notes
      await syncNotesToDrive(rootId, emitProgress);
      
      // Sync Images
      await syncImagesToDrive(rootId, emitProgress);
      
      emitProgress('Sinkronizacija završena!');
      console.log('[DRIVE] Manual sync complete!');
      window.dispatchEvent(new CustomEvent('SHOW_TOAST', {detail: '✅ Notes & Images synced to Google Drive!'}));
    } catch (e: any) {
      console.error('[DRIVE] Manual sync error:', e);
      window.dispatchEvent(new CustomEvent('SHOW_TOAST', {detail: '❌ Drive Error: ' + e.message}));
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
          console.log('[DRIVE SYNC] No cached token — skipping silently.');
          return;
        }

        if (token && !localStorage.getItem('gdrive_user')) {
          await fetchUserInfo(token);
        }

        const emitProgress = (msg: string) => {
          console.log(`[SILENT_SYNC] : ${msg}`);
          window.dispatchEvent(new CustomEvent('SYNC_PROGRESS', { detail: msg }));
        };

        const notes = await dbGetAll('notes');
        const images = await dbGetAll('images');
        const rootId = await findOrCreateFolder(GEA_ROOT_FOLDER);

        if (notes.length > 0 || images.length > 0) {
          try {
            const backupJson = JSON.stringify({ notes, images });
            const backupHash = await hashObject({ backupJson });
            const backupFilename = `database_backup_${backupHash}.json`;
            const rootFiles = await listFilesInFolder(rootId);
            const oldBackup = rootFiles.find(f => f.name.startsWith('database_backup_'));
            
            if (!oldBackup || oldBackup.name !== backupFilename) {
              if (oldBackup) await deleteFile(oldBackup.id);
              
              const metadata: any = { name: backupFilename, parents: [rootId] };
              const boundary = '---gea_boundary_' + Date.now();
              const body = [
                `--${boundary}`,
                'Content-Type: application/json; charset=UTF-8',
                '',
                JSON.stringify(metadata),
                `--${boundary}`,
                'Content-Type: application/json; charset=UTF-8',
                '',
                backupJson,
                `--${boundary}--`
              ].join('\r\n');

              await driveRequest('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
                method: 'POST',
                headers: {
                  'Content-Type': `multipart/related; boundary=${boundary}`
                },
                body
              });
            }
          } catch (e) {
            console.warn('Failed to upload JSON backup during silent sync', e);
          }
        }

        await syncNotesToDrive(rootId, emitProgress);
        await syncImagesToDrive(rootId, emitProgress);
        
        console.log('🔄 [DRIVE SYNC] Silent auto-sync complete.');
        window.dispatchEvent(new CustomEvent('SHOW_TOAST', {detail: '✅ Auto-synced!'}));
      } while (queuedSyncRef.current);
    } catch (e: any) {
      // DON'T clear the token here — only driveRequest's 401 handler should do that.
      // Network errors, timeouts, etc. are transient and shouldn't kill future syncs.
      console.warn('[DRIVE SYNC] Silent sync failed:', e.message);
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
