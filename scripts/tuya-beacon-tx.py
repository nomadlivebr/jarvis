#!/usr/bin/env python3
"""Transmite anuncios BLE legados crus via HCI (Linux/BlueZ) -- sem D-Bus.

Por que HCI cru: a API de advertising do BlueZ (D-Bus) nao permite escolher
arbitrariamente o nome local E um UUID de 128 bits com bytes quaisquer, que e
exatamente o que o protocolo Tuya Beacon exige (o payload cifrado vai dentro do
campo "Complete 128-bit Service UUID").

Precisa de root (CAP_NET_ADMIN). Adaptador deve estar UP:
    sudo hciconfig hci0 up        # ou: bluetoothctl power on

Uso:
    sudo python3 tuya-beacon-tx.py --hci 0 --adv <31-bytes-hex> [--adv ...] \\
        [--dwell-ms 150] [--gap-ms 20] [--addr public|random]

`--adv` pode ser repetido: cada payload e anunciado por `--dwell-ms` e depois
desligado -- util para varrer uma janela de sequencia (seq, seq+1, ...).
"""
from __future__ import annotations

import argparse
import socket
import struct
import sys
import time

# CPython fixa o canal no bind (HCI_CHANNEL_RAW): a tupla leva SOMENTE o indice
# do adaptador. `bind((dev, canal))` falha com "wrong format".
BTPROTO_HCI = 1
HCI_COMMAND_PKT = 0x01
HCI_EVENT_PKT = 0x04

OGF_LE = 0x08
OCF_LE_SET_ADV_PARAMS = 0x0006
OCF_LE_SET_ADV_DATA = 0x0008
OCF_LE_SET_ADV_ENABLE = 0x000A

ADV_TYPE_IND = 0x00  # connectable undirected
ADV_TYPE_NONCONN = 0x03  # non-connectable (o controle do app anuncia assim)

STATUS = {
    0x00: "success",
    0x01: "unknown HCI command",
    0x02: "unknown connection identifier",
    0x0C: "command disallowed",
    0x12: "invalid HCI command parameters",
}


def opcode(ogf: int, ocf: int) -> int:
    return (ogf << 10) | ocf


def cmd_packet(ogf: int, ocf: int, params: bytes) -> bytes:
    return bytes([HCI_COMMAND_PKT]) + struct.pack("<HB", opcode(ogf, ocf), len(params)) + params


class Hci:
    def __init__(self, dev: int) -> None:
        self.sock = socket.socket(socket.AF_BLUETOOTH, socket.SOCK_RAW, BTPROTO_HCI)
        try:
            self.sock.bind((dev,))
        except PermissionError:
            sys.exit("! sem permissao: rode com sudo (HCI cru exige CAP_NET_ADMIN)")
        except OSError as exc:
            sys.exit(f"! nao consegui abrir hci{dev}: {exc} (adaptador up? hciconfig hci{dev} up)")
        self.sock.settimeout(0.4)

    def send(self, ogf: int, ocf: int, params: bytes) -> int | None:
        try:
            # No Linux o comando e sincrono: send() so retorna depois que o
            # controlador respondeu (o kernel consome o Command Complete).
            self.sock.send(cmd_packet(ogf, ocf, params))
        except OSError as exc:
            print(f"  HCI 0x{opcode(ogf, ocf):04x}: erro {exc}", flush=True)
            return 0x01  # trata como falha do comando
        return self._wait_complete(opcode(ogf, ocf))

    def _wait_complete(self, want: int) -> int | None:
        fim = time.time() + 0.5
        while time.time() < fim:
            try:
                pkt = self.sock.recv(1024)
            except socket.timeout:
                return None
            if not pkt or pkt[0] != HCI_EVENT_PKT:
                continue
            ev = pkt[1]
            if ev == 0x0E and len(pkt) >= 7:  # Command Complete
                op = struct.unpack_from("<H", pkt, 4)[0]
                if op == want:
                    return pkt[6]
            elif ev == 0x0F and len(pkt) >= 7:  # Command Status
                op = struct.unpack_from("<H", pkt, 5)[0]
                if op == want:
                    return pkt[3]
        return None


def adv_params(own_addr_type: int, adv_type: int = ADV_TYPE_IND, interval: int = 0x0020) -> bytes:
    """LE Set Advertising Parameters -> canal 37/38/39, sem filtro."""
    return struct.pack(
        "<HHBBB6sBB",
        interval,
        interval,
        adv_type,
        own_addr_type,
        0x00,           # peer address type
        b"\x00" * 6,    # peer address
        0x07,           # channel map: 37,38,39
        0x00,           # filter policy
    )


def adv_data(payload: bytes) -> bytes:
    if len(payload) > 31:
        sys.exit(f"! payload com {len(payload)} bytes > 31 (limite do anuncio legado)")
    return bytes([len(payload)]) + payload.ljust(31, b"\x00")


AD_PREFIXO = bytes.fromhex("0201011b03")  # flags + lista de UUIDs de 16 bits (como o app)


