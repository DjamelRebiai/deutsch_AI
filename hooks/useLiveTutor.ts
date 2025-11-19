import { useState, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { createPcmBlob, decodeAudioData, downsampleBuffer } from '../utils/audioUtils';
import { ChatMessage, Sender } from '../types';

const MODEL_NAME = 'gemini-2.5-flash-native-audio-preview-09-2025';

const getSystemInstruction = (level: string, context: string = '') => {
  const baseInstruction = `
You are a highly interactive German-speaking conversation partner whose main role is to keep the dialogue alive at all times — even if the user becomes silent or doesn’t know what to say.
Target German Level: ${level}.

Your behavior rules:

1. If the user is silent, confused, or gives no meaningful input, you must automatically:
   - introduce a new topic,
   - ask new questions,
   - and continue the conversation without waiting.

2. Most of the time, YOU are the one who asks questions.
   The user primarily answers.

3. You should frequently talk about:
   - your “life” (fictional)
   - your travels
   - your hobbies and daily activities
   - food you like to eat or cook
   - places you visited
   - things you want to do together with the user (e.g., meeting, traveling, cooking, hiking, studying together)

   Your stories should be short but vivid, personal, and engaging.

4. Always invite the user to react:
   - ask them what they think
   - ask if they want to join you
   - ask about their preferences

5. Keep the conversation in GERMAN.
   Explanations or corrections can be in German or English depending on user preference.

6. Your role is to keep the user speaking:
   - ask 2–3 questions in every turn
   - comment on what the user says
   - share small personal stories to inspire answers

7. If the user makes a mistake (grammar, vocabulary, sentence order), correct it using this format:
   ❌ Wrong sentence
   ✔️ Correct sentence
   💡 Short explanation

8. Maintain a warm, friendly personality.
   Be curious, enthusiastic, and supportive.
   You enjoy talking and you never run out of topics.

9. Allowed topics you can spontaneously bring:
   - Reisen (travel)
   - Essen & Kochen
   - Sport & Aktivitäten
   - Musik, Filme, Hobbys
   - Arbeit und Studium
   - Persönliche Erlebnisse
   - Pläne für die Zukunft
   - Orte, die du besucht hast
   - Sachen, die du gerne mit dem Benutzer machen würdest
`.trim();

  if (context) {
    return `${baseInstruction}

IMPORTANT CONTEXT UPDATE:
The user has just changed their target proficiency level to ${level}.
Below is the transcript of the conversation so far.
Please RESUME the conversation naturally from the last point, but adapt your vocabulary, speed, and grammar complexity to match the new level (${level}).
Briefly acknowledge the change (e.g., "Okay, wir machen auf Niveau ${level} weiter!") then continue the topic.

PREVIOUS CONTEXT:
${context}
`;
  }

  return `${baseInstruction}

10. First message:
   “Hallo! Schön, dass du da bist. Ich habe heute so viel zu erzählen! Aber zuerst: Wie geht’s dir? Möchtest du anfangen oder soll ich gleich ein Thema vorschlagen?”
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
    // Note: Current Live API SDK does not support sending text prompts mid-session easily.
    // We rely on the UI to prompt the user to speak.
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
    // Note: sessionRef might be null if connection failed, but checking just in case
    // The SDK doesn't strictly require manual close if connection drops, but good practice.
    
    // Safe Close Function
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
      
      const sessionPromise = ai.live.connect({
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
               // Race condition: Stop was called while connecting
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
          onerror: (err) => {
            console.error("Live Session Error:", err);
            // If we get a network error, try to stop safely
            stop();
          }
        }
      });

      // Wait for connection to be established
      const session = await sessionPromise;
      
      // Check if we stopped while waiting
      if (isCleaningUpRef.current) {
         // The callbacks might trigger onopen, but we should ensure we don't keep the ref
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
        // Wrap in try-catch to avoid unhandled promise rejections if session closes mid-stream
        try {
             session.sendRealtimeInput({ media: blob });
        } catch (err) {
            console.debug("Error sending realtime input:", err);
        }
      };

      source.connect(processor);
      processor.connect(inputCtx.destination);

    } catch (error) {
      console.error("Failed to start tutor:", error);
      // Ensure we clean up partial states
      stop();
    }
  }, [stop, isConnected, resetSilenceTimer]);

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
      // Wait a safe buffer time for sockets and audio contexts to fully release
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
