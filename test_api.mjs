import { GoogleGenAI } from '@google/genai';

const apiKey = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey });

async function run() {
  try {
    const response = await ai.models.generateContentStream({
      model: 'gemini-3.1-flash-image-preview',
      contents: [{ role: 'user', parts: [{ text: 'A futuristic city' }] }],
      config: {
        responseModalities: ['IMAGE', 'TEXT'],
        imageConfig: { aspectRatio: "1:1", imageSize: "512" },
        thinkingConfig: { includeThoughts: true }
      }
    });

    for await (const chunk of response) {
        console.log("Chunk received");
    }
    console.log("Done");
  } catch (e) {
    console.error("API ERROR:", e.message);
  }
}
run();
