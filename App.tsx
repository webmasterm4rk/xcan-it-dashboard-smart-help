import React from 'react';
import { VoiceAgent } from './components/VoiceAgent';

const App: React.FC = () => {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
      <header className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Xcan It Smart Help</h1>
        <p className="text-gray-600">Your calm guide to getting started.</p>
      </header>
      
      <main className="w-full max-w-md z-10">
        <VoiceAgent />
      </main>

      <footer className="mt-12 text-center text-gray-400 text-sm">
        <p>© Xcan It Support. Powered by Gemini 2.5 Live API.</p>
      </footer>
      
      {/* Decorative background blobs */}
      <div className="fixed top-0 left-0 w-64 h-64 bg-blue-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 -translate-x-1/2 -translate-y-1/2"></div>
      <div className="fixed bottom-0 right-0 w-64 h-64 bg-purple-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 translate-x-1/2 translate-y-1/2"></div>
    </div>
  );
};

export default App;