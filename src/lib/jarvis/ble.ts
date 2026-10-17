// Driver BLE (BlueZ) — roda apenas na Rock Pi (HARDWARE_MODE=rockpi).
// O pacote @abandonware/noble é instalado só na placa:
//   npm install @abandonware/noble
// No PC este módulo nunca é carregado (import dinâmico dentro do modo rockpi).

import { findBleDevice, type BleDevice } from "./devices";

type NoblePeripheral = {
  id: string;
  address: string;
  connectAsync?: () => Promise<NoblePeripheral>;
  discoverSomeServicesAndCharacteristicsAsync?: (
    services: string[],
    chars: string[]
  ) => Promise<{ characteristics: NobleCharacteristic[] }>;
  discoverAllServicesAndCharacteristicsAsync?: () => Promise<{
    characteristics: NobleCharacteristic[];
  }>;
  disconnectAsync?: () => Promise<void>;
  connect: (cb: (err: Error | null) => void) => void;
  disconnect: () => void;
};

type NobleCharacteristic = {
  uuid: string;
  writeAsync?: (data: Buffer, withoutResponse: boolean) => Promise<void>;
  write: (data: Buffer, withoutResponse: boolean, cb: (err: Error | null) => void) => void;
};

// UUIDs GATT do protocolo Govee BLE (comunidade: govee-bt-hass)
const GOVEE_SERVICE = "ffd5";
const GOVEE_CHAR = "ffe1";

async function loadNoble(): Promise<any> {
  try {
    // specifier dinâmico: o pacote só existe na Rock Pi (evita resolução em dev)
    const pkg = "@abandonware/noble";
    return await import(/* webpackIgnore: true */ pkg);
  } catch {
    throw new Error(
      "BLE indisponível: instale @abandonware/noble na Rock Pi (npm install @abandonware/noble)."
    );
  }
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

function connect(noble: any, mac: string): Promise<NoblePeripheral> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`BLE: timeout ao conectar em ${mac}`)), 15000);

    const tryConnect = (peripheral: any) => {
      peripheral.connect((err: Error | null) => {
        if (err) {
          clearTimeout(timeout);
          reject(err);
          return;
        }
        clearTimeout(timeout);
        resolve(peripheral as NoblePeripheral);
      });
    };

    const known = noble._peripherals?.[mac] ?? noble._peripherals?.[mac.replaceAll(":", "")];
    if (known) {
      tryConnect(known);
      return;
    }

    noble.once("stateChange", () => {});
    noble.startScanning([], false);
    const onDiscover = (peripheral: any) => {
      if ((peripheral.address ?? "").toLowerCase() === mac.toLowerCase()) {
        noble.removeListener("discover", onDiscover);
        noble.stopScanning();
        tryConnect(peripheral);
      }
    };
    noble.on("discover", onDiscover);
  });
}

function writeChar(peri: NoblePeripheral, chars: NobleCharacteristic[], uuid: string, frame: Buffer): Promise<void> {
  const char = chars.find((c) => c.uuid === uuid || c.uuid.startsWith(uuid));
  if (!char) return Promise.reject(new Error(`BLE: característica ${uuid} não encontrada.`));
  return new Promise((resolve, reject) => {
    char.write(frame, true, (err) => (err ? reject(err) : resolve()));
  });
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

  const noble = await loadNoble();
  const peri = await connect(noble, device.mac);

  try {
    const { characteristics } = await peri.discoverSomeServicesAndCharacteristicsAsync?.(
      [GOVEE_SERVICE],
      [GOVEE_CHAR]
    ) ?? { characteristics: [] as NobleCharacteristic[] };

    // Cor tem prioridade (liga ao aplicar cor em vários modelos); senão, só power
    if (color) {
      await writeChar(peri, characteristics, GOVEE_CHAR, goveeColorFrame(color.r, color.g, color.b));
    }
    await writeChar(peri, characteristics, GOVEE_CHAR, goveePowerFrame(action === "on"));
  } finally {
    await peri.disconnectAsync?.().catch(() => peri.disconnect());
  }
}
