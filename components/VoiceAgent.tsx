import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { SYSTEM_INSTRUCTION } from '../constants';
import { decode, decodeAudioData, createBlob } from '../utils/audioUtils';
import { AudioVisualizer } from './AudioVisualizer';

const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;

interface TranscriptionItem {
  id: string;
  speaker: 'user' | 'agent';
  text: string;
  isComplete: boolean;
}

export const VoiceAgent: React.FC = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [isError, setIsError] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Ready to connect');
  const [transcripts, setTranscripts] = useState<TranscriptionItem[]>([]);
  
  // Refs for audio handling
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourceNodesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const streamRef = useRef<MediaStream | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  
  // State for visualizers
  const [inputAnalyser, setInputAnalyser] = useState<AnalyserNode | null>(null);
  const [outputAnalyser, setOutputAnalyser] = useState<AnalyserNode | null>(null);

  // Buffer for streaming transcription
  const currentTurnRef = useRef<{
    user: string;
    agent: string;
  }>({ user: '', agent: '' });

  // Auto-scroll transcripts
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcripts]);

  const updateTranscript = (speaker: 'user' | 'agent', text: string, isComplete: boolean) => {
    setTranscripts(prev => {
      const last = prev[prev.length - 1];
      // If the last item is from the same speaker and not complete, update it
      if (last && last.speaker === speaker && !last.isComplete) {
        const updated = [...prev];
        updated[updated.length - 1] = { ...last, text: text, isComplete };
        return updated;
      }
      // Otherwise add new item
      // Don't add empty incomplete items
      if (!text && !isComplete) return prev;
      
      return [...prev, {
        id: Date.now().toString(),
        speaker,
        text,
        isComplete
      }];
    });
  };

  const connectToGemini = useCallback(async () => {
    try {
      setIsError(false);
      setStatusMessage('Requesting microphone access...');
      setTranscripts([]);
      currentTurnRef.current = { user: '', agent: '' };
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      setStatusMessage('Connecting to Emma...');

      // Initialize Audio Contexts
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioContext({
        sampleRate: OUTPUT_SAMPLE_RATE,
      });
      audioContextRef.current = audioCtx;
      
      const outAnalyser = audioCtx.createAnalyser();
      outAnalyser.fftSize = 256;
      outAnalyser.smoothingTimeConstant = 0.5;
      outputAnalyserRef.current = outAnalyser;
      setOutputAnalyser(outAnalyser);
      
      // Input Pipeline
      const inputCtx = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE });
      const source = inputCtx.createMediaStreamSource(stream);
      const inAnalyser = inputCtx.createAnalyser();
      inAnalyser.fftSize = 256;
      inAnalyser.smoothingTimeConstant = 0.5;
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
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            setStatusMessage('Connected');
            setIsConnected(true);
            
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
            
            // Handle Transcription
            if (serverContent?.outputTranscription) {
                const text = serverContent.outputTranscription.text;
                if (text) {
                  currentTurnRef.current.agent += text;
                  updateTranscript('agent', currentTurnRef.current.agent, false);
                }
            } else if (serverContent?.inputTranscription) {
                const text = serverContent.inputTranscription.text;
                if (text) {
                  currentTurnRef.current.user += text;
                  updateTranscript('user', currentTurnRef.current.user, false);
                }
            }

            if (serverContent?.turnComplete) {
                if (currentTurnRef.current.user) {
                     updateTranscript('user', currentTurnRef.current.user, true);
                     currentTurnRef.current.user = '';
                }
                if (currentTurnRef.current.agent) {
                     updateTranscript('agent', currentTurnRef.current.agent, true);
                     currentTurnRef.current.agent = '';
                }
            }

            // Handle Audio
            const base64Audio = serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio && audioContextRef.current) {
                const ctx = audioContextRef.current;
                const audioBuffer = await decodeAudioData(
                  decode(base64Audio),
                  ctx,
                  OUTPUT_SAMPLE_RATE,
                  1
                );

                const now = ctx.currentTime;
                nextStartTimeRef.current = Math.max(nextStartTimeRef.current, now);
                
                const source = ctx.createBufferSource();
                source.buffer = audioBuffer;
                
                if (outputAnalyserRef.current) {
                    source.connect(outputAnalyserRef.current);
                    outputAnalyserRef.current.connect(ctx.destination);
                } else {
                    source.connect(ctx.destination);
                }

                source.start(nextStartTimeRef.current);
                nextStartTimeRef.current += audioBuffer.duration;
                
                sourceNodesRef.current.add(source);
                source.onended = () => {
                  sourceNodesRef.current.delete(source);
                };
            }

            // Handle Interruption
            if (serverContent?.interrupted) {
              sourceNodesRef.current.forEach((node) => {
                try { node.stop(); } catch(e) {}
              });
              sourceNodesRef.current.clear();
              nextStartTimeRef.current = audioContextRef.current?.currentTime || 0;
              
              // Mark current transcripts as complete if interrupted
              if (currentTurnRef.current.agent) {
                  updateTranscript('agent', currentTurnRef.current.agent + ' ...', true);
                  currentTurnRef.current.agent = '';
              }
            }
          },
          onclose: () => {
            setStatusMessage('Disconnected');
            setIsConnected(false);
          },
          onerror: (err) => {
            console.error(err);
            setStatusMessage('Connection error occurred.');
            setIsError(true);
            setIsConnected(false);
          }
        }
      });

    } catch (err) {
      console.error('Failed to connect:', err);
      setStatusMessage('Failed to access microphone or connect.');
      setIsError(true);
      setIsConnected(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current.onaudioprocess = null;
      scriptProcessorRef.current = null;
    }

    sourceNodesRef.current.forEach(node => {
      try { node.stop(); } catch(e) {}
    });
    sourceNodesRef.current.clear();

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    
    setIsConnected(false);
    setStatusMessage('Ready to connect');
    setInputAnalyser(null);
    setOutputAnalyser(null);
  }, []);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return (
    <div className="flex flex-col w-full max-w-2xl mx-auto bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-100 min-h-[500px]">
      
      {/* Header */}
      <div className="bg-gray-50 px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-orange-400'}`}></div>
          <span className="font-semibold text-gray-700">Xcan It Voice Guide</span>
        </div>
        <div className="text-xs text-gray-400 font-mono">
           {isConnected ? 'LIVE' : 'OFFLINE'}
        </div>
      </div>

      {/* Main Visualizer Area */}
      <div className="bg-white p-8 flex flex-col items-center justify-center space-y-8 flex-shrink-0">
        
        {/* Agent Visualizer */}
        <div className="w-full relative">
            <div className="absolute top-0 left-0 text-xs font-bold text-blue-600 uppercase tracking-widest mb-1">Emma</div>
            <div className="h-24 bg-blue-50/50 rounded-xl border border-blue-100 flex items-center justify-center overflow-hidden">
                {isConnected ? (
                    <AudioVisualizer analyser={outputAnalyser} isActive={true} barColor="#3b82f6" />
                ) : (
                    <div className="text-blue-300 text-sm font-medium">Ready to help</div>
                )}
            </div>
        </div>

        {/* User Visualizer */}
        <div className="w-full relative">
            <div className="absolute top-0 left-0 text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">You</div>
            <div className="h-16 bg-gray-50/50 rounded-xl border border-gray-200 flex items-center justify-center overflow-hidden">
                {isConnected ? (
                    <AudioVisualizer analyser={inputAnalyser} isActive={true} barColor="#9ca3af" />
                ) : (
                    <div className="text-gray-400 text-sm">Microphone off</div>
                )}
            </div>
        </div>
      </div>

      {/* Transcription Area (Scrollable) */}
      <div className="flex-1 bg-gray-50 border-t border-gray-100 p-4 overflow-y-auto max-h-64 space-y-3">
         {transcripts.length === 0 && (
             <div className="text-center text-gray-400 text-sm py-8 italic">
                 Start the conversation to see the transcript here...
             </div>
         )}
         {transcripts.map((item) => (
             <div key={item.id} className={`flex ${item.speaker === 'user' ? 'justify-end' : 'justify-start'}`}>
                 <div className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                     item.speaker === 'user' 
                     ? 'bg-white border border-gray-200 text-gray-700 rounded-tr-sm' 
                     : 'bg-blue-600 text-white rounded-tl-sm shadow-md'
                 }`}>
                     <p>{item.text}</p>
                 </div>
             </div>
         ))}
         <div ref={transcriptEndRef} />
      </div>

      {/* Controls */}
      <div className="p-6 bg-white border-t border-gray-100">
        {isError && (
          <div className="mb-4 text-center">
             <span className="text-red-500 text-sm bg-red-50 px-3 py-1 rounded-full">{statusMessage}</span>
          </div>
        )}
        
        {!isError && !isConnected && statusMessage !== 'Ready to connect' && (
           <div className="mb-4 text-center">
             <span className="text-blue-600 text-sm animate-pulse">{statusMessage}</span>
           </div>
        )}

        <div className="flex justify-center">
            {!isConnected ? (
            <button
                onClick={connectToGemini}
                className="group relative inline-flex items-center justify-center px-8 py-3 text-base font-medium text-white transition-all duration-200 bg-blue-600 border border-transparent rounded-full hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 shadow-lg hover:shadow-blue-500/30 w-full md:w-auto"
            >
                <span className="mr-2">Tap to Speak</span>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path></svg>
            </button>
            ) : (
            <button
                onClick={disconnect}
                className="group relative inline-flex items-center justify-center px-8 py-3 text-base font-medium text-red-600 transition-all duration-200 bg-red-50 border border-red-200 rounded-full hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 w-full md:w-auto"
            >
                <span className="mr-2">End Session</span>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
            )}
        </div>
      </div>
    </div>
  );
};