#!/usr/bin/env python3
"""Extrai pacotes Tuya Beacon (26 bytes) de um log HCI / btsnoop ou dump bruto.

Busca a assinatura AD_PREFIXO (02 01 01 1b 03) seguida de 26 bytes e grava
cada pacote unico em um arquivo (um por linha), pronto para tuya-beacon-tx.py
--packets.

Uso:
    python scripts/tuya-beacon-extract.py btsnoop_hci.log -o config/tuya-beacon/luz-sala/on.txt
    python scripts/tuya-beacon-extract.py dump.bin --all
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

AD_PREFIXO = bytes.fromhex("0201011b03")
PKT_LEN = 26


def extrair(data: bytes) -> list[bytes]:
    out: list[bytes] = []
    seen: set[bytes] = set()
    i = 0
    n = len(data)
    while True:
        j = data.find(AD_PREFIXO, i)
        if j < 0:
            break
        start = j + len(AD_PREFIXO)
        pkt = data[start:start + PKT_LEN]
        if len(pkt) == PKT_LEN and pkt not in seen:
            seen.add(pkt)
            out.append(pkt)
        i = j + 1
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="Extrai beacons Tuya de um log/dump")
    ap.add_argument("input", help="arquivo de entrada (btsnoop, dump, etc.)")
    ap.add_argument("-o", "--output", help="arquivo de saida (um pacote por linha)")
    ap.add_argument("--all", action="store_true", help="imprime todos no stdout")
    args = ap.parse_args()

    data = Path(args.input).read_bytes()
    pkts = extrair(data)
    print(f"encontrados: {len(pkts)} pacote(s) unico(s)", file=sys.stderr)

    if args.all or not args.output:
        for p in pkts:
            print(p.hex())
    if args.output:
        out = Path(args.output)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text("".join(p.hex() + "\n" for p in pkts), encoding="utf-8")
        print(f"gravado em {out}", file=sys.stderr)


if __name__ == "__main__":
    main()
