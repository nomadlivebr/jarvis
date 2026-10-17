#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
// Sondagem BLE para a Rock Pi — usa node-ble (D-Bus/BlueZ, SEM compilação nativa).
//
// Por quê node-ble e não noble: a Rock Pi roda Ubuntu 20.04 (GCC 9) e o Node 24
// pede C++20 (-std=gnu++20), que o GCC 9 não suporta. node-ble fala com o BlueZ
// via D-Bus, então não precisa de toolchain nem rebuild nativo.
//
// Uso:
//   npm install node-ble
//   node scripts/ble-probe.js                        # escaneia e lista dispositivos
//   node scripts/ble-probe.js AA:BB:CC:DD:EE:FF      # conecta e lista serviços/características
//   SCAN_MS=40000 node scripts/ble-probe.js          # scan mais longo

const { createBluetooth } = require("node-ble");

const SCAN_MS = Number(process.env.SCAN_MS || 15000);
const CONNECT_TIMEOUT_MS = 20000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normalizeMac(mac) {
  const hex = (mac || "").toUpperCase().replace(/[^0-9A-F]/g, "");
  return hex.replace(/(..)(?=.)/g, "$1:");
}

function toHex(value) {
  if (value == null) return "";
  if (Buffer.isBuffer(value)) return value.toString("hex");
  if (Array.isArray(value)) return Buffer.from(value).toString("hex");
  return String(value);
}

function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
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

// Dados de advertisement: é aqui que aparece a assinatura do fabricante (ex: Tuya).
function fmtAdvertisement(manufacturerData, serviceData) {
  const parts = [];
  for (const [id, data] of Object.entries(manufacturerData || {})) {
    const n = Number(id);
    const label = Number.isNaN(n) ? id : `0x${n.toString(16).padStart(4, "0")}`;
    parts.push(`mfr=${label}:${toHex(data)}`);
  }
  for (const [uuid, data] of Object.entries(serviceData || {})) {
    parts.push(`svcdata=${uuid}:${toHex(data)}`);
  }
  return parts.join(" ");
}

async function describe(adapter, addr, seen) {
  if (seen.has(addr)) return;
  seen.set(addr, true);

  const dev = await adapter.getDevice(addr).catch(() => null);
  if (!dev) {
    console.log(`  ${addr}`);
    return;
  }

  const name = await dev.getName().catch(() => "");
  const rssi = await dev.getRSSI().catch(() => "");
  const mfr = await dev.getManufacturerData().catch(() => ({}));
  const svcData = await dev.getServiceData().catch(() => ({}));
  const extra = fmtAdvertisement(mfr, svcData);

  console.log(
    `  ${addr}  rssi=${rssi || "?"}  name="${name || "?"}"${extra ? `  ${extra}` : ""}`
  );
}

async function main() {
  const target = normalizeMac(process.argv[2] || "");
  const { bluetooth, destroy } = createBluetooth();

  const adapter = await bluetooth.defaultAdapter();
  if (!adapter) throw new Error("Nenhum adaptador Bluetooth encontrado.");

  if (!(await adapter.isDiscovering())) await adapter.startDiscovery();
  console.log(`Escaneando por ${SCAN_MS / 1000}s...\n`);

  const seen = new Map();
  const deadline = Date.now() + SCAN_MS;
  while (Date.now() < deadline) {
    const addresses = await adapter.devices().catch(() => []);
    for (const addr of addresses) {
      if (seen.has(addr)) continue;
      await describe(adapter, addr, seen).catch(() => {});
    }
    if (target && seen.has(target)) break;
    await sleep(1000);
  }

  if (!target) {
    console.log(
      `\nTotal: ${seen.size} dispositivos.\n` +
        `Dica: desligue a lâmpada na tomada e rode de novo — o MAC que sumir é ela.\n` +
        `Depois: node scripts/ble-probe.js AA:BB:CC:DD:EE:FF`
    );
    destroy();
    return;
  }

  if (!seen.has(target)) {
    destroy();
    throw new Error(`${target} não apareceu no scan. Confirme que a lâmpada está energizada.`);
  }

  console.log(`\nConectando em ${target}...`);
  const device = await adapter.getDevice(target);
  await withTimeout(device.connect(), CONNECT_TIMEOUT_MS, `timeout ao conectar em ${target}`);
  console.log("✅ Conectado!\n");

  try {
    const gatt = await device.gatt();
    const serviceUuids = await gatt.services();

    console.log("=== SERVIÇOS / CARACTERÍSTICAS GATT ===");
    for (const serviceUuid of serviceUuids) {
      console.log(`\n  serviço: ${serviceUuid}`);
      const service = await gatt.getPrimaryService(serviceUuid);
      const charUuids = await service.characteristics();
      for (const charUuid of charUuids) {
        const c = await service.getCharacteristic(charUuid);
        const flags = await c.getFlags().catch(() => []);
        console.log(`    char: ${charUuid}  [${flags.join(", ")}]`);
      }
    }
    console.log(
      "\n(Serviço ffe0/ffe1 ou ffd5/ffe1 = padrão Tuya/Govee BLE. Manda essa saída.)"
    );
  } finally {
    await device.disconnect().catch(() => {});
    destroy();
  }
}

main().catch((err) => {
  console.error("ERRO:", err.message);
  process.exit(1);
});
