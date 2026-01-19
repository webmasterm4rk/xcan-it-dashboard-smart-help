
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, FunctionDeclaration, Type } from '@google/genai';
import { SYSTEM_INSTRUCTION } from '../constants';
import { decode, decodeAudioData, createBlob } from '../utils/audioUtils';
import { AudioVisualizer } from './AudioVisualizer';

const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;

interface TranscriptionItem {
  id: string;
  speaker: 'user' | 'agent';
  type: 'text' | 'image';
  text?: string;
  imageId?: string;
  isComplete: boolean;
}

const showDashboardImageDeclaration: FunctionDeclaration = {
  name: 'showDashboardImage',
  parameters: {
    type: Type.OBJECT,
    description: 'Show an image of the dashboard to the user to visually explain where something is.',
    properties: {
      imageId: {
        type: Type.STRING,
        description: 'The ID of the image to show.',
        enum: [
          'dashboard_overview',
          'top_navigation',
          'settings_menu',
          'theme_toggle',
          'faqs_section',
          'video_guides'
        ]
      }
    },
    required: ['imageId']
  }
};

const DASHBOARD_IMAGES: Record<string, { src: string, alt: string }> = {
  dashboard_overview: {
    src: 'https://xcan.it/wp-content/uploads/2026/01/dashboard-overview.webp',
    alt: 'Dashboard Overview'
  },
  top_navigation: {
    src: 'https://xcan.it/wp-content/uploads/2026/01/dashboard-top-navigation-highlight.webp',
    alt: 'Top Navigation Bar'
  },
  settings_menu: {
    src: 'https://xcan.it/wp-content/uploads/2026/01/dashboard-user-menu-settings.webp',
    alt: 'Settings Menu'
  },
  theme_toggle: {
    src: 'https://xcan.it/wp-content/uploads/2026/01/dashboard-theme-toggle.webp',
    alt: 'Light/Dark Mode Toggle'
  },
  faqs_section: {
    src: 'https://xcan.it/wp-content/uploads/2026/01/dashboard-faq-section.webp',
    alt: 'FAQs Section'
  },
  video_guides: {
    src: 'https://xcan.it/wp-content/uploads/2026/01/dashboard-video-guides.webp',
    alt: 'Video Guides Section'
  }
};

