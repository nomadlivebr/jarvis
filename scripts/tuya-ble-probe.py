#!/usr/bin/env python3
"""
Sonda o handshake Tuya BLE *sem* enviar credenciais.

Etapas:
  1. mantém um scanner ativo (no Windows o dispositivo sai do cache quando a
     varredura para) e espera a lâmpada anunciar de forma CONECTÁVEL;
  2. conecta e pede as informações do dispositivo — etapa cifrada apenas com a
     `local_key`, ou seja: se ela responde, a chave está certa;
  3. imprime o resultado e desconecta, ANTES de enviar o pacote de pareamento
     (que grava credenciais no aparelho).

Uso:
    export TUYA_LOCAL_KEY=...            # PowerShell: $env:TUYA_LOCAL_KEY='...'
    python scripts/tuya-ble-probe.py --address DC:23:53:A6:63:D7 --seconds 240
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from typing import Any


def _adv_args(device: Any) -> Any:
    """Devolve os argumentos crus do WinRT, se existirem."""
    detalhes = getattr(device, "details", None)
    return getattr(detalhes, "adv", None) or getattr(detalhes, "scan", None)


def _conectavel(device: Any) -> bool | None:
    """True/False no Windows; None quando a plataforma não informa."""
    args = _adv_args(device)
    if args is None:
        return None
    try:
        return bool(args.is_connectable)
    except Exception:  # noqa: BLE001
        return None


async def probe(address: str, local_key: str, seconds: float, address_type: str) -> int:
    try:
        from bleak import BleakScanner
        from tuya_ble_sdk import TuyaBleClient, TuyaBleCredentials
        from tuya_ble_sdk.commands.device_info import parse_device_info
        from tuya_ble_sdk.protocol import SECURITY_FLAG_LOGIN_KEY, TuyaBleCommandCode
    except ImportError as exc:
        sys.exit(f"[ERRO] dependências ausentes ({exc}) — rode dentro do venv do tuya-ble-sdk")

    loop = asyncio.get_running_loop()
    alvo = address.upper()

    scanner = BleakScanner()
    await scanner.start()
    client = None
    try:
        print(f"[PROBE] procurando {alvo} por até {seconds:.0f}s...")
        device = None
        limite = loop.time() + seconds
        ultimo_aviso = 0.0
        while loop.time() < limite:
            visto = None
            for candidato, adv in scanner.discovered_devices_and_advertisement_data.values():
                if (candidato.address or "").upper() == alvo:
                    visto = (candidato, adv)
            if visto is not None:
                candidato, adv = visto
                conectavel = _conectavel(candidato)
                args = _adv_args(candidato)
                if conectavel is not False:
                    device = candidato
                    print(
                        f"[PROBE] anunciando: rssi={adv.rssi} conectavel={conectavel} "
                        f"tipo={getattr(args, 'advertisement_type', '?')}"
                    )
                    break
                if loop.time() - ultimo_aviso >= 5:
                    ultimo_aviso = loop.time()
                    print(
                        f"[PROBE] vista (rssi={adv.rssi}) mas NÃO conectável "
                        f"(tipo={getattr(args, 'advertisement_type', '?')}) — aguardando..."
                    )
            await asyncio.sleep(0.5)

        if device is None:
            vistos = [
                f"{d.address}({d.name or '?'})"
                for d, _ in scanner.discovered_devices_and_advertisement_data.values()
            ]
            sys.exit(
                f"[ERRO] {alvo} não apareceu de forma conectável. "
                f"Outros vistos ({len(vistos)}): {', '.join(vistos) or 'nenhum'}"
            )

        # uuid/device_id não são usados nesta etapa; só a local_key importa.
        credentials = TuyaBleCredentials(uuid="x" * 22, device_id="", local_key=local_key)
        client = TuyaBleClient(device, credentials)

        # O MAC da lâmpada é um endereço ALEATÓRIO (DC: -> random static). No
        # Windows, from_bluetooth_address_async assume endereço público e devolve
        # None -> BleakDeviceNotFoundError. O SDK não expõe esse parâmetro, então
        # injetamos `winrt={"address_type": ...}` na conexão.
        if address_type in ("random", "public"):
            import tuya_ble_sdk.client as sdk_client

            original_establish = sdk_client.establish_connection

            async def establish_with_address_type(client_class, device, name, **kwargs):
                kwargs.setdefault("winrt", {"address_type": address_type})
                return await original_establish(client_class, device, name, **kwargs)

            sdk_client.establish_connection = establish_with_address_type

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

    print("[PROBE] OK: a lâmpada respondeu ao device-info (local_key aceita)")
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
    parser.add_argument(
        "--local-key",
        default=os.environ.get("TUYA_LOCAL_KEY", ""),
        help="local_key (ou env TUYA_LOCAL_KEY)",
    )
    parser.add_argument("--seconds", type=float, default=20.0)
    parser.add_argument(
        "--address-type",
        choices=("random", "public", "auto"),
        default="random",
        help="Tipo de endereço BLE (Windows/WinRT); 'auto' deixa o bleak decidir",
    )
    args = parser.parse_args()
    if not args.local_key:
        sys.exit("[ERRO] informe --local-key ou a variável de ambiente TUYA_LOCAL_KEY")
    try:
        sys.exit(
            asyncio.run(
                probe(args.address, args.local_key, args.seconds, args.address_type)
            )
        )
    except KeyboardInterrupt:
        sys.exit(130)


if __name__ == "__main__":
    main()
