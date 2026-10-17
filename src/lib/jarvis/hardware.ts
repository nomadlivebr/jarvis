// Camada de abstração de hardware.
// DEV: usa Mock (simulação em memória).
// ROCK PI: implemente os drivers reais (GPIO, I2C, UART, relays) aqui
// sem mudar o resto do app — basta trocar HARDWARE_MODE=rockpi.

import type { DeviceState, HardwareAction, HardwareMode } from "./types";

export function getHardwareMode(): HardwareMode {
  return process.env.HARDWARE_MODE === "rockpi" ? "rockpi" : "mock";
}

// Estado simulado (somente dev). Na Rock Pi, leia dos sensores reais.
const initialDevices: DeviceState[] = [
  {
    id: "luz-sala",
    name: "Luz da Sala",
    type: "light",
    state: "off",
    updatedAt: new Date().toISOString(),
  },
  {
    id: "luz-quarto",
    name: "Luz do Quarto",
    type: "light",
    state: "off",
    updatedAt: new Date().toISOString(),
  },
  {
    id: "ventilador",
    name: "Ventilador",
    type: "switch",
    state: "off",
    updatedAt: new Date().toISOString(),
  },
];
const mockDevices = new Map<string, DeviceState>(
  initialDevices.map((d) => [d.id, d] as [string, DeviceState])
);

export async function listDevices(): Promise<DeviceState[]> {
  if (getHardwareMode() === "rockpi") {
    // TODO ROCK PI: ler GPIO / MQTT / Home Assistant aqui
    // Ex: const gpio = await import("onoff"); ...
    throw new Error("Driver Rock Pi não implementado ainda. Use HARDWARE_MODE=mock no dev.");
  }
  return [...mockDevices.values()];
}

export async function executeAction(action: HardwareAction): Promise<DeviceState | null> {
  if (getHardwareMode() === "rockpi") {
    const { findBleDevice } = await import("./devices");
    const { bleAction } = await import("./ble");

    const dev = findBleDevice(action.device);
    if (!dev) {
      console.log(`[ROCKPI] ${action.device} -> ${action.action} (sem BLE registrado, apenas log)`, action.params ?? {});
      return null;
    }

    const p = action.params;
    const color =
      p && typeof p.r === "number" && typeof p.g === "number" && typeof p.b === "number"
        ? { r: p.r, g: p.g, b: p.b }
        : undefined;

    await bleAction(dev, action.action as "on" | "off", color);
    return {
      id: dev.id,
      name: dev.name,
      type: "light",
      state: action.action,
      updatedAt: new Date().toISOString(),
    };
  }

  const device = mockDevices.get(action.device);
  if (!device) return null;

  device.state = action.action;
  device.updatedAt = new Date().toISOString();
  mockDevices.set(device.id, device);

  // Sincroniza com PostgreSQL se configurado
  import("./db").then(({ updateDeviceStateInDb }) => {
    updateDeviceStateInDb(action.device, action.action, action.params).catch(() => {});
  }).catch(() => {});

  return device;
}
