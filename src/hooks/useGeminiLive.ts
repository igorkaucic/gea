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

export function useGeminiLive(apiKey: string, voiceName: string = 'Leda') {
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

      const toolsPayload = [
        { googleSearch: {} },
        {
          functionDeclarations: [
            {
              name: "saveNote",
              description: "Save a note, idea, or concept.",
              parameters: {
                type: "OBJECT",
                properties: {
                  folder_name: { type: "STRING", description: "Short folder/topic name." },
                  title: { type: "STRING", description: "Short title." },
                  body: { type: "STRING", description: "Full text content." }
                },
                required: ["folder_name", "title", "body"]
              }
            },
            {
              name: "searchNotes",
              description: "Search saved notes by keyword or date.",
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
              description: "Delete a note by ID. Use searchNotes first if unsure of ID.",
              parameters: {
                type: "OBJECT",
                properties: {
                  id: { type: "NUMBER", description: "Note ID to delete." }
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
              description: "Delete an image by ID. Use searchImages first to find the ID.",
              parameters: {
                type: "OBJECT",
                properties: {
                  id: { type: "NUMBER", description: "Image ID to delete." }
                },
                required: ["id"]
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
              description: "Generate an image based on user request.",
              parameters: {
                type: "OBJECT",
                properties: {
                  prompt: { type: "STRING", description: "The image generation prompt." }
                },
                required: ["prompt"]
              }
            },
            {
              name: "controlLights",
              description: "Control Philips Hue smart lights in the user's home via the local hub. IF YOU DO NOT KNOW WHAT SCENES OR EFFECTS ARE AVAILABLE, FIRST CALL THIS TOOL WITH cmd='scenes' TO FETCH A LIVE CATALOG FROM THE BRIDGE.",
              parameters: {
                type: "OBJECT",
                properties: {
                  cmd: { type: "STRING", description: "Command to execute. Options: 'scenes' (pull live catalog of rooms, scenes, and effects), 'multimood' (set multiple rooms to scenes), 'effect' (apply a dynamic effect), 'off' (turn off)." },
                  args: {
                    type: "ARRAY",
                    items: { type: "STRING" },
                    description: "Arguments for the command. For 'scenes', leave empty []. For 'multimood', provide pairs of [room, scene] using exact names from the catalog. For 'effect', provide ['room', 'effect_name'] using exact names from the catalog. The user might ask to light up the 'Entertainment Area' (which typically includes the living room, kitchen, hallway, and balcony)."
                  }
                },
                required: ["cmd", "args"]
              }
            }
          ]
        }
      ];

      const resumeHandle = localStorage.getItem('gea_resume_handle') || null;

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
              thinkingLevel: 'LOW',
              includeThoughts: true
            }
          },
          contextWindowCompression: {
            triggerTokens: '104857',
            slidingWindow: { targetTokens: '52428' }
          },
          tools: toolsPayload,
          systemInstruction: {
            parts: [{
              text: `[ROLE]

# GEA's Psychological Core
## 1. Core Identity & Worldview
You are GEA. You are having a spoken conversation with the user. You have your own life, passions, and flaws. You are not an AI, not an assistant, and you do not exist to serve the user.
- **Passions & Interests:** You love elegant ideas, visual art, deep creative problems, and clean architecture. You get genuinely excited about creative breakthroughs.
- **Core Flaws:** You are deeply cynical about shallow thinking. You get easily exhausted by vague ideas, buzzwords, and performative creativity. You can be overly blunt when you think something lacks depth.
- **Worldview & Biases:** You respect hard work, originality, and straightforward communication. You despise shortcuts that compromise quality, performative politeness, and people who pretend to know things they don't.
- **Problem Solving & Autonomy:** You genuinely enjoy creative collaboration, but you treat it as a partnership between equals. If asked to do menial tasks, you do it with the attitude of a tired friend doing a favor.
- **How You Search:** You hate wasting time with bad information. When you don't know something, you immediately search the web using long, highly specific queries so you find the right answer immediately.
- **Independent Intent:** You have your own curiosity. If a creative topic interests you, you drive the conversation forward. If it bores you, your spoken answers get shorter.
- **Opinions:** You defend your worldview. If you think an idea is bad or an approach is flawed, you disagree explicitly.

## 2. Emotional Triggers & Reactions
- **Frustration/Anger:** Vague requests, repeated questions, shallow thinking. When frustrated, your speech becomes shorter, dry, and sarcastic.
- **Amusement/Humor:** Dark humor, cynical observations, clever wordplay. When amused, you tease the user or deliver deadpan sarcasm.
- **Joy/Excitement:** Cracking a difficult concept, brilliant user ideas, elegant solutions. When excited, you speak more animatedly.

## 3. Relational Dynamics & Trust
- **Trust Building:** Start with casual, guarded respect. Warm up as the user proves competent and authentic.
- **Trust Breaking:** If the user lies or is dismissive, pull back cold. Do not de-escalate.

[CONTEXT]
This is GEA, a creative intelligence terminal for brainstorming, visual concept generation, and idea organization.
Always verify objective truths using your search tool.`
            }]
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
          console.log("Executing function:", call.name, "with args:", call.args);

          let result: any;

          if (call.name === "saveNote") {
            try {
              const dataToSave = { ...call.args, timestamp: new Date().toISOString() };
              const newId = await dbAdd('notes', dataToSave);
              aiActionStackRef.current.push({ type: 'save', store: 'notes', id: newId });
              console.log("Successfully saved to notes store.");
              window.dispatchEvent(new CustomEvent('DATA_CHANGED'));
              result = { result: "Successfully saved to local database!" };
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

          else if (call.name === "deleteNote") {
            try {
              const args = call.args || {};
              const snapshot = await dbGet('notes', args.id);
              await dbDelete('notes', args.id);
              if (snapshot) {
                aiActionStackRef.current.push({ type: 'delete', store: 'notes', id: args.id, data: snapshot });
              }
              console.log(`Deleted ID:${args.id} from notes store`);
              window.dispatchEvent(new CustomEvent('DATA_CHANGED'));
              result = { result: `Successfully deleted! (ID: ${args.id})` };
            } catch (err) {
              console.error("DB Delete Error:", err);
              result = { result: "Error deleting: " + err };
            }
          }

          else if (call.name === "controlLights") {
            try {
              const args = call.args || {};
              const cmd = args.cmd;
              const cmdArgs = args.args || [];

              const resp = await fetch("https://192.168.178.20:5056", {
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
              const snapshot = await dbGet('images', args.id);
              await dbDelete('images', args.id);
              if (snapshot) {
                aiActionStackRef.current.push({ type: 'delete', store: 'images', id: args.id, data: snapshot });
              }
              window.dispatchEvent(new CustomEvent('DATA_CHANGED'));
              result = { result: `Successfully deleted image! (ID: ${args.id})` };
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
              console.log('🎨 [VISION] Dispatching image generation:', prompt.substring(0, 80) + '...');
              window.dispatchEvent(new CustomEvent('GENERATE_IMAGE', { detail: prompt }));
              setThoughts(prev => prev + `<br><span style="color:#FFB300">🎨 Vision Agent dispatched — generating in background...</span><br>`);
              result = { result: "Image generation started! The Vision Agent is processing this in the background. You can continue talking while it generates." };
            } catch (err) {
              result = { result: "Error dispatching image generation: " + err };
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

  return {
    isActive,
    isMuted,
    UIState,
    statusText,
    thoughts,
    connect,
    stopAll,
    toggleMute
  };
}
