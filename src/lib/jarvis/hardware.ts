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
  // Home Assistant: lê estados das entidades configuradas (entityId).
  const { haEnabled, haGetState } = await import("./homeassistant");
  if (haEnabled()) {
    const { listBleDevices } = await import("./devices");
    const devices = listBleDevices().filter((d) => d.entityId);
    const states = await Promise.all(
      devices.map(async (d) => {
        const st = await haGetState(d.entityId as string).catch(() => null);
        return {
          id: d.id,
          name: d.name,
          type: (d.id.includes("ventilador") ? "switch" : "light") as DeviceState["type"],
          state: st?.state ?? "unknown",
          updatedAt: st?.last_changed ?? new Date().toISOString(),
        };
      })
    );
    return states;
  }

  if (getHardwareMode() === "rockpi") {
    // TODO ROCK PI: ler GPIO / MQTT / Home Assistant aqui
    // Ex: const gpio = await import("onoff"); ...
    throw new Error("Driver Rock Pi não implementado ainda. Use HARDWARE_MODE=mock no dev.");
  }
  return [...mockDevices.values()];
}

export async function executeAction(action: HardwareAction): Promise<DeviceState | null> {
  // Home Assistant: se configurado e o dispositivo tiver entityId, delega ao HA.
  const { haEnabled, haExecute } = await import("./homeassistant");
  if (haEnabled()) {
    const { findBleDevice } = await import("./devices");
    const dev = findBleDevice(action.device);
    if (dev?.entityId) {
      const p = action.params;
      const color =
        p && typeof p.r === "number" && typeof p.g === "number" && typeof p.b === "number"
          ? { r: p.r, g: p.g, b: p.b }
          : undefined;
      await haExecute(dev.entityId, action.action, {
        ...p,
        ...(color ? { r: color.r, g: color.g, b: color.b } : {}),
      });
      return {
        id: dev.id,
        name: dev.name,
        type: dev.id.includes("ventilador") ? "switch" : "light",
        state: action.action,
        updatedAt: new Date().toISOString(),
      };
    }
  }

  // BLE real: na Rock Pi sempre; no PC quando BLE_ENABLED=1 (a ponte Tuya usa
  // WinRT via Python e funciona no Windows, onde o node-ble nao existe).
  const bleEnabled = getHardwareMode() === "rockpi" || process.env.BLE_ENABLED === "1";
  if (bleEnabled) {
    const { findBleDevice } = await import("./devices");
    const { bleAction } = await import("./ble");

    const dev = findBleDevice(action.device);
    if (!dev) {
      console.log(`[BLE] ${action.device} -> ${action.action} (sem BLE registrado, apenas log)`, action.params ?? {});
      return getHardwareMode() === "rockpi" ? null : simulateAction(action);
    }

    const p = action.params;
    const color =
      p && typeof p.r === "number" && typeof p.g === "number" && typeof p.b === "number"
        ? { r: p.r, g: p.g, b: p.b }
        : undefined;

    await bleAction(dev, action.action, color, p);
    return {
      id: dev.id,
      name: dev.name,
      type: "light",
      state: action.action,
      updatedAt: new Date().toISOString(),
    };
  }

  return simulateAction(action);
}

function simulateAction(action: HardwareAction): DeviceState | null {
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
