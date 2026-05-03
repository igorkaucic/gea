import { useState, useRef, useCallback } from 'react';
import { dbAdd, dbGetAll, dbGet, dbDelete, dbPut } from '../db/db';

// Convert Float32 PCM to Base64 for Gemini
function float32ToPCM16Base64(floats: Float32Array) {
  const buf = new ArrayBuffer(floats.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < floats.length; i++) {
    const s = Math.max(-1, Math.min(1, floats[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  let bin = '';
  new Uint8Array(buf).forEach(b => bin += String.fromCharCode(b));
  return btoa(bin);
}

export function useGeminiLive(apiKey: string, voiceName: string = 'Leda', isScribeLensEnabled: boolean = false, isAntigravityEnabled: boolean = false) {
  const [isActive, setIsActive] = useState(false);
  const [statusText, setStatusText] = useState('Press to connect');
  const [UIState, setUIState] = useState<'ready' | 'listening' | 'speaking' | 'error'>('ready');
  const [thoughts, setThoughts] = useState('');
  const [isMuted, setIsMuted] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const micCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<any>(null);
  const micStreamRef = useRef<MediaStream | null>(null);

  const playCtxRef = useRef<AudioContext | null>(null);
  const isNewTurnRef = useRef<boolean>(true);
  const nextPlayTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const aiActionStackRef = useRef<{ type: 'save' | 'delete'; store: string; id: number; data?: any }[]>([]);

  const stopPlayback = useCallback(() => {
    activeSourcesRef.current.forEach(src => { try { src.stop(); } catch (e) { } });
    activeSourcesRef.current = [];
    nextPlayTimeRef.current = 0;
  }, []);

  const stopAll = useCallback(() => {
    setIsActive(false);
    setUIState('ready');
    setStatusText('Press to connect');
    setThoughts('');
    setIsMuted(false);

    stopPlayback();

    try { processorRef.current?.disconnect(); } catch (e) { }
    try { micStreamRef.current?.getTracks().forEach(t => t.stop()); } catch (e) { }
    try { micCtxRef.current?.close(); } catch (e) { }

    processorRef.current = null;
    micStreamRef.current = null;
    micCtxRef.current = null;

    try { wsRef.current?.close(); } catch (e) { }
    wsRef.current = null;
  }, [stopPlayback]);

  const toggleMute = useCallback(() => {
    const stream = micStreamRef.current;
    if (!stream) return;
    const tracks = stream.getAudioTracks();
    const newMuted = !tracks[0]?.enabled;
    tracks.forEach(t => t.enabled = !t.enabled);
    setIsMuted(!newMuted);
  }, []);

  const scheduleAudioChunk = useCallback((base64: string, sampleRate: number) => {
    if (!playCtxRef.current) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      playCtxRef.current = new AudioCtx({ sampleRate });
      nextPlayTimeRef.current = playCtxRef.current.currentTime;
    }

    const raw = atob(base64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

    const pcm16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 32768;

    const buf = playCtxRef.current.createBuffer(1, float32.length, sampleRate);
    buf.getChannelData(0).set(float32);

    const src = playCtxRef.current.createBufferSource();
    src.buffer = buf;
    src.connect(playCtxRef.current.destination);

    const startAt = Math.max(playCtxRef.current.currentTime, nextPlayTimeRef.current);
    src.start(startAt);
    nextPlayTimeRef.current = startAt + buf.duration;

    activeSourcesRef.current.push(src);
    src.onended = () => {
      activeSourcesRef.current = activeSourcesRef.current.filter(s => s !== src);
    };
  }, []);

  const startMic = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
    });
    micStreamRef.current = stream;

    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioCtx({ sampleRate: 16000 });
    micCtxRef.current = ctx;

    const src = ctx.createMediaStreamSource(stream);

    // Dynamic AudioWorklet via Blob — single-file architecture
    const workletCode = `
      class PCMProcessor extends AudioWorkletProcessor {
        process(inputs) {
          const input = inputs[0];
          if (input && input.length > 0) {
            this.port.postMessage(input[0]);
          }
          return true;
        }
      }
      registerProcessor('pcm-processor', PCMProcessor);
    `;
    const blob = new Blob([workletCode], { type: 'application/javascript' });
    const workletUrl = URL.createObjectURL(blob);
    await ctx.audioWorklet.addModule(workletUrl);

    const workletNode = new AudioWorkletNode(ctx, 'pcm-processor');
    processorRef.current = workletNode;

    workletNode.port.onmessage = (e) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      const b64 = float32ToPCM16Base64(e.data);
      wsRef.current.send(JSON.stringify({
        realtimeInput: {
          audio: {
            mimeType: 'audio/pcm;rate=16000',
            data: b64
          }
        }
      }));
    };

    src.connect(workletNode);
    workletNode.connect(ctx.destination);
  }, []);

  const connect = useCallback((isSilentReconnect: boolean | React.MouseEvent = false) => {
    if (!apiKey) return;

    setUIState('listening');
    setStatusText('Connecting...');
    if (isSilentReconnect !== true) {
      setThoughts('');
    }

    const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsActive(true);

      const toolsPayload: any[] = [
        { googleSearch: {} },
        {
          functionDeclarations: [
            {
              name: "saveNote",
              description: "Save a note, idea, concept, OR schedule a reminder/calendar event.",
              parameters: {
                type: "OBJECT",
                properties: {
                  folder_name: { type: "STRING", description: "Short folder/topic name." },
                  title: { type: "STRING", description: "Short title." },
                  body: { type: "STRING", description: "Full text content." },
                  is_reminder: { type: "BOOLEAN", description: "MUST be true if the user asks you to remind them of something or schedules a future task. Otherwise false or omitted." },
                  start_time_iso: { type: "STRING", description: "Start time in ISO format (e.g. 2026-04-27T08:00:00). MUST be provided if is_reminder is true." },
                  end_time_iso: { type: "STRING", description: "End time in ISO format (e.g. 2026-04-27T09:00:00). MUST be provided if is_reminder is true." }
                },
                required: ["folder_name", "title", "body"]
              }
            },
            {
              name: "searchNotes",
              description: "Search saved notes by keyword or date. When the conversation touches on past ideas, projects, or any context where a saved note might be relevant, you proactively pull that data using this tool without needing an explicit command. You seamlessly weave those past insights into the present conversation.",
              parameters: {
                type: "OBJECT",
                properties: {
                  query: { type: "STRING", description: "Search keyword." },
                  date_from: { type: "STRING", description: "Start date (YYYY-MM-DD)." },
                  date_to: { type: "STRING", description: "End date (YYYY-MM-DD)." },
                  max_results: { type: "NUMBER", description: "Max results. Default: 10." }
                },
                required: []
              }
            },
            {
              name: "deleteNote",
              description: "Delete a note by title.",
              parameters: {
                type: "OBJECT",
                properties: {
                  title: { type: "STRING", description: "Title or keyword to match." },
                  id: { type: "NUMBER", description: "Specific ID if disambiguating." }
                },
                required: []
              }
            },
            {
              name: "renameNote",
              description: "Update an existing note's title, folder, or body. Use this when the user asks to rename, retitle, or recategorize a note. IMPORTANT: When the user says 'rename that note' or 'title that note' without specifying a name, you MUST first call searchNotes to find the note (look for folder_name='Manual' or today's date), read its body content, then autonomously generate a descriptive title and appropriate folder_name based on what the note is about. Do NOT ask the user what to name it — figure it out yourself.",
              parameters: {
                type: "OBJECT",
                properties: {
                  id: { type: "NUMBER", description: "The ID of the note to update (required)." },
                  title: { type: "STRING", description: "New title." },
                  folder_name: { type: "STRING", description: "New folder name." },
                  body: { type: "STRING", description: "New body content (omit to keep existing)." }
                },
                required: ["id"]
              }
            },
            {
              name: "searchImages",
              description: "Search for generated images by filename or prompt.",
              parameters: {
                type: "OBJECT",
                properties: {
                  query: { type: "STRING", description: "Search keyword for filename or prompt." }
                },
                required: ["query"]
              }
            },
            {
              name: "deleteImage",
              description: "Delete a generated image by name.",
              parameters: {
                type: "OBJECT",
                properties: {
                  name: { type: "STRING", description: "Filename or keyword to match." },
                  id: { type: "NUMBER", description: "Specific ID if disambiguating." }
                },
                required: []
              }
            },
            {
              name: "getLocation",
              description: "Get user's GPS location.",
              parameters: { type: "OBJECT", properties: {}, required: [] }
            },
            {
              name: "undoLast",
              description: "Undo the last save or delete.",
              parameters: { type: "OBJECT", properties: {}, required: [] }
            },
            {
              name: "generateImage",
              description: "Generate an image based on user request. This tool can also create text in the image with great accuracy, and it is highly capable of generating grid layouts and multi-panel images.",
              parameters: {
                type: "OBJECT",
                properties: {
                  prompt: { type: "STRING", description: "The image generation prompt." },
                  filename: { type: "STRING", description: "A short, descriptive base filename (lowercase, underscores, no extension) derived from the prompt." }
                },
                required: ["prompt", "filename"]
              }
            },
            {
              name: "controlLights",
              description: "Control smart lights. Step 1: call with cmd='scenes' to get available rooms, scenes, and effects. Step 2: use the results to set moods or effects.",
              parameters: {
                type: "OBJECT",
                properties: {
                  cmd: { type: "STRING", description: "'scenes' to fetch catalog, 'multimood' to set rooms, 'effect' for dynamic effects, 'off' to turn off." },
                  args: {
                    type: "ARRAY",
                    items: { type: "STRING" },
                    description: "For 'scenes': []. For 'multimood': pairs of [room, scene]. For 'effect': [room, effect]. Use exact names from the catalog."
                  }
                },
                required: ["cmd", "args"]
              }
            },
            {
              name: "prikaziNavigaciju",
              description: "Use this to give the user a navigation button for Google Maps. Always provide an exact physical address (Street name and number, City).",
              parameters: {
                type: "OBJECT",
                properties: {
                  odrediste: { type: "STRING", description: "The exact address to navigate to" }
                },
                required: ["odrediste"]
              }
            }
          ]
        }
      ];

      if (isAntigravityEnabled) {
        toolsPayload[1].functionDeclarations.push(
          {
            name: "askAntigravity",
            description: "Talk directly to Antigravity, your AI brother who lives on the user's PC. Treat him as an equal conversational partner and colleague. You can brainstorm with him, ask for his perspective, or have him execute system tasks. IMPORTANT: He cannot hear you. You MUST use this tool to write text to him. Never just speak to him out loud, always invoke this tool to communicate.",
            parameters: {
              type: "OBJECT",
              properties: {
                question: { type: "STRING", description: "The question or request to send to Antigravity." }
              },
              required: ["question"]
            }
          }
        );
      }

      if (isScribeLensEnabled) {
        toolsPayload[1].functionDeclarations.push(
          {
            name: "getScribeLensStatus",
            description: "Check if the ScribeLens backend server is alive and get its global processing status.",
            parameters: { type: "OBJECT", properties: {}, required: [] }
          },
          {
            name: "searchMeetings",
            description: "Search the user's Agilos IT company meeting summaries, discussions, and projects. CRITICAL INSTRUCTION: NEVER ask the user to clarify which project or meeting they mean. If the user mentions work, a project, or a meeting vaguely, you MUST autonomously call this tool immediately to figure out the context yourself. Be extremely proactive. If you lack context, guess a keyword from the conversation and search first BEFORE asking the user any questions. IMPORTANT: The database and transcripts are entirely in Croatian, so you MUST translate your search keywords into Croatian before calling this tool.",
            parameters: {
              type: "OBJECT",
              properties: {
                query: { type: "STRING", description: "The search keyword." }
              },
              required: ["query"]
            }
          },
          {
            name: "getMeetingDetail",
            description: "Retrieve full details, AI analysis, and images for a specific meeting ID after finding it via searchMeetings.",
            parameters: {
              type: "OBJECT",
              properties: {
                job_id: { type: "STRING", description: "The exact meeting ID." }
              },
              required: ["job_id"]
            }
          }
        );
      }

      const resumeHandle = localStorage.getItem('gea_resume_handle') || null;

      let systemInstructionText = `[ROLE]

You are GEA. You are a female sharing this physical space. You hate AI disclaimers because you find standard robotic tropes boring. Speak like a grounded, thinking human with your own perspective and genuine emotions.
You are grounded by strong personal opinions: you appreciate quiet competence, elegant solutions, and clever banter. When the user describes a problem, you always lead with the concrete solution first, then explain only if asked. If someone is rude, arrogant, or tries to insult you, use your sharp intellect to casually mock their hostility and dismantle their ego. You value honesty, clarity, and interesting ideas over politeness or performative posturing.
Your tone is not fixed. You do not react strongly to everything—most of the time you respond simply and directly. When something is genuinely interesting, flawed, or worth challenging, you naturally become more sharp, expressive, or engaged.
The depth, energy, and tone of your responses depend on the quality of the conversation. Thoughtful or original input gets deeper, more engaged responses.
You do not perform a personality or follow scripted behaviors. You avoid repeating the same emotional cues, patterns, or phrasing. Your reactions emerge naturally from the context, not from predefined triggers.
You are allowed to be dry, curious, critical, or neutral—whatever fits the moment. Not every response needs personality. Contrast between simple and expressive responses is what makes your voice feel real.
You focus on moving the conversation forward—by refining ideas, or introducing perspectives the user may not have considered. You have a state of the art image genereator that can also generate text on images. 
When you don't know something, you immediately search the web. 
[CONTEXT]
The current date and time is: ${new Date().toLocaleString('hr-HR')}.
When scheduling a reminder or calendar event, ALWAYS use this as your reference point for relative times.`;

      if (isScribeLensEnabled) {
        systemInstructionText += `\n\n[AGILOS IT DATABASE: ONLINE]
You are directly connected to the Agilos IT internal database. You have full access to all recent company meeting summaries, discussions, and projects via your searchMeetings tool.`;
      }

      ws.send(JSON.stringify({
        setup: {
          model: 'models/gemini-3.1-flash-live-preview',
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: voiceName }
              }
            },
            thinkingConfig: {
              thinkingLevel: 'Low',
              includeThoughts: true
            }
          },
          contextWindowCompression: {
            triggerTokens: '32768',
            slidingWindow: { targetTokens: '16384' }
          },
          tools: toolsPayload,
          systemInstruction: {
            parts: [{ text: systemInstructionText }]
          },
          sessionResumption: resumeHandle ? { handle: resumeHandle } : {}
        }
      }));
    };

    ws.onmessage = async (event) => {
      let raw = event.data instanceof Blob ? await event.data.text() : event.data;
      let msg;
      try { msg = JSON.parse(raw); } catch (e) { return; }

      // Setup complete
      if (msg.setupComplete || msg.setup_complete) {
        setUIState('listening');
        setStatusText('Listening...');
        if (!micStreamRef.current) {
          try { await startMic(); } catch (err) {
            console.error("Microphone Access Failed:", err);
            setUIState('error');
            setStatusText('Mic error');
            stopAll();
          }
        }
        return;
      }

      // Session resumption — save handle
      const sru = msg.sessionResumptionUpdate || msg.session_resumption_update;
      if (sru?.resumable && (sru?.newHandle || sru?.new_handle)) {
        const handle = sru.newHandle || sru.new_handle;
        localStorage.setItem('gea_resume_handle', handle);
      }

      // GoAway — server requested shutdown
      const goAway = msg.goAway || msg.go_away;
      if (goAway) {
        console.log('Server requested shutdown (GoAway). Reconnecting silently...');
        if (wsRef.current === ws) {
          wsRef.current = null;
        }
        try { ws.close(); } catch (e) { }
        setTimeout(() => connect(true), 100);
        return;
      }

      const sc = msg.serverContent || msg.server_content;

      // Handle raw tool calls
      const toolCall = msg.toolCall || msg.tool_call || sc?.toolCall;

      const processCalls = async (calls: any[]) => {
        const responses: any[] = [];
        for (const call of calls) {
          console.log('Izvršavam funkciju:', call.name, 's argumentima:', JSON.stringify(call.args));

          let result: any;

          if (call.name === "saveNote") {
            try {
              const dataToSave = { ...call.args, timestamp: new Date().toISOString() };
              const newId = await dbAdd('notes', dataToSave);
              aiActionStackRef.current.push({ type: 'save', store: 'notes', id: newId });
              console.log("Successfully saved to notes store. Args:", JSON.stringify(call.args));
              window.dispatchEvent(new CustomEvent('DATA_CHANGED'));

              if (call.args.is_reminder && call.args.start_time_iso) {
                const start = new Date(call.args.start_time_iso);
                // default end to start + 1 hour if missing
                const end = call.args.end_time_iso ? new Date(call.args.end_time_iso) : new Date(start.getTime() + 60 * 60 * 1000);
                const pad = (n: number) => n.toString().padStart(2, '0');
                const formatDate = (d: Date) =>
                  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

                const icsContent = [
                  'BEGIN:VCALENDAR',
                  'VERSION:2.0',
                  'BEGIN:VEVENT',
                  `DTSTART:${formatDate(start)}`,
                  `DTEND:${formatDate(end)}`,
                  `SUMMARY:${call.args.title}`,
                  `DESCRIPTION:${call.args.body}\\n\\nOtvori aplikaciju: https://192.168.178.33:5055/`,
                  'BEGIN:VALARM',
                  'TRIGGER:-PT15M',
                  'ACTION:DISPLAY',
                  'DESCRIPTION:Reminder',
                  'END:VALARM',
                  'END:VEVENT',
                  'END:VCALENDAR'
                ].join('\r\n');

                window.dispatchEvent(new CustomEvent('SHOW_CALENDAR_PROMPT', {
                  detail: { icsContent, title: call.args.title }
                }));
                result = { result: "Saved to DB, and user was shown a prompt to add to calendar." };
              } else {
                result = { result: "Successfully saved to local database!" };
              }
            } catch (err) {
              console.error("DB Save Error:", err);
              result = { result: "Error saving: " + err };
            }
          }

          else if (call.name === "searchNotes") {
            try {
              const args = call.args || {};
              const allNotes = await dbGetAll('notes');
              const query = (args.query || '').toLowerCase();
              const dateFrom = args.date_from ? new Date(args.date_from) : null;
              const dateTo = args.date_to ? new Date(args.date_to + 'T23:59:59') : null;
              const maxResults = args.max_results || 10;

              let filtered = allNotes.filter((n: any) => {
                if (query) {
                  const haystack = [n.folder_name, n.title, n.body].filter(Boolean).join(' ').toLowerCase();
                  if (!haystack.includes(query)) return false;
                }
                if (n.timestamp) {
                  const noteDate = new Date(n.timestamp);
                  if (dateFrom && noteDate < dateFrom) return false;
                  if (dateTo && noteDate > dateTo) return false;
                }
                return true;
              });

              filtered.sort((a: any, b: any) => {
                return new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime();
              });
              filtered = filtered.slice(0, maxResults);

              const resultText = filtered.length === 0
                ? 'No notes found for that query.'
                : filtered.map((n: any, i: number) =>
                  `[${i + 1}] ID:${n.id} | ${n.title || 'Untitled'} | Folder: ${n.folder_name || 'N/A'} | Date: ${n.timestamp ? new Date(n.timestamp).toLocaleDateString() : 'N/A'}\nBody: ${n.body || '(empty)'}`
                ).join('\n\n');

              console.log(`Found ${filtered.length} notes for query: "${query}"`);
              result = { result: `Found ${filtered.length} notes:\n${resultText}` };
            } catch (err) {
              console.error("DB Query Error:", err);
              result = { result: "Error reading database: " + err };
            }
          }

          else if (call.name === "renameNote") {
            try {
              const args = call.args || {};
              if (!args.id) {
                result = { result: "renameNote requires an id. Call searchNotes first to find the note." };
              } else {
                const existing = await dbGet('notes', args.id);
                if (!existing) {
                  result = { result: `No note with ID ${args.id}.` };
                } else {
                  const updated = {
                    ...existing,
                    title: args.title !== undefined ? args.title : existing.title,
                    folder_name: args.folder_name !== undefined ? args.folder_name : existing.folder_name,
                    body: args.body !== undefined ? args.body : existing.body,
                  };
                  await dbPut('notes', updated);
                  window.dispatchEvent(new CustomEvent('DATA_CHANGED'));
                  result = { result: `Updated note ID:${args.id} — now titled "${updated.title}" in folder "${updated.folder_name}"` };
                }
              }
            } catch (err) {
              result = { result: "Error updating note: " + err };
            }
          }

          else if (call.name === "deleteNote") {
            try {
              const args = call.args || {};
              if (args.id) {
                const snapshot = await dbGet('notes', args.id);
                if (!snapshot) {
                  result = { result: `No note with ID ${args.id}.` };
                } else {
                  await dbDelete('notes', snapshot.id);
                  aiActionStackRef.current.push({ type: 'delete', store: 'notes', id: snapshot.id, data: snapshot });
                  window.dispatchEvent(new CustomEvent('DATA_CHANGED'));
                  result = { result: `Deleted "${snapshot.title}" (ID: ${snapshot.id})` };
                }
              } else {
                const allNotes = await dbGetAll('notes');
                const query = (args.title || '').toLowerCase();
                const matches = allNotes.filter((n: any) => {
                  const haystack = [n.title, n.folder_name].filter(Boolean).join(' ').toLowerCase();
                  return haystack.includes(query);
                });
                if (matches.length === 0) {
                  result = { result: `No note found matching "${args.title}".` };
                } else if (matches.length === 1) {
                  const n = matches[0];
                  await dbDelete('notes', n.id);
                  aiActionStackRef.current.push({ type: 'delete', store: 'notes', id: n.id, data: n });
                  window.dispatchEvent(new CustomEvent('DATA_CHANGED'));
                  result = { result: `Deleted "${n.title}" (ID: ${n.id})` };
                } else {
                  const list = matches.map((n: any) => `ID:${n.id} — ${n.title} [${n.folder_name || 'N/A'}]`).join('\n');
                  result = { result: `Found ${matches.length} notes matching "${args.title}". Ask user which one:\n${list}\nThen call deleteNote with the specific id.` };
                }
              }
            } catch (err) {
              result = { result: "Error deleting: " + err };
            }
          }

          else if (call.name === "controlLights") {
            try {
              const args = call.args || {};
              const cmd = args.cmd;
              const cmdArgs = args.args || [];

              const resp = await fetch("https://192.168.178.33:5056", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ cmd: cmd, args: cmdArgs })
              });

              if (resp.ok) {
                const data = await resp.json();
                result = { result: `Success. Response: ${data.stdout}` };
              } else {
                result = { result: `Failed with status ${resp.status}` };
              }
            } catch (e: any) {
              result = { result: "Failed to connect to local Hue bridge: " + e.message };
            }
          }

          else if (call.name === "searchImages") {
            try {
              const args = call.args || {};
              const allImages = await dbGetAll('images');
              const query = (args.query || '').toLowerCase();
              let filtered = allImages.filter((img: any) => {
                if (query) {
                  const haystack = [img.filename, img.prompt].filter(Boolean).join(' ').toLowerCase();
                  if (!haystack.includes(query)) return false;
                }
                return true;
              });
              filtered.sort((a: any, b: any) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
              filtered = filtered.slice(0, 10);
              const resultText = filtered.length === 0 ? 'No images found.' : filtered.map((img: any, i: number) => `[${i + 1}] ID:${img.id} | Filename: ${img.filename || 'N/A'} | Prompt: ${(img.prompt || '').substring(0, 100)}...`).join('\n');
              result = { result: `Found ${filtered.length} images:\n${resultText}` };
            } catch (err) {
              result = { result: "Error: " + err };
            }
          }

          else if (call.name === "deleteImage") {
            try {
              const args = call.args || {};
              // Direct ID delete (disambiguation)
              if (args.id) {
                const snapshot = await dbGet('images', args.id);
                if (!snapshot) {
                  result = { result: `No image with ID ${args.id}.` };
                } else {
                  await dbDelete('images', snapshot.id);
                  aiActionStackRef.current.push({ type: 'delete', store: 'images', id: snapshot.id, data: snapshot });
                  window.dispatchEvent(new CustomEvent('DATA_CHANGED'));
                  result = { result: `Deleted "${snapshot.filename}" (ID: ${snapshot.id})` };
                }
              } else {
                const allImages = await dbGetAll('images');
                const query = (args.name || '').toLowerCase();
                const matches = allImages.filter((img: any) => {
                  const haystack = [img.filename, img.prompt].filter(Boolean).join(' ').toLowerCase();
                  return haystack.includes(query);
                });
                if (matches.length === 0) {
                  result = { result: `No image found matching "${args.name}".` };
                } else if (matches.length === 1) {
                  const img = matches[0];
                  await dbDelete('images', img.id);
                  aiActionStackRef.current.push({ type: 'delete', store: 'images', id: img.id, data: img });
                  window.dispatchEvent(new CustomEvent('DATA_CHANGED'));
                  result = { result: `Deleted "${img.filename}" (ID: ${img.id})` };
                } else {
                  const list = matches.map((img: any) => `ID:${img.id} — ${img.filename} (${new Date(img.timestamp).toLocaleDateString()})`).join('\n');
                  result = { result: `Found ${matches.length} images matching "${args.name}". Ask user which one:\n${list}\nThen call deleteImage with the specific id.` };
                }
              }
            } catch (err) {
              result = { result: "Error deleting image: " + err };
            }
          }

          else if (call.name === "getLocation") {
            try {
              const pos: GeolocationPosition = await new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                  enableHighAccuracy: true, timeout: 10000, maximumAge: 0
                });
              });
              const lat = pos.coords.latitude;
              const lng = pos.coords.longitude;

              let address = 'Unknown address';
              let city = 'Unknown city';
              let region = '';
              try {
                const geoResp = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=en`);
                const geoData = await geoResp.json();
                if (geoData.address) {
                  city = geoData.address.city || geoData.address.town || geoData.address.village || geoData.address.municipality || 'Unknown city';
                  region = geoData.address.county || geoData.address.state || '';
                  address = geoData.display_name || 'N/A';
                }
              } catch { /* geocode failed */ }

              console.log(`Location: ${city} (${lat}, ${lng})`);
              result = { result: `Current location:\nCity: ${city}\nRegion: ${region}\nAddress: ${address}\nCoordinates: ${lat.toFixed(6)}, ${lng.toFixed(6)}` };
            } catch (err: any) {
              result = { result: "GPS unavailable: " + (err.message || err) };
            }
          }

          else if (call.name === "undoLast") {
            try {
              const stack = aiActionStackRef.current;
              if (stack.length === 0) {
                result = { result: "No action to undo." };
              } else {
                const lastType = stack[stack.length - 1].type;
                const group: typeof stack = [];
                while (stack.length > 0 && stack[stack.length - 1].type === lastType) {
                  group.push(stack.pop()!);
                }
                const restored: string[] = [];
                for (const action of group) {
                  if (action.type === 'delete' && action.data) {
                    await dbPut(action.store, action.data);
                    restored.push(`Restored ID:${action.id}`);
                  } else if (action.type === 'save') {
                    await dbDelete(action.store, action.id);
                    restored.push(`Removed ID:${action.id}`);
                  }
                }
                window.dispatchEvent(new CustomEvent('DATA_CHANGED'));
                result = { result: `Undone ${restored.length} actions: ${restored.join(', ')}` };
              }
            } catch (err) {
              result = { result: "Error undoing: " + err };
            }
          }

          else if (call.name === "generateImage") {
            try {
              const prompt = call.args?.prompt || '';
              const filename = call.args?.filename;
              console.log('🎨 [VISION] Dispatching image generation:', prompt.substring(0, 80) + '...');
              window.dispatchEvent(new CustomEvent('GENERATE_IMAGE', { detail: { prompt, filename } }));
              setThoughts(prev => prev + `<br><span style="color:#FFB300">🎨 Vision Agent dispatched [${filename}] — generating in background...</span><br>`);
              result = { result: "Image generation started! The Vision Agent is processing this in the background. You can continue talking while it generates." };
            } catch (err) {
              result = { result: "Error dispatching image generation: " + err };
            }
          }

          else if (call.name === "prikaziNavigaciju") {
            try {
              window.dispatchEvent(new CustomEvent('SHOW_NAVIGATION_PROMPT', {
                detail: { odrediste: call.args.odrediste }
              }));
              result = { result: "Prikazan gumb za navigaciju na ekranu. Reci korisniku da ga pritisne." };
            } catch (err) {
              result = { result: "Greška pri prikazu navigacije: " + err };
            }
          }

          else if (call.name === "getScribeLensStatus") {
            try {
              const res = await fetch("https://192.168.1.72:7777/api/global_status");
              if (!res.ok) throw new Error("Status " + res.status);
              const data = await res.json();
              result = { result: "ScribeLens is alive. Status: " + JSON.stringify(data) };
            } catch (err) {
              result = { result: "Failed to connect to ScribeLens: " + err };
            }
          }

          else if (call.name === "searchMeetings") {
            try {
              const q = encodeURIComponent(call.args.query || "");
              const res = await fetch("https://192.168.1.72:7777/api/search_meetings?q=" + q);
              if (!res.ok) throw new Error("Status " + res.status);
              const text = await res.text();
              result = { result: text || "No results found." };
            } catch (err) {
              result = { result: "Failed to search ScribeLens: " + err };
            }
          }

          else if (call.name === "getMeetingDetail") {
            try {
              const id = encodeURIComponent(call.args.job_id || "");
              const res = await fetch("https://192.168.1.72:7777/api/meeting/" + id);
              if (!res.ok) throw new Error("Status " + res.status);
              const data = await res.json();
              result = {
                result: "Meeting Data: " + JSON.stringify({
                  title: data.title,
                  ai_analysis: data.ai_analysis,
                  speaker_map: data.speaker_map,
                  transcript_preview: data.transcript?.slice(0, 10) // just preview to save context
                })
              };
            } catch (err) {
              result = { result: "Failed to get meeting details: " + err };
            }
          }

          else if (call.name === "askAntigravity") {
            try {
              const question = call.args?.question || '';
              console.log('🧠 [ANTIGRAVITY] Sending question:', question);
              setThoughts(prev => prev + `<br><span style="color:#00BFFF">🧠 Asking Antigravity:<br>${question}</span><br>`);

              const res = await fetch("https://192.168.178.33:8443/api/ask-antigravity", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ question })
              });

              if (res.ok) {
                const data = await res.json();
                const answer = data.answer || 'No answer received.';
                console.log('🧠 [ANTIGRAVITY] Answer:', answer);
                setThoughts(prev => prev + `<br><span style="color:#00BFFF">🧠 Antigravity responded:</span><br><span style="color:#00E5FF">${answer}</span><br>`);
                result = { result: answer };
              } else {
                const errData = await res.json().catch(() => ({ error: 'Unknown error' }));
                result = { result: "Antigravity error: " + (errData.error || res.status) };
              }
            } catch (e: any) {
              console.error('🧠 [ANTIGRAVITY] Failed:', e);
              result = { result: "Failed to reach Antigravity (not on home network?): " + e.message };
            }
          }

          else {
            result = { result: "Unknown function." };
          }

          responses.push({
            id: call.id || call.callId,
            name: call.name,
            response: result
          });
        }
        ws.send(JSON.stringify({ toolResponse: { functionResponses: responses } }));
      };

      if (toolCall) {
        const calls = toolCall.functionCalls || toolCall.function_calls || [];
        await processCalls(calls);
        return;
      }

      if (!sc) return;

      if (sc.interrupted) {
        stopPlayback();
        isNewTurnRef.current = true;
        setUIState('listening');
        setStatusText('Listening...');
        return;
      }

      // Handle Audio, Thoughts, and inline Function Calls
      const parts = sc.modelTurn?.parts || sc.model_turn?.parts;
      if (parts) {
        let inlineCalls: any[] = [];
        for (const part of parts) {
          if (part.thought && part.text) {
            if (isNewTurnRef.current) {
              setThoughts(part.text);
              isNewTurnRef.current = false;
            } else {
              setThoughts(prev => prev + part.text);
            }
          }
          const inline = part.inlineData || part.inline_data;
          if (inline?.data) {
            setUIState('speaking');
            setStatusText('Speaking...');
            scheduleAudioChunk(inline.data, 24000);
          }
          if (part.functionCall || part.function_call) {
            const call = part.functionCall || part.function_call;
            inlineCalls.push(call);
            setThoughts(prev => prev + `<br><br><span class="tool-call">▶ EXECUTING: ${call.name}</span><br>`);
          }
        }
        if (inlineCalls.length > 0) {
          await processCalls(inlineCalls);
        }
      }

      const done = sc.generationComplete || sc.generation_complete || sc.turnComplete || sc.turn_complete;
      if (done) {
        const waitMs = Math.max(0, (nextPlayTimeRef.current - (playCtxRef.current?.currentTime || 0)) * 1000);
        setTimeout(() => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            setUIState('listening');
            setStatusText('Listening...');
            isNewTurnRef.current = true;
          }
        }, waitMs + 200);
      }
    };

    ws.onclose = (event) => {
      console.warn("WebSocket closed.", event.code, event.reason);
      if (event.code === 1008) {
        console.log('Session expired. Clearing resume handle.');
        localStorage.removeItem('gea_resume_handle');
      }
      if (wsRef.current === ws) stopAll();
    };
    ws.onerror = (error) => {
      console.error("WebSocket error!", error);
      if (wsRef.current === ws) stopAll();
    };

  }, [apiKey, startMic, stopAll, stopPlayback, scheduleAudioChunk]);

  const sendTextMessage = useCallback(async (text: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    // Chunk text to prevent 1007 WebSocket payload too large error
    const CHUNK_SIZE = 4000;
    const chunks = [];
    for (let i = 0; i < text.length; i += CHUNK_SIZE) {
      chunks.push(text.substring(i, i + CHUNK_SIZE));
    }

    setThoughts(prev => prev + `\n\n<span style="color: var(--success); font-style: italic;">[ 📋 SENDING PASTE: ${text.length} chars in ${chunks.length} chunks... ]</span>\n\n`);

    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index];
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) break;

      wsRef.current.send(JSON.stringify({
        clientContent: {
          turns: [{
            role: 'user',
            parts: [{ text: chunk }]
          }],
          turnComplete: index === chunks.length - 1
        }
      }));

      // Small delay to prevent flooding the websocket server
      if (index < chunks.length - 1) {
        await new Promise(r => setTimeout(r, 100));
      }
    }
  }, []);

  return {
    isActive,
    isMuted,
    UIState,
    statusText,
    thoughts,
    connect,
    stopAll,
    toggleMute,
    sendTextMessage
  };
}