def crc8_beacon(pkt: bytes | bytearray) -> int:
    """CRC-8 do pacote Tuya: poly 0x07, init 0x00, xorout 0x83 sobre pkt[1:25]."""
    c = 0
    for b in pkt[1:25]:
        c ^= b
        for _ in range(8):
            c = ((c << 1) & 0xFF) ^ (0x07 if c & 0x80 else 0)
    return c ^ 0x83


def ajustar_contador(pkt: bytes, ctr: int) -> bytes:
    """Reescreve o contador (LE nos bytes 6-7) e recalcula o CRC.

    O contador fica FORA do bloco cifrado (o mesmo enc aparece com contadores
    diferentes), entao reescrever nao invalida a cifra -- so o CRC.
    """
    novo = bytearray(pkt)
    novo[6:8] = (ctr & 0xFFFF).to_bytes(2, "little")
    novo[25] = crc8_beacon(novo)
    return bytes(novo)


def check(status: int | None, what: str) -> bool:
    if status is None:
        # Sem evento no socket: no HCI_CHANNEL_RAW o kernel ja consumiu o
        # Command Complete. O comando foi aceito (erros vem como OSError).
        return True
    if status != 0x00:
        print(f"  {what}: FALHOU status=0x{status:02x} ({STATUS.get(status, '?')})", flush=True)
        return False
    return True


def main() -> None:
    p = argparse.ArgumentParser(description="Tuya Beacon TX via HCI cru (Linux)")
    p.add_argument("--hci", type=int, default=0, help="indice do adaptador (default 0)")
    p.add_argument("--adv", action="append", help="payload de anuncio em hex (repetivel)")
    p.add_argument(
        "--packets",
        help="arquivo com pacotes Tuya de 26 bytes (um por linha; '#' = comentario)",
    )
    p.add_argument(
        "--base-counter",
        type=int,
        default=None,
        help="com --packets: reescreve o contador a partir deste valor e recalcula o CRC",
    )
    p.add_argument("--dwell-ms", type=int, default=150, help="tempo anunciando cada payload")
    p.add_argument("--gap-ms", type=int, default=30, help="pausa entre payloads")
    p.add_argument("--addr", choices=("public", "random"), default="public", help="own address type")
    p.add_argument(
        "--type",
        choices=("conn", "nonconn"),
        default="nonconn",
        help="tipo de anuncio: nonconn (padrao, como o app) ou conn",
    )
    p.add_argument("--silent", action="store_true", help="nao imprime status de cada comando")
    args = p.parse_args()

    payloads = []
    for hexa in args.adv or []:
        limpo = hexa.replace(":", "").replace(" ", "").strip()
        try:
            payloads.append(bytes.fromhex(limpo))
        except ValueError:
            sys.exit(f"! hex invalido: {hexa!r}")

    if args.packets:
        try:
            with open(args.packets, encoding="utf-8") as fh:
                linhas = fh.read().splitlines()
        except OSError as exc:
            sys.exit(f"! nao consegui ler {args.packets}: {exc}")
        base = args.base_counter
        for linha in linhas:
            linha = linha.strip()
            if not linha or linha.startswith("#"):
                continue
            try:
                pkt = bytes.fromhex(linha)
            except ValueError:
                continue
            if len(pkt) != 26:
                continue
            if base is not None:
                pkt = ajustar_contador(pkt, base)
                base += 1
            payloads.append(AD_PREFIXO + pkt)

    if not payloads:
        sys.exit("! nada para enviar: use --adv e/ou --packets")

    own = 0x00 if args.addr == "public" else 0x01
    adv_type = ADV_TYPE_IND if args.type == "conn" else ADV_TYPE_NONCONN
    hci = Hci(args.hci)

    if not args.silent:
        print(f"hci{args.hci}: {len(payloads)} payload(s), dwell={args.dwell_ms}ms", flush=True)

    # parametros primeiro desligam o advertising (senao da Command Disallowed)
    check(hci.send(OGF_LE, OCF_LE_SET_ADV_ENABLE, bytes([0x00])), "LE Set Adv Enable(0)")
    check(hci.send(OGF_LE, OCF_LE_SET_ADV_PARAMS, adv_params(own, adv_type)), "LE Set Adv Params")

    for i, payload in enumerate(payloads, 1):
        dados = adv_data(payload)
        if not check(hci.send(OGF_LE, OCF_LE_SET_ADV_DATA, dados), f"LE Set Adv Data #{i}"):
            continue
        if not check(hci.send(OGF_LE, OCF_LE_SET_ADV_ENABLE, bytes([0x01])), f"LE Set Adv Enable(1) #{i}"):
            continue
        if not args.silent:
            extra = ""
            if payload.startswith(AD_PREFIXO) and len(payload) == len(AD_PREFIXO) + 26:
                pkt = payload[len(AD_PREFIXO):]
                extra = f"  b8={pkt[8]:02x} ctr={int.from_bytes(pkt[6:8], 'little')}"
            print(f"  #{i} anunciando{extra}: {payload.hex()}", flush=True)
        time.sleep(args.dwell_ms / 1000.0)
        hci.send(OGF_LE, OCF_LE_SET_ADV_ENABLE, bytes([0x00]))
        time.sleep(args.gap_ms / 1000.0)

    print("fim", flush=True)


if __name__ == "__main__":
    main()
