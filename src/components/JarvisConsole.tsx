"use client";

import { useRef, useState } from "react";
import type { JarvisResponse } from "@/lib/jarvis/types";

interface Msg {
  from: "you" | "jarvis";
  text: string;
  time: string;
}

const QUICK = [
  "Jarvis, bom dia",
  "Que horas são?",
  "Ligar luz da sala",
  "Desligar luz da sala",
  "Status do sistema",
  "Ajuda",
];

export default function JarvisConsole() {
  const [messages, setMessages] = useState<Msg[]>([
    {
      from: "jarvis",
      text: "Online. Fale comigo por texto ou voz. Tente: “Ligar luz da sala”.",
      time: "--:--",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const recogRef = useRef<any>(null);

  function speak(text: string) {
    try {
      const synth = window.speechSynthesis;
      if (!synth) return;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "pt-BR";
      synth.speak(u);
    } catch {
      /* sem TTS */
    }
  }

  async function send(raw?: string) {
    const command = (raw ?? input).trim();
    if (!command || loading) return;
    setInput("");
    setLoading(true);
    setMessages((m) => [
      ...m,
      { from: "you", text: command, time: new Date().toLocaleTimeString("pt-BR") },
    ]);
    const history = messages.slice(-6).map((m) => ({
      role: m.from === "you" ? "user" : "assistant",
      content: m.text,
    }));
    try {
      const res = await fetch("/api/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command, history }),
      });
      const data: JarvisResponse = await res.json();
      setMessages((m) => [
        ...m,
        {
          from: "jarvis",
          text: data.text,
          time: new Date().toLocaleTimeString("pt-BR"),
        },
      ]);
      if (data.speak) speak(data.text);
    } catch {
      setMessages((m) => [
        ...m,
        { from: "jarvis", text: "Erro de comunicação com o núcleo.", time: "" },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function toggleVoice() {
    const SR =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SR) {
      alert("Reconhecimento de voz não suportado neste navegador. Use Chrome.");
      return;
    }
    if (listening) {
      recogRef.current?.stop();
      setListening(false);
      return;
    }
    const recog = new SR();
    recogRef.current = recog;
    recog.lang = "pt-BR";
    recog.interimResults = false;
    recog.onresult = (e: any) => {
      const text = e.results[0][0].transcript as string;
      setListening(false);
      send(text);
    };
    recog.onend = () => setListening(false);
    recog.onerror = () => setListening(false);
    recog.start();
    setListening(true);
  }

  return (
    <section className="flex flex-col rounded-2xl border border-cyan-500/20 bg-slate-950/80 p-4 shadow-[0_0_40px_rgba(34,211,238,0.12)] backdrop-blur">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-widest text-cyan-300 uppercase">
          Console Jarvis
        </h2>
        <span
          className={`h-2 w-2 rounded-full ${loading ? "animate-ping bg-yellow-400" : "bg-cyan-400 shadow-[0_0_8px_#38bdf8]"}`}
        />
      </div>

      <div className="mb-3 flex h-72 flex-col gap-2 overflow-y-auto rounded-xl bg-black/60 p-3 font-mono text-sm">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`max-w-[85%] rounded-lg px-3 py-2 ${
              m.from === "you"
                ? "self-end bg-cyan-600/20 text-cyan-100"
                : "self-start bg-slate-800/80 text-slate-100"
            }`}
          >
            <span className="mb-1 block text-[10px] uppercase opacity-60">
              {m.from === "you" ? "Você" : "Jarvis"} · {m.time}
            </span>
            {m.text}
          </div>
        ))}
        {loading && <p className="animate-pulse text-cyan-400">processando…</p>}
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {QUICK.map((q) => (
          <button
            key={q}
            onClick={() => send(q)}
            className="rounded-full border border-cyan-500/30 px-3 py-1 text-xs text-cyan-200 transition hover:bg-cyan-500/20"
          >
            {q}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Digite um comando…"
          className="jc-input flex-1 rounded-xl border bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none"
        />
        <button
          onClick={toggleVoice}
          title="Falar"
          className={`rounded-xl px-4 py-2 text-sm font-bold ${listening ? "animate-pulse bg-red-500 text-white" : "bg-slate-800 text-cyan-300 hover:bg-slate-700"}`}
        >
          {listening ? "●" : "🎙"}
        </button>
        <button
          onClick={() => send()}
          disabled={loading}
          className="rounded-xl bg-cyan-500 px-4 py-2 text-sm font-bold text-black hover:bg-cyan-400 disabled:opacity-50"
        >
          Enviar
        </button>
      </div>
    </section>
  );
}
