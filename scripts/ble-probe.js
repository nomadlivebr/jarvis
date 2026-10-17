#!/usr/bin/env node
// Sondagem BLE para a Rock Pi — descobre a lâmpada e inspeciona o GATT.
// Uso (na Rock Pi, com o adaptador Bluetooth ligado):
//   node scripts/ble-probe.js              # escaneia 15s e lista dispositivos
//   node scripts/ble-probe.js AA:BB:CC:..  # conecta no MAC e lista serviços/características
//
// Requisitos na placa:  npm install @abandonware/noble  (bluez instalado)
// Se reclamar de permissão: rode com sudo ou dê setcap no node.

const noble = require("@abandonware/noble");

const target = (process.argv[2] || "").toLowerCase().replace(/:/g, "");
const SCAN_MS = 15000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitPoweredOn() {
  return new Promise((resolve, reject) => {
    if (noble.state === "poweredOn") return resolve();
    const t = setTimeout(() => reject(new Error(`Bluetooth não ligou (state=${noble.state})`)), 8000);
    noble.once("stateChange", (s) => {
      clearTimeout(t);
      s === "poweredOn" ? resolve() : reject(new Error(`estado do rádio: ${s}`));
    });
  });
}

async function scan() {
  const found = new Map();
  console.log(`Escaneando BLE por ${SCAN_MS / 1000}s...`);
  noble.startScanning([], false);
  noble.on("discover", (p) => {
    const info = {
      name: p.advertisement?.localName || "?",
      rssi: p.rssi,
      svc: (p.advertisement?.serviceUuids || []).join(","),
    };
    if (!found.has(p.address)) {
      console.log(`  ${p.address}  rssi=${info.rssi}  name="${info.name}"  svc=${info.svc}`);
    }
    found.set(p.address, info);
  });
  await sleep(SCAN_MS);
  noble.stopScanning();
  console.log(`\nTotal: ${found.size} dispositivos. (Dica: ligue/desligue a lâmpada pra ver qual MAC some/aparece)`);
  return found;
}

async function connectAndList(mac) {
  console.log(`Escaneando até achar ${mac}...`);
  const peri = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("MAC não apareceu no scan")), 20000);
    noble.startScanning([], false);
    noble.on("discover", (p) => {
      if (p.address.toLowerCase().replace(/:/g, "") === target) {
        noble.stopScanning();
        clearTimeout(t);
        resolve(p);
      }
    });
  });

  console.log("Conectando...");
  await new Promise((res, rej) =>
    peri.connect((err) => (err ? rej(err) : res()))
  );
  console.log("✅ Conectado!\n");

  const { services, characteristics } = await new Promise((res, rej) =>
    peri.discoverAllServicesAndCharacteristics((err, s, c) =>
      err ? rej(err) : res({ services: s, characteristics: c })
    )
  );

  console.log("=== SERVIÇOS GATT ===");
  for (const s of services) {
    console.log(`  service: 0x${s.uuid}`);
    const chars = characteristics.filter((c) => c.serviceUuid === s.uuid);
    for (const c of chars) {
      console.log(`    characteristic: 0x${c.uuid}  props=[${c.properties.join(", ")}]`);
    }
  }

  console.log(
    "\n(Anotou os UUIDs? Serviço 0xffe0/0xffe1 = padrão Tuya BLE. Envia msg pra mim que eu monto o handshake.)"
  );

  await new Promise((res) => peri.disconnect(() => res()));
  process.exit(0);
}

(async () => {
  try {
    await waitPoweredOn();
    target ? await connectAndList(target) : await scan();
    process.exit(0);
  } catch (err) {
    console.error("ERRO:", err.message);
    process.exit(1);
  }
})();
