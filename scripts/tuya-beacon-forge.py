#!/usr/bin/env python3
"""Monta (e decifra) o comando Tuya Beacon -- a peça que falta entre a
intenção do JARVIS e o transmissor HCI cru (`tuya-beacon-tx.py`).

Protocolo (ver `arafatamim/tuya-beacon-esphome`, PROTOCOL.md):

  ADV_IND conectável, 3 estruturas AD:
      02 01 06            Flags (descoberta geral, sem BR/EDR)
      <len> 09 <nome>     Complete Local Name -- precisa ser o nome do
                          controlador que pareou a lâmpada (<= 8 chars para
                          caber em 31 bytes junto com o UUID)
      11 07 <ct[16]>      Complete 128-bit Service UUID = ciphertext XXTEA

  Texto claro de 16 bytes:
      [0]     opcode 0x07 (DOWNLOAD_DP)
      [1]     0x24 (marcador fixo)
      [2:5]   contador anti-replay (24 bits, big-endian)
      [5:14]  datapoints compactos: id | tipo | len[2 BE] | valor
      [14]    CRC-8 (poly 0x07, init 0, sem reflexão) sobre [1:14]
      [15]    0x00

  Cifra: XXTEA, palavras big-endian, 19 rodadas, DELTA 0x9E3779B9.
  Chave: a local_key do dispositivo como 16 bytes ASCII (NÃO hex-decodificada).

Uso (na Rock Pi, junto com o transmissor):

    # 1) o que eu quero mandar virou um --adv de 31 bytes:
    python3 scripts/tuya-beacon-forge.py --encode --seq 544 --on \
        --name "Xiaomi 1" --raw-adv
    sudo python3 scripts/tuya-beacon-tx.py --hci 0 --adv <payload> --dwell-ms 150

    # 2) varrer uma janela de contador (anti-replay aceita poucos a mais):
    python3 scripts/tuya-beacon-forge.py --encode --seq 544 --on --sweep 8 \
        --name "Xiaomi 1" --raw-adv   # imprime um --adv por linha

    # 3) decifrar um anúncio de comando capturado (do celular):
    python3 scripts/tuya-beacon-forge.py --decode <32-hex>

Variáveis: TUYA_LOCALKEY (obrigatória), TUYA_ADV_NAME (nome local do controlador).
"""

from __future__ import annotations

import argparse
import os
import struct
import sys

DELTA = 0x9E3779B9
NOME_PADRAO = os.environ.get("TUYA_ADV_NAME", "")

# Tipos de datapoint (formato compacto Tuya) usados pela lâmpada RGBCW.
DP_ONOFF = 0x01
DP_MODO = 0x02
DP_BRILHO = 0x03
DP_TEMP = 0x04
DP_COR = 0x0B


def chave_do_ambiente() -> bytes:
    chave = os.environ.get("TUYA_LOCALKEY", "")
    if len(chave) != 16:
        sys.exit("! defina TUYA_LOCALKEY com 16 caracteres (a local_key LITERAL, não hex)")
    return chave.encode("ascii")


