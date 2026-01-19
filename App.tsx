import React from 'react';
import { VoiceAgent } from './components/VoiceAgent';

const App: React.FC = () => {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4 md:p-8 overflow-hidden relative">
      {/* Decorative background blobs */}
      <div className="fixed top-[-10%] left-[-10%] w-[40vw] h-[40vw] bg-blue-100 rounded-full mix-blend-multiply filter blur-3xl opacity-40"></div>
      <div className="fixed bottom-[-10%] right-[-10%] w-[40vw] h-[40vw] bg-indigo-100 rounded-full mix-blend-multiply filter blur-3xl opacity-40"></div>
      
      <header className="mb-8 text-center relative z-10">
        <div className="inline-block px-3 py-1 bg-blue-600 text-white text-[10px] font-black uppercase tracking-[0.2em] rounded-full mb-4 shadow-lg shadow-blue-500/20">
          Onboarding
        </div>
        <h1 className="text-4xl font-black text-slate-900 mb-2 tracking-tight">Xcan It <span className="text-blue-600">Smart Help</span></h1>
        <p className="text-slate-500 font-medium">Meet Emma, your personal platform guide.</p>
      </header>
      
      <main className="w-full relative z-20">
        <VoiceAgent />
      </main>

      <footer className="mt-12 text-center text-slate-400 text-[11px] font-bold uppercase tracking-widest relative z-10">
        <p>© 2024 Xcan It • Powered by Gemini AI</p>
      </footer>
    </div>
  );
};

export default App;