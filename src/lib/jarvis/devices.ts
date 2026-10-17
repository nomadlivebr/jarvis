// Registro de dispositivos controláveis (BLE).
// No PC (mock) estes dados são ignorados; na Rock Pi são usados pelo driver BLE.
// Para cada luz, preencha mac + controlKey (extraídos do app Govee) em devices.json.

import fs from "node:fs";
import path from "node:path";

export type BleProtocol = "govee_ble" | "tuya_ble" | "raw";

export interface BleDevice {
  id: string; // mesmo id usado pelo brain.ts (ex: "luz-sala")
  name: string;
  room: string;
  protocol: BleProtocol;
  mac: string; // ex: "A4:C1:38:XX:XX:XX"
  controlKey?: string; // Govee: chave de controle do app (64 hex). Tuya: local_key.
  notes?: string;
}

const CONFIG_PATH = path.join(process.cwd(), "config", "devices.json");

// Fallback caso config/devices.json não exista ainda (apenas dev)
const FALLBACK: BleDevice[] = [];

export function listBleDevices(): BleDevice[] {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as BleDevice[]) : [];
  } catch {
    return FALLBACK;
  }
}

export function findBleDevice(id: string): BleDevice | undefined {
  return listBleDevices().find((d) => d.id === id);
}
