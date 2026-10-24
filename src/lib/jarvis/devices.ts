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
  mac: string; // ex: "A4:C1:38:XX:XX:XX" (Tuya: endereço anunciado, pode rotacionar)
  controlKey?: string; // Govee: chave de controle do app (64 hex).
  localKey?: string; // Tuya: local_key de 16 caracteres vinda da conta
  deviceId?: string; // Tuya: id do dispositivo na conta (ex.: eb2063...)
  uuid?: string; // Tuya: uuid do anúncio (se omitido, a ponte descobre no ar)
  notes?: string;
}

const CONFIG_PATH = path.join(process.cwd(), "config", "devices.json");
// Segredos locais (local_key etc.) ficam fora do versionamento.
const LOCAL_CONFIG_PATH = path.join(process.cwd(), "config", "devices.local.json");

// Fallback caso config/devices.json não exista ainda (apenas dev)
const FALLBACK: BleDevice[] = [];

function readDevicesFile(file: string): BleDevice[] {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as BleDevice[]) : [];
  } catch {
    return [];
  }
}

export function listBleDevices(): BleDevice[] {
  const base = readDevicesFile(CONFIG_PATH);
  const local = readDevicesFile(LOCAL_CONFIG_PATH);
  if (base.length === 0 && local.length === 0) return FALLBACK;

  // devices.local.json sobrepõe campos (mac, localKey, uuid...) e mantém o id único.
  const byId = new Map<string, BleDevice>();
  for (const device of [...base, ...local]) {
    byId.set(device.id, { ...(byId.get(device.id) ?? ({} as BleDevice)), ...device });
  }
  return [...byId.values()];
}

export function findBleDevice(id: string): BleDevice | undefined {
  return listBleDevices().find((d) => d.id === id);
}
