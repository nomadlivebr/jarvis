#!/usr/bin/env python3
"""
Testa o handshake Tuya BLE *sem* enviar credenciais.

A primeira etapa do handshake (SENDER_DEVICE_INFO) é cifrada apenas com a
`local_key` — ou seja, se a lâmpada responder, a chave está certa e o rádio
está OK. A segunda etapa (SENDER_PAIR) grava o registro de credenciais no
dispositivo, então este script PARA antes dela de propósito.

Uso (com o venv do tuya-ble-sdk):
    export TUYA_LOCAL_KEY=...        # PowerShell: $env:TUYA_LOCAL_KEY='...'
    python scripts/tuya-ble-probe.py --address DC:23:53:A6:63:D7
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys


async def probe(address: str, local_key: str, seconds: float) -> int:
    try:
        from bleak import BleakScanner
        from tuya_ble_sdk import TuyaBleClient, TuyaBleCredentials
        from tuya_ble_sdk.commands.device_info import parse_device_info
        from tuya_ble_sdk.protocol import SECURITY_FLAG_LOGIN_KEY, TuyaBleCommandCode
    except ImportError as exc:
        sys.exit(f"[ERRO] dependências ausentes ({exc}) — rode dentro do venv do tuya-ble-sdk")

    loop = asyncio.get_running_loop()
    alvo = address.upper()

    # O scanner tem de continuar ligado DURANTE a conexão: no Windows (WinRT) o
    # dispositivo some do cache assim que a varredura para, e o connect falha
    # com BleakDeviceNotFoundError.
    scanner = BleakScanner()
    await scanner.start()
    client = None
    try:
        print(f"[PROBE] procurando {alvo} ({seconds:.0f}s)...")
        device = None
        limite = loop.time() + seconds
        while device is None and loop.time() < limite:
            for candidato, _ in scanner.discovered_devices_and_advertisement_data.values():
                if (candidato.address or "").upper() == alvo:
                    device = candidato
                    break
            if device is None:
                await asyncio.sleep(0.5)
        if device is None:
            vistos = [
                f"{d.address}({d.name or '?'})"
                for d, _ in scanner.discovered_devices_and_advertisement_data.values()
            ]
            sys.exit(
                f"[ERRO] {alvo} não apareceu no rádio. "
                f"Vistos ({len(vistos)}): {', '.join(vistos) or 'nenhum'}"
            )

        # uuid/device_id não são usados nesta etapa; só a local_key importa.
        credentials = TuyaBleCredentials(uuid="x" * 22, device_id="", local_key=local_key)
        client = TuyaBleClient(device, credentials)

        print(f"[PROBE] conectando em {device.address} (scanner ativo)...")
        await client._async_connect()  # noqa: SLF001 — sonda deliberada
        reply = await client._async_request(  # noqa: SLF001
            TuyaBleCommandCode.SENDER_DEVICE_INFO,
            b"",
            key=client._login_key,  # noqa: SLF001
            security_flag=SECURITY_FLAG_LOGIN_KEY,
        )
        info = parse_device_info(reply.data)
    finally:
        if client is not None:
            await client._async_disconnect()  # noqa: SLF001
        await scanner.stop()

    print("[PROBE] ✅ a lâmpada respondeu ao device-info (local_key aceita)")
    print(f"  firmware  : {info.device_version}")
    print(f"  protocolo : {info.protocol_version_name}")
    print(f"  hardware  : {info.hardware_version}")
    print(f"  is_bound  : {info.is_bound}  (False = desvinculada, precisa de uuid+pair)")
    print(f"  srand     : {info.srand.hex()}")
    print(f"  auth_key  : {info.auth_key.hex()}")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Sonda a etapa device-info do Tuya BLE (sem parear)")
    parser.add_argument("--address", required=True, help="MAC BLE da lâmpada")
    parser.add_argument("--local-key", default=os.environ.get("TUYA_LOCAL_KEY", ""), help="local_key (ou env TUYA_LOCAL_KEY)")
    parser.add_argument("--seconds", type=float, default=20.0)
    args = parser.parse_args()
    if not args.local_key:
        sys.exit("[ERRO] informe --local-key ou a variável de ambiente TUYA_LOCAL_KEY")
    try:
        sys.exit(asyncio.run(probe(args.address, args.local_key, args.seconds)))
    except KeyboardInterrupt:
        sys.exit(130)


if __name__ == "__main__":
    main()
