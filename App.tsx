import React, { useState, useEffect, useRef } from 'react';
import { useLiveTutor } from './hooks/useLiveTutor';
import { AudioVisualizer } from './components/AudioVisualizer';
import { ChatMessage } from './components/ChatMessage';
import { Sender, NewsTopic, ProficiencyLevel } from './types';
import { generateAnalysis, findConversationTopic, generateSpeech } from './services/geminiService';

// Icons
const MicIcon = () => <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>;
const StopIcon = () => <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H9a1 1 0 01-1-1v-4z" /></svg>;
const BrainIcon = () => <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>;
const SearchIcon = () => <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>;
const SpeakerIcon = () => <svg className="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>;

export default function App() {
  const { 
    isConnected, 
    start, 
    stop,
    changeLevel, 
    messages, 
    volume, 
    isSilent,
    addSystemMessage 
  } = useLiveTutor();

  const scrollRef = useRef<HTMLDivElement>(null);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [topic, setTopic] = useState<NewsTopic | null>(null);
  const [loadingTopic, setLoadingTopic] = useState(false);
  const [level, setLevel] = useState<ProficiencyLevel>('B1');

  // Auto-scroll chat
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, analysis]);

  // Deep Analysis Handler
  const handleAnalyze = async () => {
    if (messages.length === 0) return;
    setIsAnalyzing(true);
    setAnalysis(null);
    
    const transcript = messages.map(m => `${m.sender}: ${m.text}`).join('\n');
    try {
      const result = await generateAnalysis(transcript);
      setAnalysis(result);
    } catch (e) {
      console.error(e);
      addSystemMessage("Analysis failed. Please try again.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Topic Generation Handler
  const handleSuggestTopic = async () => {
    setLoadingTopic(true);
    setTopic(null);
    try {
      const newTopic = await findConversationTopic();
      if (newTopic) {
        setTopic(newTopic);
        addSystemMessage(`Suggested Topic: ${newTopic.title}`);
      }
    } catch (e) {
      addSystemMessage("Could not find a topic.");
    } finally {
      setLoadingTopic(false);
    }
  };

  // TTS for Topic
  const readTopic = async () => {
    if (!topic) return;
    const buffer = await generateSpeech(`${topic.title}. ${topic.summary}`);
    if (buffer) {
      const ctx = new AudioContext();
      const source = ctx.createBufferSource();
      source.buffer = await ctx.decodeAudioData(buffer);
      source.connect(ctx.destination);
      source.start();
    }
  };

  const handleStart = () => {
    start(level);
  };

  const handleLevelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newLevel = e.target.value as ProficiencyLevel;
    setLevel(newLevel);
    if (isConnected) {
      changeLevel(newLevel);
    }
  };

  return (
    <div className="flex flex-col h-screen max-w-4xl mx-auto bg-slate-950 shadow-2xl overflow-hidden relative">
      {/* Header */}
      <header className="p-4 bg-slate-900 border-b border-slate-800 flex flex-col sm:flex-row sm:justify-between items-center z-10 gap-4">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-xl shadow-lg">
            DF
          </div>
          <div>
            <h1 className="text-lg font-bold text-white leading-tight">DeutschFlow</h1>
            <p className="text-xs text-slate-400 flex items-center">
              <span className={`w-2 h-2 rounded-full mr-2 ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-slate-600'}`}></span>
              {isConnected ? 'Live Tutor Active' : 'Ready to Connect'}
            </p>
          </div>
        </div>
        
        <div className="flex items-center space-x-2 w-full sm:w-auto justify-center">
          <select
            value={level}
            onChange={handleLevelChange}
            className="px-3 py-2 bg-slate-800 hover:bg-slate-750 text-white text-xs rounded-md border border-slate-700 focus:outline-none focus:border-blue-500 transition-colors cursor-pointer font-medium"
          >
            <option value="A1">A1 - Beginner</option>
            <option value="A2">A2 - Elementary</option>
            <option value="B1">B1 - Intermediate</option>
            <option value="B2">B2 - Upper Interm.</option>
            <option value="C1">C1 - Advanced</option>
          </select>

          <button 
            onClick={handleSuggestTopic}
            disabled={loadingTopic}
            className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-md transition-colors flex items-center border border-slate-700"
            title="Suggest a topic"
          >
            <SearchIcon />
            <span className="hidden sm:inline">{loadingTopic ? 'Searching...' : 'Topic'}</span>
          </button>
          
          <button 
            onClick={handleAnalyze}
            disabled={isAnalyzing || messages.length === 0}
            className="px-3 py-2 bg-indigo-900/50 hover:bg-indigo-900 text-indigo-300 text-xs rounded-md transition-colors flex items-center border border-indigo-800"
            title="Analyze conversation"
          >
            <BrainIcon />
            <span className="hidden sm:inline">{isAnalyzing ? 'Thinking...' : 'Analysis'}</span>
          </button>
        </div>
      </header>

      {/* Main Chat Area */}
      <main className="flex-1 overflow-y-auto p-4 bg-gradient-to-b from-slate-950 to-slate-900 scrollbar-hide" ref={scrollRef}>
        <div className="max-w-2xl mx-auto">
          {/* Welcome / Empty State */}
          {messages.length === 0 && !topic && (
            <div className="text-center mt-20 opacity-50">
              <p className="text-slate-500 text-lg mb-4">Start a conversation to improve your German.</p>
              <p className="text-slate-600 text-sm">Select your level: <span className="text-blue-400 font-bold">{level}</span></p>
            </div>
          )}

          {/* Suggested Topic Card */}
          {topic && (
            <div className="mb-6 p-4 bg-slate-800/50 border border-indigo-500/30 rounded-xl shadow-lg">
              <div className="flex justify-between items-start">
                <h3 className="text-indigo-400 font-bold mb-2 text-lg">{topic.title}</h3>
                <button onClick={readTopic} className="text-slate-400 hover:text-white"><SpeakerIcon /></button>
              </div>
              <p className="text-slate-300 text-sm mb-3">{topic.summary}</p>
              <a href={topic.url} target="_blank" rel="noreferrer" className="text-xs text-blue-400 hover:underline">Read more on Google</a>
            </div>
          )}

          {/* Chat Messages */}
          {messages.map((msg) => (
            <ChatMessage key={msg.id} message={msg} />
          ))}

          {/* Silence Warning */}
          {isSilent && isConnected && (
            <div className="flex justify-center my-4 animate-bounce">
               <div className="bg-yellow-900/50 text-yellow-200 text-xs px-4 py-2 rounded-full border border-yellow-700 flex items-center">
                 <span className="mr-2">🎤</span> The tutor is waiting for you... (Say something or click Suggest Topic)
               </div>
            </div>
          )}

          {/* Analysis Result */}
          {analysis && (
            <div className="mt-8 p-6 bg-slate-900 border border-indigo-500/50 rounded-2xl shadow-2xl mb-8">
              <h2 className="text-xl font-bold text-white mb-4 flex items-center">
                <BrainIcon /> Conversation Analysis
              </h2>
              <div className="prose prose-invert prose-sm max-w-none">
                <div dangerouslySetInnerHTML={{ 
                   __html: analysis.replace(/\*\*(.*?)\*\*/g, '<strong class="text-indigo-300">$1</strong>')
                                   .replace(/\n/g, '<br/>') 
                }} />
              </div>
              <button onClick={() => setAnalysis(null)} className="mt-4 text-xs text-slate-500 hover:text-white underline">Close Report</button>
            </div>
          )}
          
          <div className="h-24"></div> {/* Spacer for controls */}
        </div>
      </main>

      {/* Controls Footer */}
      <footer className="absolute bottom-0 w-full bg-slate-900/90 backdrop-blur-lg border-t border-slate-800 p-4 z-20">
        <div className="max-w-2xl mx-auto flex flex-col space-y-4">
          
          {/* Visualizer */}
          <div className="w-full">
            <AudioVisualizer volume={volume} isActive={isConnected} />
          </div>

          {/* Main Button */}
          <div className="flex justify-center items-center">
            {!isConnected ? (
              <button
                onClick={handleStart}
                className="group relative flex items-center justify-center px-8 py-4 bg-green-600 hover:bg-green-500 text-white rounded-full font-bold text-lg transition-all shadow-[0_0_20px_rgba(74,222,128,0.3)] hover:shadow-[0_0_30px_rgba(74,222,128,0.5)]"
              >
                <span className="absolute w-full h-full rounded-full bg-green-400 opacity-20 animate-ping group-hover:opacity-40"></span>
                <MicIcon />
                <span className="ml-2">Start Conversation ({level})</span>
              </button>
            ) : (
              <button
                onClick={stop}
                className="flex items-center justify-center px-8 py-4 bg-red-600 hover:bg-red-500 text-white rounded-full font-bold text-lg transition-all shadow-lg"
              >
                <StopIcon />
                <span className="ml-2">End Session</span>
              </button>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}