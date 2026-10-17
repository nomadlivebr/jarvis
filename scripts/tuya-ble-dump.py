#!/usr/bin/env python3
"""
Despeja o que o rádio BLE vê, cru — usando bleak (o mesmo motor do tuya-ble-sdk).

Para que serve:
  1. descobrir se a lâmpada aparece no rádio (por MAC), mesmo que o
     `tuya-ble scan` não a liste (ele só lista quem anuncia o UUID de serviço
     da Tuya, que é um filtro bem específico);
  2. ler o anúncio como o bleak o vê: service_uuids, service_data,
     manufacturer_data — e tentar decodificar com `parse_advertisement` do SDK.

Uso (na placa: `uv run --project ~/tuya-ble python scripts/tuya-ble-dump.py`):
    python scripts/tuya-ble-dump.py --seconds 20 --mac DC:23:53:A6:63:D7
    python scripts/tuya-ble-dump.py --seconds 20 --all     # mostra tudo, inclusive sem nome
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys


def hexdump(valor: object) -> str:
    if isinstance(valor, (bytes, bytearray)):
        return " ".join(f"{b:02X}" for b in valor)
    return repr(valor)


async def rodar(seconds: float, alvos: set[str], mostrar_tudo: bool) -> int:
    try:
        import bleak
        from bleak import BleakScanner
    except ImportError:
        sys.exit("[ERRO] bleak não instalado — rode dentro do venv do tuya-ble-sdk")

    try:
        from tuya_ble_sdk import parse_advertisement
        from tuya_ble_sdk.protocol import SERVICE_UUID
    except Exception as exc:  # pragma: no cover
        parse_advertisement = None
        SERVICE_UUID = None
        print(f"[AVISO] não consegui importar o SDK ({exc}) — vou mostrar só o BLE cru")

    print(f"[BLE] bleak {getattr(bleak, '__version__', '?')} | UUID de serviço Tuya esperado: {SERVICE_UUID}")
    print(f"[BLE] ouvindo {seconds:.0f}s...\n")

    achados = await BleakScanner.discover(timeout=seconds, return_adv=True)

    vistos = 0
    alvo_visto = False
    for device, adv in achados.values():
        endereco = (device.address or "").upper()
        eh_alvo = endereco in alvos
        if eh_alvo:
            alvo_visto = True
        tem_tuya = bool(
            SERVICE_UUID
            and (SERVICE_UUID in (adv.service_uuids or []) or SERVICE_UUID in (adv.service_data or {}))
        )
        if not (eh_alvo or tem_tuya or mostrar_tudo or adv.local_name):
            continue
        vistos += 1
        marca = "  ==> ALVO" if eh_alvo else ("  [tuya]" if tem_tuya else "")
        print(f"- {device.address}  rssi={adv.rssi}{marca}")
        if adv.local_name:
            print(f"    nome        : {adv.local_name}")
        if adv.service_uuids:
            print(f"    service_uuids: {list(adv.service_uuids)}")
        for uuid, dados in (adv.service_data or {}).items():
            print(f"    service_data[{uuid}]: {hexdump(dados)}")
        for cid, dados in (adv.manufacturer_data or {}).items():
            print(f"    manufacturer[0x{cid:04X}]: {hexdump(dados)}")
        if parse_advertisement and (adv.service_data or adv.manufacturer_data):
            try:
                info = parse_advertisement(adv.service_data or {}, adv.manufacturer_data or {})
                print(f"    parse_advertisement -> {json.dumps(info, default=lambda o: getattr(o, '__dict__', str(o)), ensure_ascii=False)}")
            except Exception as exc:
                print(f"    parse_advertisement -> falhou: {exc}")
        print()

    print(f"[RESUMO] {len(achados)} dispositivo(s) no total; {vistos} mostrado(s).")
    if alvos:
        if alvo_visto:
            print(f"[RESUMO] OK: {sorted(alvos)} APARECEU no radio deste computador.")
        else:
            print(f"[RESUMO] AUSENTE: {sorted(alvos)} nao apareceu. Ou esta longe/desligada, ou nao anuncia de forma visivel aqui.")
    return 0 if (alvo_visto or not alvos) else 2


def main() -> None:
    parser = argparse.ArgumentParser(description="Despeja dispositivos BLE crus (bleak)")
    parser.add_argument("--seconds", type=float, default=20.0)
    parser.add_argument("--mac", action="append", help="MAC para destacar (use várias vezes para vários)")
    parser.add_argument("--all", action="store_true", help="mostra todos os dispositivos")
    args = parser.parse_args()
    alvos = {m.strip().upper() for m in (args.mac or [])}
    sys.exit(asyncio.run(rodar(args.seconds, alvos, args.all)))


if __name__ == "__main__":
    main()
