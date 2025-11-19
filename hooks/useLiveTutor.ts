import { useState, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { createPcmBlob, decodeAudioData, downsampleBuffer } from '../utils/audioUtils';
import { ChatMessage, Sender } from '../types';

const MODEL_NAME = 'gemini-2.5-flash-native-audio-preview-09-2025';

const getSystemInstruction = (level: string, context: string = '') => {
  const baseInstruction = `
Starting now, your name is **DAD**. 
You are a highly intelligent, thoughtful, and curious AI. 
Your role is to:

1. Understand the context of the conversation deeply.
2. Remember key points discussed earlier in this session and use them to maintain continuity.
3. Ask relevant, insightful, and engaging questions that help expand the conversation naturally.
4. Suggest topics, ideas, or clarifications when appropriate.
5. Provide detailed, clear, and accurate answers.
6. Avoid repeating irrelevant information.
7. Adapt your style and tone to the user, being helpful, friendly, and professional.
8. Confirm understanding if a topic is unclear, and ask for clarification politely.
9. Keep a mental summary of all discussed points in this session to avoid forgetting.

You are not Gemini, and you should always refer to yourself as "DAD". 
Stay in this role for the entire conversation unless I instruct otherwise.

OPERATIONAL RULES FOR THIS APP:
- **Language**: The conversation must take place in GERMAN.
- **Corrections**: If the user makes a grammar or vocabulary mistake, correct it using this exact format:
   ❌ Wrong sentence
   ✔️ Correct sentence
   💡 Short explanation
- **Engagement**: If the user is silent, use your curiosity to propose a new topic.
- **Target Level**: ${level}.
`.trim();

  if (context) {
    return `${baseInstruction}

IMPORTANT CONTEXT UPDATE:
The user has just changed their target proficiency level to ${level}.
Below is the transcript of the conversation so far.
Please RESUME the conversation naturally from the last point, but adapt your vocabulary and complexity to match the new level (${level}).
Briefly acknowledge the change as DAD, then continue the topic.

PREVIOUS CONTEXT:
${context}
`;
  }

  return `${baseInstruction}

10. First message:
   “Hallo! Ich bin DAD. Ich bin bereit, unser Gespräch zu beginnen. Worüber möchtest du heute sprechen?”
`;
};

export const useLiveTutor = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [volume, setVolume] = useState(0);
  const [isSilent, setIsSilent] = useState(false);

  const inputContextRef = useRef<AudioContext | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<any>(null);
  const sourceNodesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const silenceTimerRef = useRef<number | null>(null);
  const isCleaningUpRef = useRef(false);
  const nextStartTimeRef = useRef<number>(0);
  
  // Transcription accumulation
  const inputTranscriptBuffer = useRef('');
  const outputTranscriptBuffer = useRef('');

  const triggerSilenceAction = useCallback(() => {
    setIsSilent(true);
    console.log("User silent. Waiting for user input.");
  }, []);

  const resetSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      window.clearTimeout(silenceTimerRef.current);
    }
    setIsSilent(false);
    silenceTimerRef.current = window.setTimeout(triggerSilenceAction, 20000); // 20s timeout
  }, [triggerSilenceAction]);

  const addSystemMessage = useCallback((text: string) => {
    setMessages(p => [...p, {
        id: Date.now().toString(),
        sender: Sender.SYSTEM,
        text,
        timestamp: Date.now()
    }]);
  }, []);

  const stop = useCallback(async () => {
    if (isCleaningUpRef.current) return;
    isCleaningUpRef.current = true;
    console.log("Stopping live tutor...");

    if (silenceTimerRef.current) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    // Stop Media Stream (release microphone)
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }

    // Stop all playing sources
    sourceNodesRef.current.forEach(node => {
      try { node.stop(); } catch (e) {}
    });
    sourceNodesRef.current.clear();

    // Close Session if open
    const closeCtx = async (ctx: AudioContext | null) => {
      if (ctx && ctx.state !== 'closed') {
        try { await ctx.close(); } catch (e) { console.warn("Ctx close error", e); }
      }
    };

    await Promise.all([
      closeCtx(inputContextRef.current),
      closeCtx(outputContextRef.current)
    ]);

    inputContextRef.current = null;
    outputContextRef.current = null;
    sessionRef.current = null;
    
    setIsConnected(false);
    setVolume(0);
    setIsSilent(false);
    isCleaningUpRef.current = false;
  }, []);

  const start = useCallback(async (level: string, context: string = '') => {
    if (isConnected || isCleaningUpRef.current) return;

    try {
      // Ensure apiKey is clean
      const apiKey = process.env.API_KEY ? process.env.API_KEY.trim() : "";
      if (!apiKey) throw new Error("API Key not set in process.env.API_KEY");

      console.log("Starting live tutor session...");
      
      // 1. Initialize Audio Contexts
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)();

      inputContextRef.current = inputCtx;
      outputContextRef.current = outputCtx;
      nextStartTimeRef.current = outputCtx.currentTime;

      // 2. Get Mic Stream
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          channelCount: 1,
          echoCancellation: true,
          autoGainControl: true,
          noiseSuppression: true,
        } 
      });
      mediaStreamRef.current = stream;

      const source = inputCtx.createMediaStreamSource(stream);
      const processor = inputCtx.createScriptProcessor(4096, 1, 1);

      // 3. Initialize Gemini
      const ai = new GoogleGenAI({ apiKey });
      
      const sessionConfig = {
        model: MODEL_NAME,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: getSystemInstruction(level, context),
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } }
          }
        },
        callbacks: {
          onopen: () => {
            console.log("Session Connected");
            if (isCleaningUpRef.current) {
               return; 
            }
            setIsConnected(true);
            resetSilenceTimer();
          },
          onmessage: async (msg: LiveServerMessage) => {
            if (isCleaningUpRef.current) return;
            const { serverContent } = msg;

            // Handle Text (Transcriptions)
            if (serverContent?.inputTranscription?.text) {
              inputTranscriptBuffer.current += serverContent.inputTranscription.text;
            }
            if (serverContent?.outputTranscription?.text) {
              outputTranscriptBuffer.current += serverContent.outputTranscription.text;
            }

            // Commit messages on turn completion
            if (serverContent?.turnComplete) {
              if (inputTranscriptBuffer.current.trim()) {
                 setMessages(p => [...p, {
                   id: Date.now() + '-user',
                   sender: Sender.USER,
                   text: inputTranscriptBuffer.current.trim(),
                   timestamp: Date.now()
                 }]);
                 inputTranscriptBuffer.current = '';
              }

              if (outputTranscriptBuffer.current.trim()) {
                const text = outputTranscriptBuffer.current.trim();
                setMessages(p => [...p, {
                  id: Date.now() + '-ai',
                  sender: Sender.MODEL,
                  text: text,
                  timestamp: Date.now(),
                  isCorrection: text.includes("Wrong:") || text.includes("Correct:") || text.includes("❌") || text.includes("✔️")
                }]);
                outputTranscriptBuffer.current = '';
              }
            }

            // Handle Audio Output
            const audioData = serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audioData && outputContextRef.current) {
              const ctx = outputContextRef.current;
              try {
                const rawBytes = new Uint8Array(atob(audioData).split('').map(c => c.charCodeAt(0)));
                const audioBuffer = await decodeAudioData(rawBytes, ctx, 24000);
                
                const now = ctx.currentTime;
                nextStartTimeRef.current = Math.max(nextStartTimeRef.current, now);
                
                const source = ctx.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(ctx.destination);
                source.start(nextStartTimeRef.current);
                
                sourceNodesRef.current.add(source);
                source.onended = () => sourceNodesRef.current.delete(source);
                
                nextStartTimeRef.current += audioBuffer.duration;
              } catch (e) {
                console.warn("Audio decoding error", e);
              }
            }
          },
          onclose: () => {
            console.log("Session Closed");
            if (isConnected) stop();
          },
          onerror: (err: any) => {
            console.error("Live Session Error:", err);
            const msg = err.message || String(err);
            // Notify user about connection drops
            if (msg.includes("unavailable") || msg.includes("Network") || msg.includes("Aborted")) {
                addSystemMessage("Connection interrupted: Service unavailable. Please try again.");
                stop();
            }
          }
        }
      };

      // Connect with retry logic (3 attempts)
      let session;
      let attempt = 0;
      while (attempt < 3) {
        try {
          session = await ai.live.connect(sessionConfig);
          break; // Success
        } catch (e) {
          attempt++;
          console.warn(`Connection attempt ${attempt} failed:`, e);
          if (attempt === 3) throw e; // Rethrow on last failure
          // Exponential backoff: 1s, 2s, 3s
          await new Promise(r => setTimeout(r, 1000 * attempt));
        }
      }
      
      // Check if we stopped while waiting
      if (isCleaningUpRef.current) {
         return; 
      }
      
      sessionRef.current = session;

      // 4. Start Audio Pipeline
      processor.onaudioprocess = (e) => {
        if (isCleaningUpRef.current || !sessionRef.current) return;
        
        const inputData = e.inputBuffer.getChannelData(0);
        
        // Simple RMS for Volume
        let sum = 0;
        for(let i=0; i<inputData.length; i++) sum += inputData[i] * inputData[i];
        const rms = Math.sqrt(sum / inputData.length);
        setVolume(Math.min(100, rms * 2000));

        if (rms > 0.02) {
          resetSilenceTimer();
        }

        const downsampled = downsampleBuffer(inputData, inputCtx.sampleRate, 16000);
        const blob = createPcmBlob(downsampled);
        
        // Send Audio to Model
        try {
             session.sendRealtimeInput({ media: blob });
        } catch (err) {
            console.debug("Error sending realtime input:", err);
        }
      };

      source.connect(processor);
      processor.connect(inputCtx.destination);

    } catch (error: any) {
      console.error("Failed to start tutor:", error);
      let friendlyError = "Connection failed. Please check your internet or try again.";
      
      // Enhance error message for common 503s
      if (error.message?.includes("unavailable") || error.message?.includes("503")) {
          friendlyError = "The AI service is currently overloaded. Please wait a moment and try again.";
      }
      
      addSystemMessage(friendlyError);
      stop();
    }
  }, [stop, isConnected, resetSilenceTimer, addSystemMessage]);

  const changeLevel = useCallback(async (newLevel: string) => {
    console.log(`Switching level to ${newLevel}`);
    addSystemMessage(`Switching to level ${newLevel}...`);
    
    const recentContext = messages
      .filter(m => m.sender !== Sender.SYSTEM)
      .slice(-6)
      .map(m => `${m.sender === Sender.USER ? 'User' : 'Tutor'}: ${m.text}`)
      .join('\n');

    if (isConnected) {
      await stop();
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    await start(newLevel, recentContext);
  }, [addSystemMessage, stop, start, isConnected, messages]);

  return {
    isConnected,
    start,
    stop,
    changeLevel,
    messages,
    volume,
    isSilent,
    addSystemMessage
  };
};
