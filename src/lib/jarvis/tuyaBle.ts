// Driver Tuya BLE — ponte para o protocolo GATT cifrado (servico 0xA201).
//
// Por que um processo Python e nao node-ble:
//   - o protocolo exige AES-128-CBC + CRC16 + fragmentacao propria, ja
//     implementados (e testados contra o app) no pacote `tuya-ble-sdk`;
//   - no Windows o node-ble nao existe (depende de D-Bus/BlueZ) e o BlueZ da
//     Rock Pi (5.53) e antigo demais para o bleak, mas o Windows usa WinRT e
//     funciona hoje. O script `scripts/tuya-ble-ctl.py` faz o radio e devolve
//     JSON; aqui so montamos o comando.
//
// Credenciais: config/devices.local.json (gitignored) ou variaveis
// TUYA_BLE_DEVICE_ID / TUYA_BLE_LOCAL_KEY / TUYA_BLE_UUID.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { BleDevice } from "./devices";

export interface TuyaBleResult {
  ok: boolean;
  erro?: string;
  motivo?: string;
  [key: string]: unknown;
}

const DEFAULT_TIMEOUT_MS = 90_000;

function projectDir(): string {
  return process.env.TUYA_BLE_PROJECT ?? path.join(os.homedir(), "tuya-ble");
}

function resolvePython(): string {
  if (process.env.TUYA_BLE_PYTHON) return process.env.TUYA_BLE_PYTHON;
  const venv = path.join(projectDir(), ".venv");
  const candidates =
    process.platform === "win32"
      ? [path.join(venv, "Scripts", "python.exe")]
      : [path.join(venv, "bin", "python")];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  return found ?? "python";
}

function bridgeScript(): string {
  return path.join(process.cwd(), "scripts", "tuya-ble-ctl.py");
}

function deviceEnv(device: BleDevice): NodeJS.ProcessEnv {
  const localKey = device.localKey ?? device.controlKey;
  return {
    ...process.env,
    ...(device.deviceId ? { TUYA_BLE_DEVICE_ID: device.deviceId } : {}),
    ...(localKey ? { TUYA_BLE_LOCAL_KEY: localKey } : {}),
    ...(device.uuid ? { TUYA_BLE_UUID: device.uuid } : {}),
    ...(device.mac && !device.mac.includes("X") ? { TUYA_BLE_ADDRESS: device.mac } : {}),
    PYTHONIOENCODING: "utf-8",
  };
}

async function runBridge(device: BleDevice, args: string[]): Promise<TuyaBleResult> {
  const timeout = Number(process.env.TUYA_BLE_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  return new Promise<TuyaBleResult>((resolve) => {
    const child = spawn(/* turbopackIgnore: true */ resolvePython(), [bridgeScript(), ...args], {
      env: deviceEnv(device),
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, erro: `Tuya BLE: timeout de ${timeout}ms em "${args.join(" ")}"` });
    }, timeout);

    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, erro: `Tuya BLE: falha ao iniciar a ponte Python (${error.message})` });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const parsed = parseBridgeOutput(stdout);
      if (parsed) {
        resolve({ ...parsed, exitCode: code ?? -1, ...(stderr ? { log: stderr.trim() } : {}) });
        return;
      }
      resolve({
        ok: false,
        erro:
          stderr.trim() ||
          `Tuya BLE: a ponte saiu com codigo ${code} sem devolver JSON. Verifique o venv em ${projectDir()}.`,
        exitCode: code ?? -1,
      });
    });
  });
}

function parseBridgeOutput(stdout: string): TuyaBleResult | null {
  const line = stdout
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)
    .pop();
  if (!line) return null;
  try {
    const parsed = JSON.parse(line) as TuyaBleResult;
    return typeof parsed?.ok === "boolean" ? parsed : null;
  } catch {
    return null;
  }
}

function numberParam(
  params: Record<string, string | number | boolean> | undefined,
  ...names: string[]
): number | undefined {
  for (const name of names) {
    const raw = params?.[name];
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (typeof raw === "string" && raw.trim() !== "" && !Number.isNaN(Number(raw))) {
      return Number(raw);
    }
  }
  return undefined;
}

/**
 * Traduz a acao do Jarvis em uma unica sessao BLE.
 *
 * Cor, temperatura e brilho mandam o datapoint de power no mesmo frame: cada
 * sessao custa alguns segundos e a lampada dorme logo depois do handshake.
 */
export function buildTuyaBleCommand(
  action: string,
  params?: Record<string, string | number | boolean>
): string[] {
  const color = params
    ? numberParam(params, "r")
    : undefined;
  const green = params ? numberParam(params, "g") : undefined;
  const blue = params ? numberParam(params, "b") : undefined;
  const brightness = numberParam(params, "brightness", "brilho");
  const temperature = numberParam(params, "temp", "temperatura");
  const wantsOn = action === "on" || action === "acender";

  if (action === "status" || action === "estado") return ["read"];

  if (color !== undefined && green !== undefined && blue !== undefined) {
    return wantsOn
      ? ["color", `${color},${green},${blue}`, "--power-on"]
      : ["color", `${color},${green},${blue}`];
  }
  if (temperature !== undefined) {
    return wantsOn ? ["temp", String(temperature), "--power-on"] : ["temp", String(temperature)];
  }
  if (brightness !== undefined) {
    return wantsOn
      ? ["brightness", String(brightness), "--power-on"]
      : ["brightness", String(brightness)];
  }
  if (action === "on" || action === "acender") return ["on"];
  if (action === "off" || action === "apagar" || action === "desligar") return ["off"];

  throw new Error(`Tuya BLE: acao nao suportada "${action}"`);
}

export async function tuyaBleAction(
  device: BleDevice,
  action: string,
  params?: Record<string, string | number | boolean>
): Promise<TuyaBleResult> {
  const args = buildTuyaBleCommand(action, params);
  const result = await runBridge(device, args);
  if (!result.ok) {
    console.warn(`[TUYA-BLE] ${device.name} (${device.mac}): ${result.erro ?? "falhou"}`);
  }
  return result;
}

export async function tuyaBleRead(device: BleDevice): Promise<TuyaBleResult> {
  return runBridge(device, ["read"]);
}