export const VoiceAgent: React.FC = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isError, setIsError] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Ready to connect');
  const [transcripts, setTranscripts] = useState<TranscriptionItem[]>([]);
  
  const sessionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourceNodesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const streamRef = useRef<MediaStream | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  
  const [inputAnalyser, setInputAnalyser] = useState<AnalyserNode | null>(null);
  const [outputAnalyser, setOutputAnalyser] = useState<AnalyserNode | null>(null);

  const currentTurnRef = useRef<{ user: string; agent: string }>({ user: '', agent: '' });
  const activeIdsRef = useRef<{ user: string | null; agent: string | null }>({ user: null, agent: null });

  useEffect(() => {
    const timeout = setTimeout(() => {
        transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
    return () => clearTimeout(timeout);
  }, [transcripts]);

  const updateTranscript = (speaker: 'user' | 'agent', text: string, isComplete: boolean) => {
    const activeId = activeIdsRef.current[speaker];
    if (activeId) {
        setTranscripts(prev => prev.map(item => 
            item.id === activeId ? { ...item, text, isComplete } : item
        ));
    } else {
        const newId = Date.now().toString() + Math.random().toString().slice(2);
        activeIdsRef.current[speaker] = newId;
        setTranscripts(prev => [...prev, { id: newId, speaker, type: 'text', text, isComplete }]);
    }
    if (isComplete) activeIdsRef.current[speaker] = null;
  };

  const addImageToTranscript = (imageId: string) => {
    setTranscripts(prev => [...prev, {
        id: 'img-' + Date.now().toString() + Math.random().toString().slice(2),
        speaker: 'agent',
        type: 'image',
        imageId: imageId,
        isComplete: true
    }]);
  };

  const disconnect = useCallback(async () => {
    if (sessionRef.current) {
        try { await sessionRef.current.close(); } catch (e) {}
        sessionRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current.onaudioprocess = null;
      scriptProcessorRef.current = null;
    }
    sourceNodesRef.current.forEach(node => { try { node.stop(); } catch(e) {} });
    sourceNodesRef.current.clear();
    if (audioContextRef.current) {
      try { await audioContextRef.current.close(); } catch (e) {}
      audioContextRef.current = null;
    }
    setIsConnected(false);
    setIsConnecting(false);
    setStatusMessage('Ready to connect');
    setInputAnalyser(null);
    setOutputAnalyser(null);
  }, []);

  const connectToGemini = useCallback(async () => {
    if (isConnecting || isConnected) return;
    try {
      setIsConnecting(true);
      setIsError(false);
      setStatusMessage('Requesting microphone access...');
      setTranscripts([]);
      currentTurnRef.current = { user: '', agent: '' };
      activeIdsRef.current = { user: null, agent: null };
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
      audioContextRef.current = audioCtx;
      
      const outAnalyser = audioCtx.createAnalyser();
      outAnalyser.fftSize = 256;
      outputAnalyserRef.current = outAnalyser;
      setOutputAnalyser(outAnalyser);
      
      const inputCtx = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE });
      const source = inputCtx.createMediaStreamSource(stream);
      const inAnalyser = inputCtx.createAnalyser();
      inAnalyser.fftSize = 256;
      inputAnalyserRef.current = inAnalyser;
      setInputAnalyser(inAnalyser);

      const processor = inputCtx.createScriptProcessor(4096, 1, 1);
      scriptProcessorRef.current = processor;
      source.connect(inAnalyser);
      inAnalyser.connect(processor);
      processor.connect(inputCtx.destination);

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: SYSTEM_INSTRUCTION,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
          tools: [{ functionDeclarations: [showDashboardImageDeclaration] }],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            setStatusMessage('Connected');
            setIsConnected(true);
            setIsConnecting(false);
            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createBlob(inputData);
              sessionPromise.then((session) => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };
          },
          onmessage: async (msg: LiveServerMessage) => {
            const serverContent = msg.serverContent;
            const toolCall = msg.toolCall;

            if (toolCall) {
              for (const fc of toolCall.functionCalls) {
                 if (fc.name === 'showDashboardImage') {
                    let imageId = fc.args['imageId'] as string;
                    if (imageId) {
                        addImageToTranscript(imageId.toLowerCase().trim());
                    }
                    sessionPromise.then((session) => {
                        session.sendToolResponse({
                            functionResponses: {
                                id: fc.id,
                                name: fc.name,
                                response: { result: "Image displayed to user." }
                            }
                        });
                    });
                 }
              }
            }
            
            if (serverContent?.outputTranscription) {
                currentTurnRef.current.agent += serverContent.outputTranscription.text;
                updateTranscript('agent', currentTurnRef.current.agent, false);
            } else if (serverContent?.inputTranscription) {
                currentTurnRef.current.user += serverContent.inputTranscription.text;
                updateTranscript('user', currentTurnRef.current.user, false);
            }

            if (serverContent?.turnComplete) {
                if (activeIdsRef.current.user) updateTranscript('user', currentTurnRef.current.user, true);
                if (activeIdsRef.current.agent) updateTranscript('agent', currentTurnRef.current.agent, true);
                currentTurnRef.current = { user: '', agent: '' };
            }

            const base64Audio = serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio && audioContextRef.current) {
                try {
                    const ctx = audioContextRef.current;
                    const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, OUTPUT_SAMPLE_RATE, 1);
                    const now = ctx.currentTime;
                    nextStartTimeRef.current = Math.max(nextStartTimeRef.current, now);
                    const source = ctx.createBufferSource();
                    source.buffer = audioBuffer;
                    if (outputAnalyserRef.current) {
                        source.connect(outputAnalyserRef.current);
                        outputAnalyserRef.current.connect(ctx.destination);
                    } else { source.connect(ctx.destination); }
                    source.start(nextStartTimeRef.current);
                    nextStartTimeRef.current += audioBuffer.duration;
                    sourceNodesRef.current.add(source);
                    source.onended = () => { sourceNodesRef.current.delete(source); };
                } catch (e) {}
            }

            if (serverContent?.interrupted) {
              sourceNodesRef.current.forEach((node) => { try { node.stop(); } catch(e) {} });
              sourceNodesRef.current.clear();
              nextStartTimeRef.current = audioContextRef.current?.currentTime || 0;
              if (activeIdsRef.current.agent) {
                  updateTranscript('agent', currentTurnRef.current.agent + ' ...', true);
                  currentTurnRef.current.agent = '';
              }
            }
          },
          onclose: () => { setIsConnected(false); setIsConnecting(false); },
          onerror: () => { setIsError(true); setIsConnected(false); }
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (err) {
      setIsError(true); setIsConnecting(false);
    }
  }, [isConnecting, isConnected]);

  return (
    <div className="flex flex-col w-full max-w-2xl mx-auto bg-white rounded-3xl shadow-2xl overflow-hidden border border-gray-100 h-[80vh] min-h-[600px]">
      <div className="bg-white px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`}></div>
          <span className="font-bold text-gray-800 tracking-tight">Xcan It Smart Help</span>
        </div>
        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest bg-gray-50 px-2 py-1 rounded">
           {isConnected ? 'Session Active' : 'Offline'}
        </div>
      </div>

      <div className="px-6 py-4 bg-gray-50/50 grid grid-cols-2 gap-4 border-b border-gray-100 flex-shrink-0">
        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm relative overflow-hidden h-28">
            <span className="absolute top-2 left-3 text-[10px] font-black text-blue-600/30 uppercase tracking-widest">Emma</span>
            <AudioVisualizer analyser={outputAnalyser} isActive={isConnected} barColor="#3b82f6" />
        </div>
        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm relative overflow-hidden h-28">
            <span className="absolute top-2 left-3 text-[10px] font-black text-gray-400/30 uppercase tracking-widest">You</span>
            <AudioVisualizer analyser={inputAnalyser} isActive={isConnected} barColor="#94a3b8" />
        </div>
      </div>

      <div className="flex-1 bg-white overflow-y-auto px-6 py-6 space-y-6 scroll-smooth">
         {transcripts.length === 0 && (
             <div className="h-full flex flex-col items-center justify-center text-center px-10">
                 <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mb-4 text-blue-500">
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path></svg>
                 </div>
                 <h3 className="text-gray-900 font-bold mb-1">How can I help you?</h3>
                 <p className="text-gray-500 text-sm leading-relaxed">Ask "Where is the settings menu?" or "How do I edit my codes?" to see me in action.</p>
             </div>
         )}
         {transcripts.map((item) => (
             <div key={item.id} className={`flex w-full ${item.speaker === 'user' ? 'justify-end' : 'justify-start'}`}>
                 <div className={`${item.type === 'image' ? 'w-full' : 'max-w-[85%]'} flex flex-col ${item.speaker === 'user' ? 'items-end' : 'items-start'}`}>
                     {item.type === 'text' && (
                        <div className={`px-4 py-3 text-sm leading-relaxed shadow-sm transition-all ${
                            item.speaker === 'user' 
                            ? 'bg-slate-100 text-slate-800 rounded-2xl rounded-tr-none' 
                            : 'bg-blue-600 text-white rounded-2xl rounded-tl-none font-medium'
                        }`}>
                           <p>{item.text}</p>
                        </div>
                     )}
                     {item.type === 'image' && item.imageId && DASHBOARD_IMAGES[item.imageId] && (
                        <div className="mt-2 w-full animate-in fade-in slide-in-from-bottom-2 duration-500">
                            <div className="group relative rounded-xl overflow-hidden border-2 border-blue-100 shadow-lg">
                                <img src={DASHBOARD_IMAGES[item.imageId].src} alt={DASHBOARD_IMAGES[item.imageId].alt} className="w-full h-auto block" />
                            </div>
                            <div className="mt-2 flex items-center space-x-2 text-[10px] text-blue-600 font-bold uppercase tracking-widest bg-blue-50 self-start px-2 py-1 rounded">
                                <span className="animate-pulse">●</span>
                                <span>{DASHBOARD_IMAGES[item.imageId].alt}</span>
                            </div>
                        </div>
                     )}
                 </div>
             </div>
         ))}
         <div ref={transcriptEndRef} className="h-4" />
      </div>

      <div className="px-6 py-6 bg-white border-t border-gray-100 flex flex-col items-center">
          {!isConnected ? (
          <button 
            onClick={connectToGemini} 
            disabled={isConnecting} 
            className="group relative flex items-center justify-center space-x-3 px-10 py-4 bg-blue-600 text-white rounded-full shadow-xl shadow-blue-500/20 hover:bg-blue-700 hover:-translate-y-0.5 transition-all disabled:bg-gray-400 font-bold text-lg"
          >
              {isConnecting ? 'Starting Emma...' : 'Talk to Emma'}
          </button>
          ) : (
          <button onClick={disconnect} className="group flex items-center justify-center space-x-2 px-8 py-3 bg-red-50 text-red-600 border border-red-100 rounded-full hover:bg-red-100 transition-all font-bold text-sm">
              <span>End Call</span>
          </button>
          )}
      </div>
    </div>
  );
};
