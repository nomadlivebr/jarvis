"use client";

import React from "react";

interface AudioWaveformProps {
  state: "idle" | "listening" | "processing" | "speaking";
  audioLevel?: number; // 0.0 a 1.0
}

export default function AudioWaveform({ state, audioLevel = 0 }: AudioWaveformProps) {
  const isListening = state === "listening";
  const isSpeaking = state === "speaking";
  const isProcessing = state === "processing";

  // Alturas base das 8 barras conforme o HTML de referência
  const baseHeights = [10, 20, 16, 32, 26, 36, 22, 12];

  return (
    <div className="flex h-11 items-center justify-center gap-1.5 rounded-full border border-white/8 bg-white/3 px-7 backdrop-blur-md transition-all duration-300 hover:border-cyan-400/30">
      {baseHeights.map((h, i) => {
        // Multiplicador acústico em tempo real
        const dynamicScale = 1 + audioLevel * (1.2 + (i % 3) * 0.4);
        const dynamicHeight = Math.min(38, Math.max(8, h * dynamicScale));

        const duration = isListening
          ? "0.6s"
          : isSpeaking
          ? "0.8s"
          : isProcessing
          ? "0.4s"
          : "1.8s";

        const delay = `${(i * 0.1).toFixed(1)}s`;

        return (
          <div
            key={i}
            style={{
              height: `${dynamicHeight}px`,
              animationDuration: duration,
              animationDelay: delay,
            }}
            className={`w-0.75 rounded-full transition-all duration-100 ${
              isListening
                ? "bg-cyan-300 shadow-[0_0_12px_#00c6ff] animate-bounce-bar"
                : isSpeaking
                ? "bg-cyan-400 shadow-[0_0_10px_#00c6ff] animate-bounce-bar"
                : isProcessing
                ? "bg-sky-400 shadow-[0_0_8px_#38bdf8] animate-bounce-bar"
                : "bg-[#00c6ff] opacity-70 shadow-[0_0_6px_#00c6ff] animate-bounce-bar"
            }`}
          />
        );
      })}
    </div>
  );
}
