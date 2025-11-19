import { GoogleGenAI, Modality, Type } from "@google/genai";
import { NewsTopic } from "../types";

// Initialize shared instance
// Note: Live API uses its own instance connection, this is for static requests
const getAiClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API Key not set. Please check process.env.API_KEY.");
  }
  return new GoogleGenAI({ apiKey });
};

export const generateAnalysis = async (conversationHistory: string): Promise<string> => {
  const ai = getAiClient();
  
  // Using Gemini 3 Pro for deep thinking/reasoning about grammar
  const response = await ai.models.generateContent({
    model: "gemini-3-pro-preview",
    contents: `Analyze the following German conversation transcript. 
    Identify the user's mistakes (grammar, vocabulary, pronunciation hints from context).
    Provide a detailed but encouraging report in Markdown.
    
    Transcript:
    ${conversationHistory}`,
    config: {
      thinkingConfig: { thinkingBudget: 32768 }, // Max thinking budget
    }
  });

  return response.text || "No analysis could be generated.";
};

export const findConversationTopic = async (): Promise<NewsTopic | null> => {
  const ai = getAiClient();

  // Using Gemini 2.5 Flash with Google Search
  // Note: When using googleSearch, responseMimeType and responseSchema are not supported.
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: "Find a recent, interesting, positive news story or cultural event from Germany suitable for a B1 level conversation. Return the title and a 1-sentence summary. Format:\nTitle: [Title]\nSummary: [Summary]",
    config: {
      tools: [{ googleSearch: {} }],
    }
  });

  try {
    const text = response.text || "";
    
    const titleMatch = text.match(/Title:\s*(.+)/i);
    const summaryMatch = text.match(/Summary:\s*(.+)/i);

    const title = titleMatch ? titleMatch[1].trim() : "Nachrichten aus Deutschland";
    const summary = summaryMatch ? summaryMatch[1].trim() : text;

    // Extract URL from grounding metadata
    let url = "";
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
    if (chunks) {
      for (const chunk of chunks) {
        if (chunk.web?.uri) {
          url = chunk.web.uri;
          break;
        }
      }
    }

    return { 
      title, 
      summary, 
      url: url || "#" 
    };
  } catch (e) {
    console.error("Failed to parse topic", e);
    return null;
  }
};

export const generateSpeech = async (text: string): Promise<ArrayBuffer | null> => {
  const ai = getAiClient();

  // Using Gemini 2.5 Flash TTS
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: { parts: [{ text }] },
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Fenrir' }, // Deep male voice
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) return null;

  // Decode base64 to ArrayBuffer
  const binaryString = atob(base64Audio);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
};