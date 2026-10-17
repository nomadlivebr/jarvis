"use client";

import { useEffect, useState } from "react";
import type { DeviceState, SystemStatus } from "@/lib/jarvis/types";

export default function StatusPanel() {
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [devices, setDevices] = useState<DeviceState[]>([]);

  async function load() {
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      const data = await res.json();
      setSystem(data.system);
      setDevices(data.devices ?? []);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  const memPct = system
    ? Math.round(((system.totalMem - system.freeMem) / system.totalMem) * 100)
    : 0;

  return (
    <section className="flex flex-col gap-4">
      {/* Bloco de Hardware / Rock Pi */}
      <div className="rounded-2xl border border-sky-500/20 bg-sky-950/25 p-4 backdrop-blur-md">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold tracking-widest text-sky-400 uppercase">
            Hardware & Núcleo
          </h2>
          <span className="flex h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_#38bdf8]" />
        </div>

        {!system ? (
          <p className="animate-pulse text-xs text-slate-400">Consultando telemetria…</p>
        ) : (
          <dl className="grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-xl bg-white/3 p-2 border border-white/5">
              <dt className="text-[10px] text-slate-400 uppercase">Host</dt>
              <dd className="font-mono text-slate-200 truncate">{system.hostname}</dd>
            </div>
            <div className="rounded-xl bg-white/3 p-2 border border-white/5">
              <dt className="text-[10px] text-slate-400 uppercase">Modo</dt>
              <dd className={`font-mono font-medium ${system.mode === "mock" ? "text-amber-300" : "text-sky-300"}`}>
                {system.mode.toUpperCase()}
              </dd>
            </div>
            <div className="rounded-xl bg-white/3 p-2 border border-white/5">
              <dt className="text-[10px] text-slate-400 uppercase">Plataforma</dt>
              <dd className="font-mono text-slate-200">{system.platform} / {system.arch}</dd>
            </div>
            <div className="rounded-xl bg-white/3 p-2 border border-white/5">
              <dt className="text-[10px] text-slate-400 uppercase">Uptime</dt>
              <dd className="font-mono text-slate-200">{Math.floor(system.uptimeSec / 60)} min</dd>
            </div>
            <div className="col-span-2 rounded-xl bg-white/3 p-2 border border-white/5">
              <div className="flex justify-between text-[10px] text-slate-400 uppercase">
                <span>Uso de Memória</span>
                <span className="text-sky-300 font-mono">{memPct}%</span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full bg-linear-to-r from-cyan-400 to-blue-500 transition-all duration-500"
                  style={{ width: `${memPct}%` }}
                />
              </div>
            </div>
          </dl>
        )}
      </div>

      {/* Bloco de Dispositivos Conectados */}
      <div className="rounded-2xl border border-white/10 bg-white/3 p-4 backdrop-blur-md">
        <h2 className="mb-3 text-xs font-semibold tracking-widest text-sky-400 uppercase">
          Dispositivos da Casa
        </h2>
        <ul className="flex flex-col gap-2">
          {devices.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between rounded-xl bg-white/2 border border-white/5 px-3 py-2 text-xs"
            >
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${d.state === "on" ? "bg-amber-400 shadow-[0_0_8px_#fbbf24]" : "bg-slate-600"}`} />
                <span className="text-slate-200 font-medium">{d.name}</span>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${
                  d.state === "on"
                    ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                    : "bg-slate-800 text-slate-400 border border-slate-700/50"
                }`}
              >
                {d.state === "on" ? "LIGADO" : "DESLIGADO"}
              </span>
            </li>
          ))}
          {devices.length === 0 && (
            <li className="text-xs text-slate-500 text-center py-2">
              Nenhum dispositivo encontrado no mock.
            </li>
          )}
        </ul>
      </div>
    </section>
  );
}
