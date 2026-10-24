#!/usr/bin/env python3
"""
Controle local de lampada Tuya BLE (GATT, protocolo Tuya BLE v3).

Por que este script existe
--------------------------
A lampada e *BLE-only*: ela nao esta na rede Wi-Fi e a nuvem Tuya nao expoe
controle para ela (o TinyTuya nao serve). O unico caminho e falar GATT direto
com o handshake cifrado do protocolo Tuya BLE. O pacote `tuya-ble-sdk` (MIT)
implementa o transporte (AES-128-CBC + CRC16 + fragmentacao em MTU 20), mas a
versao 0.1.3 so LE datapoints. Este script estende o cliente com a escrita de
datapoints (comando 0x0002) para ligar/desligar, brilho, cor e temperatura.

Credenciais (nunca versionar)
-----------------------------
    TUYA_BLE_DEVICE_ID   id do dispositivo na conta Tuya (ex.: eb2063...)
    TUYA_BLE_LOCAL_KEY   local_key de 16 caracteres, vinda da conta
    TUYA_BLE_UUID        opcional: se faltar, e descoberta no anuncio BLE
    TUYA_BLE_ADDRESS     opcional: MAC fixo (endereco pode rotacionar)

Execucao (usar o venv que tem bleak + tuya-ble-sdk):
    ~/tuya-ble/.venv/Scripts/python.exe scripts/tuya-ble-ctl.py scan
    ~/tuya-ble/.venv/Scripts/python.exe scripts/tuya-ble-ctl.py read
    ~/tuya-ble/.venv/Scripts/python.exe scripts/tuya-ble-ctl.py on
    ~/tuya-ble/.venv/Scripts/python.exe scripts/tuya-ble-ctl.py brightness 40
    ~/tuya-ble/.venv/Scripts/python.exe scripts/tuya-ble-ctl.py color 255,80,0
    ~/tuya-ble/.venv/Scripts/python.exe scripts/tuya-ble-ctl.py temp 80
    ~/tuya-ble/.venv/Scripts/python.exe scripts/tuya-ble-ctl.py set --dp 20 --type bool --value 1

A saida e sempre JSON em stdout (o Jarvis consome isso); logs vao para stderr.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from typing import Any

# Codigos de datapoint do protocolo Tuya BLE (ver protocol/data_point_type.py)
DP_RAW = 0
DP_BOOLEAN = 1
DP_VALUE = 2
DP_STRING = 3
DP_ENUM = 4
DP_BITMAP = 5

TYPE_BY_NAME = {
    "raw": DP_RAW,
    "bool": DP_BOOLEAN,
    "boolean": DP_BOOLEAN,
    "value": DP_VALUE,
    "int": DP_VALUE,
    "string": DP_STRING,
    "str": DP_STRING,
    "enum": DP_ENUM,
    "bitmap": DP_BITMAP,
}

# Categoria "dj" (lampadas) usa estes IDs de datapoint por padrao.
DEFAULT_DPS = {
    "power": 20,
    "mode": 21,
    "bright": 22,
    "temp": 23,
    "colour": 24,
}

EXIT_OK = 0
EXIT_CONFIG = 2
EXIT_NOT_FOUND = 3
EXIT_PROTOCOL = 4


def log(message: str) -> None:
    """Mensagem humana no stderr; stdout fica reservado para o JSON."""
    print(message, file=sys.stderr, flush=True)


def emit(payload: dict[str, Any], code: int = EXIT_OK) -> int:
    print(json.dumps(payload, ensure_ascii=False, default=str))
    return code


# --------------------------------------------------------------------------- #
# Codificacao dos datapoints
# --------------------------------------------------------------------------- #


def encode_value(dp_type: int, value: Any) -> bytes:
    """Serializa o valor conforme o tipo declarado no datapoint."""
    if dp_type == DP_RAW:
        return bytes.fromhex(str(value))
    if dp_type == DP_BOOLEAN:
        truthy = value in (True, 1, "1", "true", "on", "yes")
        return b"\x01" if truthy else b"\x00"
    if dp_type == DP_VALUE:
        return int(value).to_bytes(4, "big", signed=True)
    if dp_type == DP_ENUM:
        return int(value).to_bytes(1, "big")
    if dp_type == DP_BITMAP:
        return int(value).to_bytes(4, "big")
    if dp_type == DP_STRING:
        return str(value).encode("utf-8")
    raise ValueError(f"tipo de datapoint desconhecido: {dp_type}")


def build_dp_payload(records: list[tuple[int, int, Any]]) -> bytes:
    """
    Monta o corpo do comando 0x0002: uma sequencia de registros

        [id:1][tipo:1][tamanho:1][valor:n]

    O formato e o mesmo que o SDK le em parse_data_points, so que no sentido
    app -> dispositivo.
    """
    payload = bytearray()
    for identifier, dp_type, value in records:
        encoded = encode_value(dp_type, value)
        if not 0 <= identifier <= 0xFF:
            raise ValueError(f"id de datapoint invalido: {identifier}")
        if len(encoded) > 0xFF:
            raise ValueError(f"valor grande demais para o datapoint {identifier}")
        payload += bytes([identifier, dp_type, len(encoded)]) + encoded
    return bytes(payload)


def rgb_to_tuya_colour(red: int, green: int, blue: int) -> str:
    """Converte RGB (0-255) para o JSON HSV que a Tuya espera em colour_data."""
    r, g, b = (max(0, min(255, int(v))) / 255.0 for v in (red, green, blue))
    high = max(r, g, b)
    low = min(r, g, b)
    delta = high - low
    if delta == 0:
        hue = 0.0
    elif high == r:
        hue = (60 * ((g - b) / delta)) % 360
    elif high == g:
        hue = 60 * ((b - r) / delta) + 120
    else:
        hue = 60 * ((r - g) / delta) + 240
    saturation = 0.0 if high == 0 else delta / high
    return json.dumps(
        {
            "h": int(round(hue)) % 360,
            "s": int(round(saturation * 1000)),
            "v": int(round(high * 1000)),
        },
        separators=(",", ":"),
    )


# --------------------------------------------------------------------------- #
# Cliente: o SDK le datapoints; aqui adicionamos a escrita
# --------------------------------------------------------------------------- #


class WritableTuyaBleClient:
    """
    Envelopa o TuyaBleClient do SDK reaproveitando conexao, handshake e chaves.

    Os metodos internos (_async_connect/_async_handshake/_async_request) sao os
    mesmos usados pela leitura; o pin e `tuya-ble-sdk==0.1.3`.
    """

    def __init__(self, device: Any, credentials: Any) -> None:
        from tuya_ble_sdk import TuyaBleClient

        self._client = TuyaBleClient(device, credentials)

    @property
    def address(self) -> str:
        return self._client.address

    async def async_read(self) -> dict[str, Any]:
        points = await self._client.async_read_data_points()
        return {
            str(identifier): {
                "id": identifier,
                "tipo": int(point.data_type),
                "valor": _jsonable(point.value),
                "timestamp": point.timestamp,
            }
            for identifier, point in sorted(points.items())
        }

    async def async_write(self, records: list[tuple[int, int, Any]]) -> dict[str, Any]:
        """Abre sessao, faz o handshake e envia os datapoints em um comando 0x0002."""
        from tuya_ble_sdk import TuyaBleCommandCode
        from tuya_ble_sdk.exceptions import TuyaBleError

        payload = build_dp_payload(records)
        client = self._client
        try:
            async with asyncio.timeout(60):
                await client._async_connect()  # noqa: SLF001 - API interna pinada
                await client._async_handshake()  # noqa: SLF001
                reply = await client._async_request(  # noqa: SLF001
                    TuyaBleCommandCode.SENDER_DATA_POINTS, payload
                )
        except TuyaBleError as exc:
            return {"enviado": payload.hex(), "erro": str(exc)}
        finally:
            await client._async_disconnect()  # noqa: SLF001
        return {
            "enviado": payload.hex(),
            "resposta": {"codigo": reply.code, "dados": reply.data.hex()},
        }


def _jsonable(value: Any) -> Any:
    if isinstance(value, (bytes, bytearray)):
        return value.hex()
    return value


# --------------------------------------------------------------------------- #
# Descoberta
# --------------------------------------------------------------------------- #


async def discover(
    address: str | None, wanted_uuid: str | None, seconds: float
) -> tuple[Any, dict[str, Any]]:
    """Acha a lampada no radio: por MAC, por uuid do anuncio ou por servico Tuya."""
    from bleak import BleakScanner
    from tuya_ble_sdk import SERVICE_UUID, parse_advertisement

    wanted_address = (address or "").upper()
    found = await BleakScanner.discover(timeout=seconds, return_adv=True)

    tuya_devices: list[dict[str, Any]] = []
    fallback = None
    fallback_entry: dict[str, Any] | None = None
    for device, advertisement in found.values():
        info = parse_advertisement(
            advertisement.service_data or {}, advertisement.manufacturer_data or {}
        )
        is_tuya = bool(
            SERVICE_UUID in (advertisement.service_uuids or ())
            or SERVICE_UUID in (advertisement.service_data or {})
        )
        entry = {
            "endereco": device.address,
            "nome": advertisement.local_name or device.name,
            "rssi": advertisement.rssi,
            "uuid": info.uuid,
            "product_id": info.product_id,
            "vinculado": info.is_bound,
            "servico_tuya": is_tuya,
        }
        if wanted_address and (device.address or "").upper() == wanted_address:
            return device, entry
        if wanted_uuid and info.uuid and info.uuid.lower() == wanted_uuid.lower():
            return device, entry
        if is_tuya:
            tuya_devices.append(entry)
            if fallback is None:
                fallback = device
                fallback_entry = entry
    if fallback is not None and fallback_entry is not None:
        return fallback, {**fallback_entry, "candidatos": tuya_devices}
    raise LookupError(
        "lampada nao encontrada no radio (ligue-a / aproxime e tente de novo). "
        f"Dispositivos Tuya vistos: {json.dumps(tuya_devices, ensure_ascii=False)}"
    )


async def async_scan(seconds: float) -> int:
    from bleak import BleakScanner
    from tuya_ble_sdk import SERVICE_UUID, parse_advertisement

    found = await BleakScanner.discover(timeout=seconds, return_adv=True)
    devices = []
    for device, advertisement in found.values():
        info = parse_advertisement(
            advertisement.service_data or {}, advertisement.manufacturer_data or {}
        )
        is_tuya = bool(
            SERVICE_UUID in (advertisement.service_uuids or ())
            or SERVICE_UUID in (advertisement.service_data or {})
        )
        if not (is_tuya or info.uuid or info.product_id):
            continue
        devices.append(
            {
                "endereco": device.address,
                "nome": advertisement.local_name or device.name,
                "rssi": advertisement.rssi,
                "uuid": info.uuid,
                "product_id": info.product_id,
                "vinculado": info.is_bound,
                "servico_tuya": is_tuya,
            }
        )
    devices.sort(key=lambda item: item["rssi"] or -999, reverse=True)
    return emit({"ok": True, "segundos": seconds, "dispositivos": devices})


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #


def credentials_from_env(uuid_override: str | None) -> tuple[str | None, str, str]:
    device_id = os.environ.get("TUYA_BLE_DEVICE_ID", "").strip()
    local_key = os.environ.get("TUYA_BLE_LOCAL_KEY", "").strip()
    uuid = (uuid_override or os.environ.get("TUYA_BLE_UUID", "")).strip()
    if not device_id or not local_key:
        raise ValueError(
            "defina TUYA_BLE_DEVICE_ID e TUYA_BLE_LOCAL_KEY "
            "(veja config/devices.local.json no Jarvis)"
        )
    return (uuid or None), device_id, local_key


def build_records(args: argparse.Namespace) -> list[tuple[int, int, Any]]:
    if args.command == "set":
        dp_type = TYPE_BY_NAME[args.type.lower()]
        records: list[tuple[int, int, Any]] = [(args.dp, dp_type, args.value)]
    elif args.command == "power":
        records = [(args.dp_power, DP_BOOLEAN, args.value)]
    elif args.command == "brightness":
        percent = max(1, min(100, args.value))
        # bright_value do protocolo vai de 10 a 1000
        records = [(args.dp_bright, DP_VALUE, max(10, round(percent * 10)))]
    elif args.command == "temp":
        percent = max(0, min(100, args.value))
        records = [(args.dp_temp, DP_VALUE, round(percent * 10))]
    elif args.command == "color":
        channels = [int(part) for part in args.value.split(",")]
        if len(channels) != 3:
            raise ValueError("cor no formato R,G,B (ex.: 255,80,0)")
        records = [(args.dp_colour, DP_STRING, rgb_to_tuya_colour(*channels))]
        # colour_data so aparece no modo "colour"
        if args.dp_mode:
            records.insert(0, (args.dp_mode, DP_ENUM, 1))
    else:
        raise ValueError(f"comando sem escrita: {args.command}")
    # Um unico frame com power + valor evita duas sessoes BLE (a lampada dorme rapido).
    if args.power_on and args.command in ("brightness", "temp", "color"):
        records.insert(0, (args.dp_power, DP_BOOLEAN, 1))
    return records


async def run(args: argparse.Namespace) -> int:
    if args.command == "scan":
        return await async_scan(args.seconds)

    uuid, device_id, local_key = credentials_from_env(args.uuid)
    address = args.address or os.environ.get("TUYA_BLE_ADDRESS") or None

    try:
        device, info = await discover(address, uuid, args.seconds)
    except LookupError as exc:
        return emit({"ok": False, "erro": str(exc), "motivo": "nao_encontrado"}, EXIT_NOT_FOUND)

    # Sem uuid no ambiente: usa o que o anuncio entrega (o SDK decifra).
    if not uuid:
        uuid = info.get("uuid")
    if not uuid:
        return emit(
            {
                "ok": False,
                "erro": "uuid do dispositivo desconhecido: informe TUYA_BLE_UUID "
                "ou aguarde um anuncio com product_id + manufacturer data",
                "anuncio": info,
            },
            EXIT_CONFIG,
        )

    from tuya_ble_sdk import TuyaBleCredentials

    client = WritableTuyaBleClient(
        device, TuyaBleCredentials(uuid=uuid, device_id=device_id, local_key=local_key)
    )
    base = {"ok": True, "endereco": device.address, "uuid": uuid, "anuncio": info}

    if args.command == "read":
        data = await client.async_read()
        return emit({**base, "datapoints": data})

    records = build_records(args)
    result = await client.async_write(records)
    if "erro" in result:
        return emit({**base, "ok": False, **result}, EXIT_PROTOCOL)
    return emit({**base, "datapoints_enviados": _describe(records), **result})


def _describe(records: list[tuple[int, int, Any]]) -> list[dict[str, Any]]:
    names = {value: key for key, value in TYPE_BY_NAME.items()}
    return [
        {"id": identifier, "tipo": names.get(dp_type, dp_type), "valor": _jsonable(value)}
        for identifier, dp_type, value in records
    ]


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Controle local de lampada Tuya BLE")
    parser.add_argument("command", choices=["scan", "read", "on", "off", "power", "brightness", "temp", "color", "set"])
    parser.add_argument("value", nargs="?", help="valor do comando (R,G,B, 0-100, ...)")
    parser.add_argument("--address", help="MAC fixo do dispositivo")
    parser.add_argument("--uuid", help="uuid do dispositivo (senao descobre no anuncio)")
    parser.add_argument("--seconds", type=float, default=12.0, help="tempo de varredura")
    parser.add_argument("--dp", type=int, help="id do datapoint (comando set)")
    parser.add_argument("--type", default="bool", help="tipo do datapoint (set)")
    parser.add_argument("--dp-power", type=int, default=DEFAULT_DPS["power"])
    parser.add_argument("--dp-mode", type=int, default=DEFAULT_DPS["mode"])
    parser.add_argument("--dp-bright", type=int, default=DEFAULT_DPS["bright"])
    parser.add_argument("--dp-temp", type=int, default=DEFAULT_DPS["temp"])
    parser.add_argument("--dp-colour", type=int, default=DEFAULT_DPS["colour"])
    parser.add_argument(
        "--power-on",
        action="store_true",
        help="inclui o datapoint de power no mesmo frame (brilho/cor/temperatura)",
    )
    args = parser.parse_args(argv)

    if args.command in ("on", "off"):
        args.value = 1 if args.command == "on" else 0
        args.command = "power"
    if args.command in ("brightness", "temp"):
        if args.value is None:
            parser.error(f"{args.command} exige um valor de 0 a 100")
        args.value = int(args.value)
    if args.command == "color" and not args.value:
        parser.error("color exige R,G,B (ex.: 255,80,0)")
    if args.command == "set" and args.dp is None:
        parser.error("set exige --dp")
    if args.command == "set" and args.value is None:
        parser.error("set exige um valor posicional")
    return args


def main(argv: list[str]) -> int:
    try:
        args = parse_args(argv)
        return asyncio.run(run(args))
    except ValueError as exc:
        return emit({"ok": False, "erro": str(exc), "motivo": "config"}, EXIT_CONFIG)
    except KeyboardInterrupt:
        return emit({"ok": False, "erro": "interrompido"}, 130)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