def xxtea_enc(bloco: bytes, chave: bytes) -> bytes:
    k = list(struct.unpack(">4I", chave))
    v = list(struct.unpack(">4I", bloco))
    n = 4
    s = 0
    z = v[n - 1]
    for _ in range(6 + 52 // n):
        s = (s + DELTA) & 0xFFFFFFFF
        e = (s >> 2) & 3
        for p in range(n):
            y = v[(p + 1) % n]
            mx = (((z >> 5) ^ (y << 2)) + ((y >> 3) ^ (z << 4))) ^ ((s ^ y) + (k[(p & 3) ^ e] ^ z))
            v[p] = (v[p] + mx) & 0xFFFFFFFF
            z = v[p]
    return struct.pack(">4I", *v)


def xxtea_dec(bloco: bytes, chave: bytes) -> bytes:
    k = list(struct.unpack(">4I", chave))
    v = list(struct.unpack(">4I", bloco))
    n = 4
    s = ((6 + 52 // n) * DELTA) & 0xFFFFFFFF
    y = v[0]
    while s != 0:
        e = (s >> 2) & 3
        for p in range(n - 1, -1, -1):
            z = v[(p - 1) % n]
            mx = (((z >> 5) ^ (y << 2)) + ((y >> 3) ^ (z << 4))) ^ ((s ^ y) + (k[(p & 3) ^ e] ^ z))
            v[p] = (v[p] - mx) & 0xFFFFFFFF
            y = v[p]
        s = (s - DELTA) & 0xFFFFFFFF
    return struct.pack(">4I", *v)


def crc8(dados: bytes) -> int:
    """CRC-8, poly 0x07, init 0x00, sem reflexão, sem xor de saída."""
    crc = 0
    for b in dados:
        crc ^= b
        for _ in range(8):
            crc = ((crc << 1) ^ 0x07) & 0xFF if crc & 0x80 else (crc << 1) & 0xFF
    return crc & 0xFF


def montar_texto_claro(seq: int, corpo: bytes) -> bytes:
    if len(corpo) > 9:
        sys.exit(f"! datapoints ocupam {len(corpo)} bytes; o máximo no quadro é 9")
    pt = bytearray(16)
    pt[0] = 0x07
    pt[1] = 0x24
    pt[2] = (seq >> 16) & 0xFF
    pt[3] = (seq >> 8) & 0xFF
    pt[4] = seq & 0xFF
    pt[5 : 5 + len(corpo)] = corpo
    pt[14] = crc8(bytes(pt[1:14]))
    return bytes(pt)


def dp_onoff(ligado: bool) -> bytes:
    return bytes([DP_ONOFF, 0x01, 0x01, 1 if ligado else 0])


def dp_modo(cor: bool) -> bytes:
    return bytes([DP_MODO, 0x04, 0x01, 1 if cor else 0])


def dp_brilho(nivel: int) -> bytes:
    return bytes([DP_BRILHO, 0x02, 0x04]) + struct.pack(">I", nivel & 0xFFFFFFFF)


def dp_temp_cor(nivel: int) -> bytes:
    return bytes([DP_TEMP, 0x02, 0x04]) + struct.pack(">I", nivel & 0xFFFFFFFF)


def dp_cor(matiz: int, sat: int, val: int) -> bytes:
    return bytes([DP_COR, 0x00, 0x04, matiz & 0xFF, (matiz >> 8) & 0xFF, sat & 0xFF, val & 0xFF])


def anuncio_bruto(nome: str, ct: bytes) -> bytes:
    """Monta os 31 bytes do anúncio: flags + nome completo + UUID 128 bits."""
    if len(ct) != 16:
        sys.exit("! o ciphertext do UUID tem de ter 16 bytes")
    if len(nome) > 8:
        sys.exit(f"! nome '{nome}' tem {len(nome)} chars; o máximo é 8 (senão passa de 31 bytes)")
    adv = bytearray([0x02, 0x01, 0x06])
    adv += bytes([len(nome) + 1, 0x09]) + nome.encode("ascii")
    adv += bytes([0x11, 0x07]) + ct
    if len(adv) > 31:
        sys.exit(f"! anúncio com {len(adv)} bytes (máximo 31)")
    return bytes(adv)


def decodificar(ct: bytes, chave: bytes, inverter: bool = False) -> None:
    ordem = "invertida (como sai do ParcelUuid do Android)" if inverter else "no ar"
    pt = xxtea_dec(ct[::-1] if inverter else ct, chave)
    print(f"  ordem {ordem}: {pt.hex(' ')}")
    op, marcador = pt[0], pt[1]
    if op not in (0x03, 0x06, 0x07) or marcador != 0x24:
        print("    (não parece comando: op/marcador inválidos)")
        return
    seq = (pt[2] << 16) | (pt[3] << 8) | pt[4]
    print(f"    op={op:#04x} marcador={marcador:#04x} contador={seq} ({seq:#08x})")
    esperado = crc8(pt[1:14])
    print(f"    crc: no pacote={pt[14]:#04x} calculado={esperado:#04x} {'OK' if esperado == pt[14] else 'DIFERE'}")
    corpo = pt[5:14]
    pos = 0
    while pos + 3 <= len(corpo):
        dp_id, dp_tipo, dp_len = corpo[pos], corpo[pos + 1], corpo[pos + 2]
        if dp_id == 0 or dp_len == 0:
            break  # resto é preenchimento com zeros
        valor = corpo[pos + 3 : pos + 3 + dp_len]
        if len(valor) < dp_len:
            break
        print(f"    DP {dp_id:#04x} tipo={dp_tipo:#04x} len={dp_len} valor={valor.hex(' ')}")
        pos += 3 + dp_len


def main() -> None:
    parser = argparse.ArgumentParser(description="Monta/decifra comando Tuya Beacon")
    parser.add_argument("--decode", metavar="HEX32", help="decifra um ciphertext de 16 bytes")
    parser.add_argument("--encode", action="store_true", help="monta um comando")
    parser.add_argument("--seq", type=int, default=0, help="contador anti-replay (24 bits)")
    parser.add_argument("--on", action="store_true")
    parser.add_argument("--off", action="store_true")
    parser.add_argument("--brightness", type=int, metavar="10..1000")
    parser.add_argument("--temp", type=int, metavar="0..1000")
    parser.add_argument("--color", metavar="H,S,V", help="matiz 0-360, saturação 0-100, valor 0-100")
    parser.add_argument("--nome", default=NOME_PADRAO, help="nome local do controlador (<= 8 chars)")
    parser.add_argument("--raw-adv", action="store_true", help="imprime o anúncio de 31 bytes (formato do --adv)")
    parser.add_argument("--sweep", type=int, metavar="N", help="gera N contadores (seq..seq+N-1)")
    parser.add_argument("--sem-nome", action="store_true", help="não inclui o nome local no anúncio")
    parser.add_argument("--autoteste", action="store_true")
    args = parser.parse_args()

    chave = chave_do_ambiente()

    if args.autoteste:
        pt = montar_texto_claro(0x002720, dp_onoff(True))
        ct = xxtea_enc(pt, chave)
        print(f"texto claro : {pt.hex(' ')}")
        print(f"cifrado     : {ct.hex()}")
        print(f"decifra     : {xxtea_dec(ct, chave).hex(' ')}")
        print("ida-e-volta :", "OK" if xxtea_dec(ct, chave) == pt else "FALHOU")
        print(f"crc8('123456789') = {crc8(b'123456789'):#04x} (esperado 0xf4)")
        return

    if args.decode:
        bruto = bytes.fromhex(args.decode)
        if len(bruto) != 16:
            sys.exit("! --decode espera exatamente 16 bytes (32 dígitos hex)")
        print(f"ciphertext: {bruto.hex(' ')}")
        decodificar(bruto, chave, inverter=False)
        decodificar(bruto, chave, inverter=True)
        return

    if not args.encode:
        parser.print_help()
        return

    corpo = b""
    if args.off:
        corpo += dp_onoff(False)
    if args.on:
        corpo += dp_onoff(True)
    if args.brightness is not None:
        corpo += dp_modo(False) + dp_brilho(args.brightness)
    if args.temp is not None:
        corpo += dp_modo(False) + dp_temp_cor(args.temp)
    if args.color:
        h, s, v = (int(p) for p in args.color.split(","))
        corpo += dp_modo(True) + dp_cor(h, s, v)
    if not corpo:
        sys.exit("! nada a enviar: use --on/--off/--brightness/--temp/--color")

    quantos = args.sweep or 1
    nome = "" if args.sem_nome else args.nome
    for i in range(quantos):
        seq = (args.seq + i) & 0xFFFFFF
        pt = montar_texto_claro(seq, corpo)
        ct = xxtea_enc(pt, chave)
        if args.raw_adv:
            print(anuncio_bruto(nome, ct).hex())
        else:
            print(f"seq={seq} texto_claro={pt.hex()} cifrado={ct.hex()}")


if __name__ == "__main__":
    main()
