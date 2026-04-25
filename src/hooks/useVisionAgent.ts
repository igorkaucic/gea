import { useState, useRef, useCallback } from 'react';
import { GoogleGenAI } from '@google/genai';
import { dbAdd } from '../db/db';

interface VisionJob {
  id: number;
  prompt: string;
  status: 'running' | 'done' | 'error';
  text: string;
}

let jobCounter = 0;

export function useVisionAgent(apiKey: string) {
  const [jobs, setJobs] = useState<VisionJob[]>([]);
  const jobsRef = useRef<VisionJob[]>([]);

  const updateJob = (id: number, update: Partial<VisionJob>) => {
    jobsRef.current = jobsRef.current.map(j => j.id === id ? { ...j, ...update } : j);
    setJobs([...jobsRef.current]);
  };

  const appendText = (id: number, text: string) => {
    jobsRef.current = jobsRef.current.map(j => j.id === id ? { ...j, text: j.text + text } : j);
    setJobs([...jobsRef.current]);
  };

  const generateImage = useCallback(async (prompt: string) => {
    if (!apiKey) return null;

    const jobId = ++jobCounter;
    const newJob: VisionJob = { id: jobId, prompt, status: 'running', text: `<span class="v-label">[JOB #${jobId}]</span> <span class="v-prompt">▶ ${prompt}</span>\n\n<span class="v-label">⏳ Generating...</span>\n` };
    jobsRef.current = [...jobsRef.current, newJob];
    setJobs([...jobsRef.current]);

    try {
      const ai = new GoogleGenAI({ apiKey });

      const response = await ai.models.generateContentStream({
        model: 'gemini-3.1-flash-image-preview',
        contents: [{ role: 'user', parts: [{ text: prompt + '\n[Generate image as 1:1 square aspect ratio at exactly 512x512 resolution]' }] }],
        config: {
          responseModalities: ['IMAGE', 'TEXT'],
          thinkingConfig: {
            // @ts-ignore - The genai SDK types are missing HIGH but the API requires it
            thinkingLevel: 'HIGH',
            includeThoughts: true
          }
        }
      });

      let imageData: string | null = null;
      let imageMime: string = 'image/png';

      for await (const chunk of response) {
        if (!chunk.candidates || !chunk.candidates[0]?.content?.parts) continue;

        for (const part of chunk.candidates[0].content.parts) {
          // Thought text — stream to terminal (gray-white)
          if ((part as any).thought && part.text) {
            appendText(jobId, `<span class="v-thought">${part.text}</span>`);
          }
          // Final text response
          else if (part.text) {
            appendText(jobId, '\n' + part.text);
          }
          // Image data
          if (part.inlineData && part.inlineData.data) {
            imageData = part.inlineData.data;
            imageMime = part.inlineData.mimeType || 'image/png';
            appendText(jobId, '\n<span class="v-label">[ 📦 Image data received ]</span>');
          }
        }
      }

      if (imageData) {
        const b64Url = `data:${imageMime};base64,${imageData}`;
        const newId = await dbAdd('images', {
          prompt,
          thumbnail_b64: b64Url,
          full_b64: b64Url,
          timestamp: new Date().toISOString()
        });
        appendText(jobId, `\n\n<span class="v-label">[ ✅ IMAGE SAVED — ID: ${newId} ]</span>`);
        updateJob(jobId, { status: 'done' });
        window.dispatchEvent(new CustomEvent('DATA_CHANGED'));
        window.dispatchEvent(new CustomEvent('SHOW_TOAST', { detail: '🎨 Image generated!' }));
        return { id: newId, data: b64Url };
      } else {
        appendText(jobId, '\n\n<span class="v-label">[ ⚠ NO IMAGE IN RESPONSE ]</span>');
        updateJob(jobId, { status: 'error' });
        return null;
      }
    } catch (err: any) {
      console.error('Vision agent error:', err);
      appendText(jobId, `\n\n[ ❌ ERROR: ${err.message} ]`);
      updateJob(jobId, { status: 'error' });
      return null;
    }
  }, [apiKey]);

  const isGenerating = jobsRef.current.some(j => j.status === 'running');
  const visionThoughts = jobs.map(j => j.text).join('\n\n');

  const clearVisionThoughts = useCallback(() => {
    jobsRef.current = [];
    setJobs([]);
  }, []);

  return {
    isGenerating,
    visionThoughts,
    jobs,
    generateImage,
    clearVisionThoughts
  };
}
