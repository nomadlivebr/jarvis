#!/usr/bin/env python3
"""
Diagnóstico LAN (Wi-Fi) de dispositivo Tuya via TinyTuya.

ATENÇÃO — LIMITE DA FERRAMENTA:
    TinyTuya NÃO fala BLE. Ele só conversa com dispositivos Tuya na rede
    local (TCP 6668: protocolos 3.1 / 3.3 / 3.4 / 3.5), e exige
    device_id + local_key + IP.
    Se a lâmpada for só-BLE, este script NUNCA vai funcionar nela
    (o caminho, nesse caso, é o `tuya-ble-sdk`).

Uso:
    python3 scripts/tuya-lan-probe.py --scan
    python3 scripts/tuya-lan-probe.py --device-id X --ip 192.168.0.10 --local-key Y --version 3.3
    TUYA_DEVICE_ID=X TUYA_IP=192.168.0.10 TUYA_LOCAL_KEY=Y python3 scripts/tuya-lan-probe.py --on --off
"""

from __future__ import annotations

import argparse
import json
import os
import sys


def dump(label: str, obj: object) -> None:
    print(f"{label} {json.dumps(obj, indent=2, ensure_ascii=False, default=str)}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Sonda LAN para dispositivo Tuya (TinyTuya)")
    parser.add_argument("--scan", action="store_true", help="procura dispositivos Tuya na LAN (UDP 6666/6667)")
    parser.add_argument("--device-id", default=os.environ.get("TUYA_DEVICE_ID"))
    parser.add_argument("--ip", default=os.environ.get("TUYA_IP"))
    parser.add_argument("--local-key", default=os.environ.get("TUYA_LOCAL_KEY"))
    parser.add_argument("--version", default=os.environ.get("TUYA_VERSION", "3.3"), help="3.1 | 3.3 | 3.4 | 3.5")
    parser.add_argument("--on", action="store_true", help="liga a lâmpada")
    parser.add_argument("--off", action="store_true", help="desliga a lâmpada")
    parser.add_argument("--timeout", type=int, default=5, help="timeout de socket em segundos")
    args = parser.parse_args()

    try:
        import tinytuya
    except ImportError:
        sys.exit("[ERRO] tinytuya não instalado: pip3 install tinytuya")

    print(f"[INFO] tinytuya {getattr(tinytuya, '__version__', 'desconhecida')} — BLE NÃO é suportado por esta lib")

    if args.scan:
        print("[SCAN] procurando dispositivos Tuya na LAN (aguarde ~10s)...")
        dump("[SCAN]", tinytuya.scan())
        return

    missing = [n for n, v in (("device_id", args.device_id), ("ip", args.ip), ("local_key", args.local_key)) if not v]
    if missing:
        sys.exit(f"[ERRO] faltam parâmetros: {', '.join(missing)} (ou as variáveis TUYA_DEVICE_ID/TUYA_IP/TUYA_LOCAL_KEY)")

    device = tinytuya.Device(args.device_id, args.ip, args.local_key, version=float(args.version))
    device.set_socketTimeout(args.timeout)
    device.set_socketPersistent(False)

    print(f"[INFO] conectando em {args.ip} (protocolo {args.version})...")
    status = device.status()
    dump("[STATUS]", status)

    if isinstance(status, dict) and status.get("Error"):
        print("[FALHA] o dispositivo não respondeu. Causas prováveis:")
        print("        - IP errado, ou a lâmpada não está na LAN (é só-BLE) -> use --scan para conferir")
        print("        - local_key errada (a chave muda a cada novo pareamento no app)")
        print("        - protocolo errado (tente --version 3.1 / 3.4 / 3.5)")
        print("        - outro cliente segurando a conexão (feche o app Smart Life)")
        return

    if args.on:
        dump("[ON]", device.turn_on())
    if args.off:
        dump("[OFF]", device.turn_off())
    if not (args.on or args.off):
        print("[DICA] leia os dps em [STATUS] (ex.: dps['1'] = liga/desliga) e use --on / --off para acionar")


if __name__ == "__main__":
    main()
