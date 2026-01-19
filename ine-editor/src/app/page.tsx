"use client";

import dynamic from "next/dynamic";

const IneEditor = dynamic(() => import("@/components/IneEditor"), {
  ssr: false,
  loading: () => <div className="text-center p-8">Cargando editor...</div>,
});

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-200">
      <nav className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="container mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-500/20">
              <span className="font-bold text-white">ID</span>
            </div>
            <h1 className="text-lg font-semibold tracking-tight text-white">Pro ID Editor <span className="text-slate-500 text-sm font-normal ml-2">v2.0</span></h1>
          </div>
          <div className="flex items-center gap-4 text-sm text-slate-400">
             <span className="flex items-center gap-2 px-3 py-1 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                System Active
             </span>
          </div>
        </div>
      </nav>
      
      <div className="container mx-auto py-8 px-4">
        <IneEditor />
      </div>
    </main>
  );
}
