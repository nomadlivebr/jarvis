"use client";

import React, { useEffect, useRef, useState } from "react";
import JarvisOrb from "./JarvisOrb";
import AudioWaveform from "./AudioWaveform";
import StatusPanel from "./StatusPanel";
import VoiceDiagnostics from "./VoiceDiagnostics";
import type { JarvisResponse } from "@/lib/jarvis/types";

interface Msg {
  id: string;
  from: "you" | "jarvis";
  text: string;
  time: string;
}

export default function JarvisMain() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [showStatusDrawer, setShowStatusDrawer] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Nível acústico em tempo real (0.0 a 1.0)
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Gerenciamento de Vozes Neurais (Web Speech Synthesis)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceUri, setSelectedVoiceUri] = useState<string>("");
  const [voiceRate, setVoiceRate] = useState<number>(1.03);
  const [voicePitch, setVoicePitch] = useState<number>(0.94);

  // Saudação de acordo com o horário local
  const [greeting, setGreeting] = useState("Boa tarde, Thiago");

  useEffect(() => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) {
      setGreeting("Bom dia, Thiago");
    } else if (hour >= 12 && hour < 18) {
      setGreeting("Boa tarde, Thiago");
    } else {
      setGreeting("Boa noite, Thiago");
    }
  }, []);

  // Monitor acústico do microfone em tempo real (Web Audio API)
  function startAudioMeter() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;

      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          streamRef.current = stream;
          const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
          if (!AudioCtx) return;

          const audioCtx = new AudioCtx();
          audioContextRef.current = audioCtx;

          const source = audioCtx.createMediaStreamSource(stream);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 64;
          analyser.smoothingTimeConstant = 0.5;
          source.connect(analyser);

          const dataArray = new Uint8Array(analyser.frequencyBinCount);

          const checkLevel = () => {
            analyser.getByteFrequencyData(dataArray);

            // Média de energia nas frequências de fala (frequências vocais médias)
            let sum = 0;
            for (let i = 2; i < dataArray.length; i++) {
              sum += dataArray[i];
            }
            const avg = sum / (dataArray.length - 2);

            // Normalização suave entre 0 e 1
            const normalized = Math.min(1, Math.max(0, (avg - 12) / 85));
            setAudioLevel(normalized);

            animFrameRef.current = requestAnimationFrame(checkLevel);
          };

          checkLevel();
        })
        .catch(() => {
          // Fallback silencioso se o microfone não permitir captura secundária
        });
    } catch {
      /* ignore */
    }
  }

  function stopAudioMeter() {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    setAudioLevel(0);
  }

  // Pulso rítmico simulado enquanto o Jarvis está falando
  useEffect(() => {
    let timer: any;
    if (speaking && !listening) {
      timer = setInterval(() => {
        setAudioLevel(0.25 + Math.random() * 0.5);
      }, 100);
    } else if (!listening) {
      setAudioLevel(0);
    }
    return () => clearInterval(timer);
  }, [speaking, listening]);

  // Carregar e priorizar vozes neurais em PT-BR
  useEffect(() => {
    function loadVoices() {
      if (typeof window === "undefined" || !window.speechSynthesis) return;
      const available = window.speechSynthesis.getVoices();
      if (!available || available.length === 0) return;

      const ptList = available.filter((v) => v.lang.toLowerCase().startsWith("pt"));
      const listToUse = ptList.length > 0 ? ptList : available;
      setVoices(listToUse);

      setSelectedVoiceUri((prev) => {
        if (prev && listToUse.some((v) => v.voiceURI === prev)) return prev;

        const antonio = listToUse.find(
          (v) => v.name.includes("Antonio") && (v.name.includes("Natural") || v.name.includes("Online"))
        );
        if (antonio) return antonio.voiceURI;

        const naturalPt = listToUse.find(
          (v) => (v.name.includes("Natural") || v.name.includes("Online")) && v.lang.includes("BR")
        );
        if (naturalPt) return naturalPt.voiceURI;

        const googlePt = listToUse.find(
          (v) => v.name.includes("Google") && v.lang.includes("BR")
        );
        if (googlePt) return googlePt.voiceURI;

        const anyPtBr = listToUse.find((v) => v.lang.includes("BR"));
        if (anyPtBr) return anyPtBr.voiceURI;

        return listToUse[0]?.voiceURI || "";
      });
    }

    loadVoices();
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
  }, []);

  const [messages, setMessages] = useState<Msg[]>([
    {
      id: "initial",
      from: "jarvis",
      text: "Sistemas neurais online e operando localmente. Como posso ajudar você hoje?",
      time: "--:--",
    },
  ]);

  const latestResponse = messages.filter((m) => m.from === "jarvis").slice(-1)[0];
  const latestQuestion = messages.filter((m) => m.from === "you").slice(-1)[0];

  const recogRef = useRef<any>(null);
  const transcriptBufferRef = useRef<string>("");

  // Síntese de voz neural otimizada em PT-BR
  function speak(text: string) {
    try {
      const synth = window.speechSynthesis;
      if (!synth) return;
      synth.cancel();
      if (synth.paused) {
        synth.resume();
      }

      const u = new SpeechSynthesisUtterance(text);
      u.lang = "pt-BR";
      u.rate = voiceRate;
      u.pitch = voicePitch;
      u.volume = 1.0;

      if (selectedVoiceUri) {
        const found = voices.find((v) => v.voiceURI === selectedVoiceUri);
        if (found) {
          u.voice = found;
        }
      }

      u.onstart = () => setSpeaking(true);
      u.onend = () => {
        setSpeaking(false);
        setAudioLevel(0);
      };
      u.onerror = () => {
        setSpeaking(false);
        setAudioLevel(0);
      };
      synth.speak(u);
    } catch {
      setSpeaking(false);
      setAudioLevel(0);
    }
  }

  function testActiveVoice() {
    speak("Sistemas Jarvis operando com voz neural e detecção acústica em tempo real.");
  }

  async function send(raw?: string) {
    const command = (raw ?? input).trim();
    if (!command || loading) return;

    setInput("");
    transcriptBufferRef.current = "";
    setLoading(true);

    const now = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

    setMessages((prev) => [
      ...prev,
      { id: Math.random().toString(), from: "you", text: command, time: now },
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

      setMessages((prev) => [
        ...prev,
        {
          id: Math.random().toString(),
          from: "jarvis",
          text: data.text,
          time: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
        },
      ]);

      if (data.speak) {
        speak(data.text);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: Math.random().toString(),
          from: "jarvis",
          text: "Erro de comunicação com o núcleo local.",
          time: now,
        },
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
      alert("Reconhecimento de voz não suportado neste navegador. Recomendamos o Google Chrome ou Edge.");
      return;
    }

    // Desbloqueia sintetizador de áudio no celular
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.resume();
    }

    if (listening) {
      // Usuário clicou em parar
      recogRef.current?.stop();
      stopAudioMeter();
      setListening(false);

      const pending = transcriptBufferRef.current.trim();
      if (pending) {
        send(pending);
      }
      return;
    }

    try {
      const recog = new SR();
      recogRef.current = recog;
      recog.lang = "pt-BR";
      recog.interimResults = true;
      recog.continuous = false;
      transcriptBufferRef.current = "";

      recog.onresult = (e: any) => {
        let interim = "";
        let final = "";

        for (let i = e.resultIndex; i < e.results.length; ++i) {
          if (e.results[i].isFinal) {
            final += e.results[i][0].transcript;
          } else {
            interim += e.results[i][0].transcript;
          }
        }

        const currentText = (final || interim).trim();
        if (currentText) {
          transcriptBufferRef.current = currentText;
          setInput(currentText);
        }

        if (final.trim()) {
          stopAudioMeter();
          setListening(false);
          send(final.trim());
        }
      };

      recog.onend = () => {
        stopAudioMeter();
        setListening(false);
        const pending = transcriptBufferRef.current.trim();
        if (pending && !loading) {
          send(pending);
        }
      };

      recog.onerror = (e: any) => {
        console.warn("[VOZ] Erro na captura de áudio:", e.error);
        stopAudioMeter();
        setListening(false);

        let msg = "Falha ao capturar áudio.";
        if (e.error === "not-allowed") {
          msg = "Permissão de microfone negada no navegador. Permita o acesso ao microfone nas configurações do site.";
        } else if (e.error === "no-speech") {
          msg = "Nenhuma fala detectada. Fale mais perto do microfone.";
        } else if (e.error === "network") {
          msg = "Falha de rede na transcrição do Google. Verifique a conexão.";
        } else if (e.error === "audio-capture") {
          msg = "Nenhum microfone encontrado no aparelho.";
        }

        setMessages((prev) => [
          ...prev,
          {
            id: Math.random().toString(),
            from: "jarvis",
            text: `[Aviso de Áudio]: ${msg}`,
            time: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
          },
        ]);
      };

      recog.start();
      startAudioMeter();
      setListening(true);
    } catch (err: any) {
      stopAudioMeter();
      setListening(false);
      setMessages((prev) => [
        ...prev,
        {
          id: Math.random().toString(),
          from: "jarvis",
          text: `[Erro]: Não foi possível iniciar o microfone (${err?.message || "falha desconhecida"}).`,
          time: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
    }
  }

  const currentVoiceObj = voices.find((v) => v.voiceURI === selectedVoiceUri);
  const currentVoiceLabel = currentVoiceObj
    ? currentVoiceObj.name
        .replace(/Microsoft|Online|\(Natural\)|Google|Portuguese \(Brazil\)|Português/gi, "")
        .trim() || "Natural"
    : "Voz Neural";

  const orbState = listening
    ? "listening"
    : loading
    ? "processing"
    : speaking
    ? "speaking"
    : "idle";

  return (
    <div className="relative flex h-screen w-full flex-col justify-between overflow-hidden bg-[#050914] text-white">
      {/* Luz ambiente de fundo (Radial Gradient como em interface_jarvis_melhorada.html) */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,#0a1931_0%,#050914_70%)]" />

      {/* Header Navigation com Pílulas Translúcidas */}
      <header className="relative z-20 flex w-full items-center justify-between px-6 py-5 sm:px-10">
        {/* Lado Esquerdo: Pílula de Marca J.A.R.V.I.S. com LED ciano */}
        <div className="header-pill select-none">
          <div className="status-dot" />
          <span className="font-medium tracking-wider text-slate-200">J.A.R.V.I.S.</span>
        </div>

        {/* Centro: Pílula de Detecção & Seletor de Idioma/Voz */}
        <div className="hidden sm:flex items-center gap-2">
          <div className="header-pill group">
            <span className="text-slate-300">Detecção Automática</span>
            <button
              onClick={testActiveVoice}
              title="Testar voz"
              className="text-[#00c6ff] hover:scale-110 transition-transform"
            >
              ⇄
            </button>
            <span className="text-slate-400">Português do Brasil</span>
            {voices.length > 0 && (
              <select
                value={selectedVoiceUri}
                onChange={(e) => setSelectedVoiceUri(e.target.value)}
                title="Trocar voz neural"
                className="ml-1 cursor-pointer bg-transparent text-[11px] text-[#00c6ff] outline-none"
              >
                {voices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI} className="bg-[#050914] text-slate-200">
                    {v.name.replace(/Microsoft|Online|\(Natural\)|Google|Portuguese \(Brazil\)/gi, "").trim() || v.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Lado Direito: Histórico & Painel */}
        <div className="flex items-center gap-3">
          <div
            onClick={() => setShowHistory(true)}
            className="header-pill select-none"
          >
            <span>⏱</span>
            <span>Histórico</span>
            {messages.length > 1 && (
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#00c6ff]/20 text-[10px] font-semibold text-[#00c6ff]">
                {messages.length - 1}
              </span>
            )}
          </div>

          <div
            onClick={() => setShowStatusDrawer(true)}
            className="header-pill select-none hover:border-[#00c6ff]/40"
          >
            <span>⚙</span>
            <span>Painel</span>
          </div>
        </div>
      </header>

      {/* Conteúdo Central Principal (Orbe + Saudação + Visualizador) */}
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center gap-6 px-4 text-center">
        {/* Orbe Central com Reação Acústica ao Vivo */}
        <div className="relative flex items-center justify-center">
          <JarvisOrb
            state={orbState}
            audioLevel={audioLevel}
            onClick={toggleVoice}
          />
        </div>

        {/* Seção de Saudação & Título */}
        <div className="space-y-2">
          <h1 className="text-2xl font-medium tracking-wide text-white sm:text-3xl">
            {listening ? "Ouvindo você..." : loading ? "Processando..." : greeting}
          </h1>
          <p className="text-sm font-light text-[#00c6ff] opacity-85">
            {listening
              ? "Fale naturalmente com o Jarvis"
              : loading
              ? "Processando no núcleo local com privacidade total"
              : `Núcleo ativo com ${currentVoiceLabel} · Pronto para responder`}
          </p>
        </div>

        {/* Visualizador de Barras de Áudio Reativo */}
        <AudioWaveform state={orbState} audioLevel={audioLevel} />

        {/* Card de Resposta do Jarvis */}
        {latestResponse && latestResponse.id !== "initial" && (
          <div className="w-full max-w-lg animate-fadeIn px-2">
            <div className="relative rounded-2xl border border-white/10 bg-white/4 p-4 text-left shadow-2xl backdrop-blur-xl">
              <div className="mb-1.5 flex items-center justify-between text-[11px] font-mono text-[#00c6ff]">
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#00f2fe]" />
                  RESPOSTA DO JARVIS
                </span>
                <button
                  onClick={() => speak(latestResponse.text)}
                  title="Ouvir novamente"
                  className="flex items-center gap-1 text-slate-400 hover:text-white transition-colors"
                >
                  <span>🔊</span>
                  <span>Ouvir</span>
                </button>
              </div>
              <p className="text-sm leading-relaxed text-slate-200">
                {latestResponse.text}
              </p>
              {latestQuestion && (
                <p className="mt-2 border-t border-white/5 pt-1.5 text-[11px] text-slate-400">
                  Você: "{latestQuestion.text}"
                </p>
              )}
            </div>
          </div>
        )}

        {/* Seção de Entrada Inteligente (Input + Mic Overlap) */}
        <div className="relative mt-2 flex w-full max-w-xl flex-col items-center">
          <button
            onClick={toggleVoice}
            title={listening ? "Parar de ouvir" : "Falar com o Jarvis"}
            className={`mic-btn-overlap ${
              listening ? "bg-red-500 shadow-[0_0_30px_rgba(239,68,68,0.8)]" : ""
            }`}
          >
            {listening ? (
              <div className="h-4 w-4 rounded-sm bg-white animate-pulse" />
            ) : (
              <svg className="h-6 w-6 fill-white" viewBox="0 0 24 24">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.39-.9.88 0 2.76-2.24 5-5 5s-5-2.24-5-5c0-.49-.41-.88-.9-.88s-.9.39-.9.88c0 3.35 2.5 6.13 5.71 6.53V21h-2v2h6v-2h-2v-2.59c3.21-.4 5.71-3.18 5.71-6.53 0-.49-.41-.88-.9-.88z" />
              </svg>
            )}
          </button>

          <div className="text-input-wrapper relative flex items-center">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="Ou digite uma mensagem para o Jarvis..."
              className="jm-input w-full bg-transparent text-center text-sm text-white outline-none sm:text-base"
            />

            {input.trim().length > 0 && (
              <button
                onClick={() => send()}
                disabled={loading}
                title="Enviar comando"
                className="absolute right-4 flex h-8 w-8 items-center justify-center rounded-full bg-[#00c6ff] text-black transition-transform hover:scale-110 active:scale-95 disabled:opacity-50"
              >
                <svg className="h-4 w-4 fill-current" viewBox="0 0 20 20">
                  <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </main>

      {/* Footer Minimalista */}
      <footer className="relative z-20 pb-5 text-center text-[11px] font-normal tracking-widest text-[#4a5a6a] uppercase">
        J.A.R.V.I.S. CORE · LOCAL & PRIVADO · PT-BR
      </footer>

      {/* Drawer Lateral de Hardware / Configurações */}
      {showStatusDrawer && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-md animate-fadeIn">
          <div className="glass-panel-dark h-full w-full max-w-md p-6 shadow-2xl flex flex-col justify-between overflow-y-auto">
            <div>
              <div className="flex items-center justify-between pb-4 border-b border-white/10">
                <div>
                  <h2 className="text-base font-semibold text-white">Central de Operações</h2>
                  <p className="text-xs text-[#00c6ff]">Status da Rock Pi & Configurações de Voz</p>
                </div>
                <button
                  onClick={() => setShowStatusDrawer(false)}
                  className="rounded-full p-2 text-slate-400 hover:bg-white/10 hover:text-white"
                >
                  ✕
                </button>
              </div>

              <div className="mt-5 rounded-2xl border border-white/10 bg-white/3 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-xs font-semibold tracking-wider text-[#00c6ff] uppercase">
                    Calibração Vocal Neural
                  </h3>
                  <button
                    onClick={testActiveVoice}
                    className="rounded-full bg-[#00c6ff]/20 px-2.5 py-1 text-[11px] font-medium text-[#00c6ff] hover:bg-[#00c6ff]/30"
                  >
                    🔊 Testar
                  </button>
                </div>

                <div className="space-y-3 text-xs">
                  <div>
                    <label className="text-[10px] text-slate-400 uppercase block mb-1">
                      Voz de Síntese
                    </label>
                    <select
                      value={selectedVoiceUri}
                      onChange={(e) => setSelectedVoiceUri(e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-[#050914] p-2 text-xs text-slate-200 outline-none hover:border-[#00c6ff]/40"
                    >
                      {voices.map((v) => (
                        <option key={v.voiceURI} value={v.voiceURI}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div>
                      <div className="flex justify-between text-[10px] text-slate-400 uppercase mb-1">
                        <span>Velocidade</span>
                        <span className="text-[#00c6ff] font-mono">{voiceRate.toFixed(2)}x</span>
                      </div>
                      <input
                        type="range"
                        min="0.8"
                        max="1.3"
                        step="0.02"
                        value={voiceRate}
                        onChange={(e) => setVoiceRate(parseFloat(e.target.value))}
                        className="w-full accent-[#00c6ff]"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-[10px] text-slate-400 uppercase mb-1">
                        <span>Timbre (Pitch)</span>
                        <span className="text-[#00c6ff] font-mono">{voicePitch.toFixed(2)}</span>
                      </div>
                      <input
                        type="range"
                        min="0.8"
                        max="1.2"
                        step="0.02"
                        value={voicePitch}
                        onChange={(e) => setVoicePitch(parseFloat(e.target.value))}
                        className="w-full accent-[#00c6ff]"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-6">
                <StatusPanel />
                <VoiceDiagnostics />
              </div>
            </div>

            <div className="pt-6 border-t border-white/10 text-center">
              <button
                onClick={() => setShowStatusDrawer(false)}
                className="w-full rounded-xl bg-[#00c6ff]/10 border border-[#00c6ff]/20 py-2.5 text-xs font-semibold text-[#00c6ff] hover:bg-[#00c6ff]/20 transition-colors"
              >
                Salvar & Fechar Painel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Histórico de Diálogo */}
      {showHistory && (
        <div className="fixed inset-0 z-50 flex justify-start bg-black/70 backdrop-blur-md">
          <div className="glass-panel-dark h-full w-full max-w-md p-6 shadow-2xl flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-4 border-b border-white/10">
                <div>
                  <h2 className="text-base font-semibold text-white">Histórico de Diálogo</h2>
                  <p className="text-xs text-slate-400">Interações da sessão atual</p>
                </div>
                <button
                  onClick={() => setShowHistory(false)}
                  className="rounded-full p-2 text-slate-400 hover:bg-white/10 hover:text-white"
                >
                  ✕
                </button>
              </div>

              <div className="mt-4 max-h-[70vh] space-y-3 overflow-y-auto pr-2">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`rounded-xl p-3 text-xs leading-relaxed ${
                      m.from === "you"
                        ? "ml-8 bg-[#0072ff]/20 border border-[#00c6ff]/25 text-sky-100"
                        : "mr-8 bg-white/4 border border-white/10 text-slate-200"
                    }`}
                  >
                    <div className="mb-1 flex items-center justify-between text-[10px] text-slate-400">
                      <span className="font-semibold uppercase">
                        {m.from === "you" ? "Você" : "Jarvis"}
                      </span>
                      <span>{m.time}</span>
                    </div>
                    {m.text}
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-4 border-t border-white/10">
              <button
                onClick={() => setShowHistory(false)}
                className="w-full rounded-xl bg-white/10 py-2.5 text-xs font-semibold text-slate-200 hover:bg-white/15 transition-colors"
              >
                Voltar à Interface
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
