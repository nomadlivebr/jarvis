"use client";

import React from "react";

interface JarvisOrbProps {
  state: "idle" | "listening" | "processing" | "speaking";
  audioLevel?: number; // Volume acústico em tempo real de 0.0 a 1.0
  onClick?: () => void;
}

export default function JarvisOrb({ state, audioLevel = 0, onClick }: JarvisOrbProps) {
  const isListening = state === "listening";
  const isProcessing = state === "processing";
  const isSpeaking = state === "speaking";

  // Reação dinâmica ao volume da voz: escala, brilho e intensidade do halo
  const scale = 1 + audioLevel * 0.35;
  const ringScale = 1 + audioLevel * 0.25;
  const glowSpread = 60 + audioLevel * 70;
  const glowAlpha = 0.45 + audioLevel * 0.45;
  const brightness = 1 + audioLevel * 0.45;

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      title={isListening ? "Clique para interromper" : "Toque no orbe para falar"}
      className="orb-container-direct group select-none outline-none cursor-pointer"
    >
      <style>{`
        .orb-container-direct {
          position: relative;
          width: 250px;
          height: 250px;
          display: flex;
          justify-content: center;
          align-items: center;
        }

        .orb-core-direct {
          width: 180px;
          height: 180px;
          background: linear-gradient(135deg, #00c6ff 0%, #0072ff 100%);
          border-radius: 50%;
          animation: orbDirectMorph 8s ease-in-out infinite, orbDirectPulse 4s alternate infinite;
          position: relative;
          z-index: 2;
          transition: transform 0.08s ease-out, box-shadow 0.08s ease-out, filter 0.08s ease-out;
          will-change: transform, box-shadow;
        }

        .orb-ring-direct {
          position: absolute;
          width: 220px;
          height: 220px;
          border-radius: 50%;
          border: 2px solid rgba(0, 198, 255, 0.15);
          box-shadow: 0 0 30px rgba(0, 198, 255, 0.15);
          animation: orbDirectRotateRing 10s linear infinite;
          pointer-events: none;
          transition: transform 0.08s ease-out, border-color 0.08s ease-out;
        }

        @keyframes orbDirectMorph {
          0% { border-radius: 60% 40% 30% 70% / 60% 30% 70% 40%; }
          50% { border-radius: 30% 60% 70% 40% / 50% 60% 30% 60%; }
          100% { border-radius: 60% 40% 30% 70% / 60% 30% 70% 40%; }
        }

        @keyframes orbDirectPulse {
          0% { transform: scale(0.96); opacity: 0.88; }
          100% { transform: scale(1.04); opacity: 1; }
        }

        @keyframes orbDirectRotateRing {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        /* Estados adicionais */
        .orb-processing-direct {
          animation: orbDirectMorph 2.5s ease-in-out infinite !important;
        }
      `}</style>

      {/* Anel giratório exterior que expande com o som */}
      <div
        className="orb-ring-direct"
        style={{
          transform: `scale(${ringScale})`,
          borderColor: `rgba(0, 198, 255, ${0.15 + audioLevel * 0.45})`,
          boxShadow: `0 0 ${30 + audioLevel * 40}px rgba(0, 198, 255, ${0.2 + audioLevel * 0.4})`,
        }}
      />

      {/* Orbe fluido orgânico que reage em tempo real aos decibéis da voz */}
      <div
        className={`orb-core-direct ${isProcessing ? "orb-processing-direct" : ""}`}
        style={{
          transform: `scale(${scale})`,
          filter: `brightness(${brightness})`,
          boxShadow: `
            0 0 ${glowSpread}px rgba(0, 198, 255, ${glowAlpha}),
            inset 20px 0 40px rgba(255, 255, 255, 0.5),
            inset -20px 0 40px rgba(0, 114, 255, 0.5),
            inset 0 -20px 40px rgba(0, 0, 0, 0.5)
          `,
        }}
      />
    </div>
  );
}
