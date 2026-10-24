// Driver Tuya Beacon — transmissao de anuncios BLE crus (broadcast cifrado).
//
// A lampada (luz-sala) e Tuya BLE pura e nao aceita conexao GATT (ADV_NONCONN_IND).
// O controle e feito transmitindo um anuncio de 31 bytes (AD_PREFIXO + pacote de
// 26 bytes) via HCI cru na Rock Pi. Os pacotes podem ser:
//   - capturados do app (scripts/tuya-beacon-extract.py) e retransmitidos
//     (replay), incrementando o contador (que vai em claro, fora da cifra);
//   - forjados (scripts/tuya-beacon-forge.py) quando a pairKey for conhecida.
//
// Configuracao: device.beaconDir (dir com <acao>.txt) ou TUYA_BEACON_DIR;
// contador base via TUYA_BEACON_COUNTER (default: segundos desde epoch).

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { BleDevice } from "./devices";

export interface TuyaBeaconResult {
  ok: boolean;
  erro?: string;
  [key: string]: unknown;
}

const AD_PREFIXO = "0201011b03";
const DEFAULT_TIMEOUT_MS = 30_000;

function resolvePython(): string {
  return process.env.TUYA_BEACON_PYTHON ?? (process.platform === "win32" ? "python" : "python3");
}

function txScript(): string {
  return path.join(process.cwd(), "scripts", "tuya-beacon-tx.py");
}

function beaconDir(device: BleDevice): string | null {
  return device.beaconDir ?? process.env.TUYA_BEACON_DIR ?? null;
}

function resolvePacketsFile(device: BleDevice, action: string): string | null {
  const dir = beaconDir(device);
  if (!dir) return null;
  const candidate = path.join(dir, `${action}.txt`);
  return fs.existsSync(candidate) ? candidate : null;
}

function baseCounter(): number {
  const env = process.env.TUYA_BEACON_COUNTER;
  if (env && !Number.isNaN(Number(env))) return Number(env);
  return Math.floor(Date.now() / 1000) % 65536;
}

async function runTx(args: string[]): Promise<TuyaBeaconResult> {
  const timeout = Number(process.env.TUYA_BEACON_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  return new Promise<TuyaBeaconResult>((resolve) => {
    const child = spawn(/* turbopackIgnore: true */ resolvePython(), [txScript(), ...args], {
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, erro: `Tuya Beacon: timeout de ${timeout}ms` });
    }, timeout);
    child.stdout.on("data", (c: Buffer) => (stdout += c.toString("utf8")));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString("utf8")));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, erro: `Tuya Beacon: falha ao iniciar (${e.message})` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const ok = code === 0;
      resolve({
        ok,
        erro: ok ? undefined : stderr.trim() || `exit ${code}`,
        log: (stdout + "\n" + stderr).trim(),
      });
    });
  });
}

export async function tuyaBeaconAction(
  device: BleDevice,
  action: string,
  params?: Record<string, string | number | boolean>
): Promise<TuyaBeaconResult> {
  const txArgs: string[] = ["--silent", "--type", "nonconn"];

  // Caminho 1: hex direto (26 bytes) via params.beaconHex
  const hex = params?.beaconHex;
  if (typeof hex === "string" && hex.trim()) {
    const clean = hex.replace(/[:\s]/g, "");
    txArgs.push("--adv", AD_PREFIXO + clean);
  } else {
    // Caminho 2: arquivo de pacotes capturados por acao
    const file = resolvePacketsFile(device, action);
    if (!file) {
      return {
        ok: false,
        erro: `Tuya Beacon: sem pacotes para "${action}" (esperado ${beaconDir(device) ?? "?"}/${action}.txt). Capture com tuya-beacon-extract.py.`,
      };
    }
    txArgs.push("--packets", file, "--base-counter", String(baseCounter()));
  }

  const result = await runTx(txArgs);
  if (!result.ok) {
    console.warn(`[TUYA-BEACON] ${device.name} (${device.mac}): ${result.erro ?? "falhou"}`);
  }
  return result;
}
