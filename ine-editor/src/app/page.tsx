"use client";

import dynamic from "next/dynamic";

const IneEditor = dynamic(() => import("@/components/IneEditor"), {
  ssr: false,
  loading: () => <div className="text-center p-8">Cargando editor...</div>,
});

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-100 py-8">
      <div className="container mx-auto">
        <h1 className="text-3xl font-bold text-center mb-2 text-gray-900">Editor de Credenciales</h1>
        <p className="text-center text-gray-600 mb-8">Herramienta para editar datos de plantilla</p>
        <IneEditor />
      </div>
    </main>
  );
}
