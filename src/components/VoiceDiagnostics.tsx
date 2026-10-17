"use client";

import { useEffect, useState } from "react";

// Diagnóstico de voz/mic no aparelho atual — abre no celular via tunnel HTTPS
// e mostra exatamente qual pré-condição falha.

interface Check {
  label: string;
  ok: boolean | null; // null = não testável
  detail: string;
}

export default function VoiceDiagnostics() {
  const [checks, setChecks] = useState<Check[]>([]);

  useEffect(() => {
    async function run() {
      const results: Check[] = [];
      const ua = navigator.userAgent;

      results.push({
        label: "Navegador",
        ok: null,
        detail: /iPhone|iPad|Macintosh/.test(ua) && "ontouchstart" in window
          ? `${ua.match(/(CriOS|FxiOS|EdgiOS|Version)\/[\d.]+/) ? "iOS (Chrome/Firefox/Edge = WebKit por baixo)" : "Safari iOS"} — iOS não possui Web Speech API de reconhecimento`
          : ua.slice(0, 90),
      });

      results.push({
        label: "Contexto seguro (HTTPS)",
        ok: window.isSecureContext,
        detail: window.isSecureContext
          ? "isSecureContext = true — microfone liberado em princípio"
          : "isSecureContext = false — navegador BLOQUEIA o microfone (sem HTTPS)",
      });

      const SR =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      results.push({
        label: "SpeechRecognition (voz → texto)",
        ok: !!SR,
        detail: SR
          ? "API de reconhecimento disponível"
          : "Indisponível neste navegador — voz não funcionará (texto funciona)",
      });

      results.push({
        label: "mediaDevices",
        ok: !!navigator.mediaDevices,
        detail: navigator.mediaDevices
          ? "navigator.mediaDevices presente"
          : "Ausente — normalmente sinal de contexto inseguro ou navegador antigo",
      });

      // Permissão do microfone
      let perm: string = "desconhecida";
      try {
        const p = await navigator.permissions.query({ name: "microphone" as PermissionName });
        perm = p.state;
      } catch {
        perm = "não suportada por este navegador (iOS)";
      }
      results.push({
        label: "Permissão do microfone",
        ok: perm === "granted" ? true : perm === "prompt" ? null : false,
        detail: `estado: ${perm}${perm === "denied" ? " — negada; redefina nas configurações do site" : ""}`,
      });

      // Teste real de captura
      if (navigator.mediaDevices?.getUserMedia) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach((t) => t.stop());
          results.push({
            label: "Captura de áudio (getUserMedia)",
            ok: true,
            detail: "Microfone acessado com sucesso neste aparelho",
          });
        } catch (err: any) {
          results.push({
            label: "Captura de áudio (getUserMedia)",
            ok: false,
            detail: `falhou: ${err?.name ?? "?"} — ${err?.message ?? "sem detalhe"}`,
          });
        }
      }

      // TTS (resposta falada)
      results.push({
        label: "Síntese de voz (resposta falada)",
        ok: "speechSynthesis" in window,
        detail: "speechSynthesis" in window
          ? "Disponível (pode exigir toque prévio no iOS)"
          : "Ausente — Jarvis não fala neste navegador",
      });

      setChecks(results);
    }
    run();
  }, []);

  return (
    <div className="mt-4 rounded-2xl border border-white/10 bg-white/3 p-4">
      <h3 className="mb-3 text-xs font-semibold tracking-wider text-[#00c6ff] uppercase">
        Diagnóstico de Voz (aparelho atual)
      </h3>
      <ul className="space-y-2 text-xs">
        {checks.map((c) => (
          <li key={c.label} className="flex items-start gap-2">
            <span className="mt-0.5">
              {c.ok === null ? "⚪" : c.ok ? "✅" : "❌"}
            </span>
            <div>
              <p className="font-medium text-slate-200">{c.label}</p>
              <p className="text-slate-400">{c.detail}</p>
            </div>
          </li>
        ))}
      </ul>
      {checks.length === 0 && (
        <p className="animate-pulse text-xs text-slate-400">coletando…</p>
      )}
    </div>
  );
}
