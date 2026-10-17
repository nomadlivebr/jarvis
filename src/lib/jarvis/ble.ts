// Driver BLE (BlueZ via D-Bus) — roda apenas na Rock Pi (HARDWARE_MODE=rockpi).
//
// Usa node-ble (D-Bus puro, SEM compilação nativa):
//   npm install node-ble
//
// Por que não @abandonware/noble: a Rock Pi roda Ubuntu 20.04 / GCC 9 e o Node 24
// compila com -std=gnu++20 (GCC 10+), então o módulo nativo não builda na placa.
// No PC este módulo nunca é carregado (import dinâmico dentro do modo rockpi).

import { type BleDevice } from "./devices";

// --- Tipos mínimos do node-ble (evita depender dos tipos do pacote em dev) ---

type GattCharacteristic = {
  getUUID: () => Promise<string>;
  getFlags: () => Promise<string[]>;
  readValue: (offset?: number) => Promise<Buffer>;
  writeValue: (value: Buffer, options?: { type?: "command" | "request" | "reliable" }) => Promise<void>;
  writeValueWithoutResponse: (value: Buffer, offset?: number) => Promise<void>;
};

// ATENÇÃO: na API do node-ble, characteristics() devolve os UUIDs (string[]),
// e o objeto da característica vem de getCharacteristic(uuid).
type GattService = {
  getUUID: () => Promise<string>;
  characteristics: () => Promise<string[]>;
  getCharacteristic: (uuid: string) => Promise<GattCharacteristic>;
};

type GattServer = {
  services: () => Promise<string[]>;
  getPrimaryService: (uuid: string) => Promise<GattService>;
};

type BlePeripheral = {
  getAddress: () => Promise<string>;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  isConnected: () => Promise<boolean>;
  gatt: () => Promise<GattServer>;
};

type BleAdapter = {
  startDiscovery: () => Promise<void>;
  stopDiscovery: () => Promise<void>;
  isDiscovering: () => Promise<boolean>;
  getDevice: (address: string) => Promise<BlePeripheral>;
  waitDevice: (address: string) => Promise<BlePeripheral>;
};

type Bluetooth = {
  defaultAdapter: () => Promise<BleAdapter>;
};

type BluetoothModule = {
  createBluetooth: () => { bluetooth: Bluetooth; destroy: () => void };
};

// UUIDs GATT do protocolo Govee BLE (comunidade: govee-bt-hass)
const GOVEE_CHAR = "ffe1";
const CONNECT_TIMEOUT_MS = 20000;

async function loadBluetooth(): Promise<{ bluetooth: Bluetooth; destroy: () => void }> {
  try {
    // specifier dinâmico: na placa o pacote é instalado; em dev nunca é carregado
    const pkg = "node-ble";
    const mod = (await import(/* webpackIgnore: true */ pkg)) as BluetoothModule;
    const { bluetooth, destroy } = mod.createBluetooth();
    return { bluetooth, destroy };
  } catch {
    throw new Error(
      "BLE indisponível: instale node-ble na Rock Pi (npm install node-ble) e confirme que o serviço bluetooth está ativo."
    );
  }
}

export function normalizeMac(mac: string): string {
  const hex = (mac || "").toUpperCase().replace(/[^0-9A-F]/g, "");
  return hex.replace(/(..)(?=.)/g, "$1:");
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

function checksum(bytes: number[]): number {
  const sum = bytes.reduce((a, b) => a + b, 0);
  return (0x100 - (sum & 0xff)) & 0xff;
}

// Frames de exemplo baseados no protocolo govee-bt-hass.
// CONFIRME para o modelo específico antes do deploy.
const goveePowerFrame = (on: boolean): Buffer => {
  const body = [0xaa, 0x01, on ? 0x01 : 0x00, 0x00];
  return Buffer.from([...body, checksum(body)]);
};

const goveeColorFrame = (r: number, g: number, b: number): Buffer => {
  const body = [0xaa, 0x05, r & 0xff, g & 0xff, b & 0xff];
  return Buffer.from([...body, checksum(body)]);
};

function uuidMatches(uuid: string, short: string): boolean {
  return uuid.toLowerCase().replace(/-/g, "").includes(short.toLowerCase());
}

// Procura a característica pelo UUID curto (ex: "ffe1") em todos os serviços.
async function findCharacteristic(
  gatt: GattServer,
  short: string
): Promise<GattCharacteristic | null> {
  const serviceUuids = await gatt.services();
  for (const serviceUuid of serviceUuids) {
    const service = await gatt.getPrimaryService(serviceUuid);
    const charUuids = await service.characteristics();
    for (const charUuid of charUuids) {
      if (uuidMatches(charUuid, short)) return service.getCharacteristic(charUuid);
    }
  }
  return null;
}

async function writeChar(gatt: GattServer, short: string, frame: Buffer): Promise<void> {
  const char = await findCharacteristic(gatt, short);
  if (!char) throw new Error(`BLE: característica ${short} não encontrada no GATT.`);
  // write-without-response (type: "command") é o modo usado por Tuya/Govee acessível
  await char.writeValue(frame, { type: "command" });
}

export async function bleAction(
  device: BleDevice,
  action: "on" | "off",
  color?: { r: number; g: number; b: number }
): Promise<void> {
  if (device.protocol === "tuya_ble") {
    throw new Error(
      "Tuya BLE exige criptografia (local_key via app). Implementação pendente — ver backlog."
    );
  }

  const mac = normalizeMac(device.mac);
  if (!mac) throw new Error(`BLE: MAC inválido para "${device.name}" (config/devices.json).`);

  const { bluetooth, destroy } = await loadBluetooth();

  try {
    const adapter = await bluetooth.defaultAdapter();
    if (!(await adapter.isDiscovering())) await adapter.startDiscovery();

    const peri = await withTimeout(
      adapter.waitDevice(mac),
      CONNECT_TIMEOUT_MS,
      `BLE: ${device.name} (${mac}) não encontrado no scan.`
    );
    await withTimeout(
      peri.connect(),
      CONNECT_TIMEOUT_MS,
      `BLE: timeout ao conectar em ${device.name} (${mac}).`
    );

    try {
      const gatt = await peri.gatt();

      // Cor tem prioridade (liga ao aplicar cor em vários modelos); senão, só power
      if (color) {
        await writeChar(gatt, GOVEE_CHAR, goveeColorFrame(color.r, color.g, color.b));
      }
      await writeChar(gatt, GOVEE_CHAR, goveePowerFrame(action === "on"));
    } finally {
      await peri.disconnect().catch(() => {});
      await adapter.stopDiscovery().catch(() => {});
    }
  } finally {
    destroy();
  }
}
