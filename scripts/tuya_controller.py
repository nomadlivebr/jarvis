#!/usr/bin/env python3
"""
Controlador local da lâmpada Tuya via TinyTuya (rede/Wi-Fi).

ATENÇÃO — LIMITE DA FERRAMENTA:
    TinyTuya só fala com dispositivos Tuya **na rede local** (TCP 6668,
    protocolos 3.1/3.3/3.4/3.5). Ele NÃO fala BLE.
    Se a lâmpada for só-BLE, nada aqui vai funcionar (use o `tuya-ble-sdk`).

PRINCIPAIS PEGADINHAS (já tratadas aqui):
  1. `address` é o **IP na rede**, não o MAC do Bluetooth.
  2. `address=None` faz o TinyTuya **procurar a lâmpada na rede pelo dev_id**
     e já ajustar a versão do protocolo sozinho. Se não achar, levanta
     RuntimeError — que é justamente a resposta para "ela está na LAN?".
  3. `device.send(payload)` NÃO espera resposta (getresponse=False na lib).
     Por isso aqui usamos `turn_on()/turn_off()/set_*()` e SEMPRE imprimimos
     e checamos o retorno: falha de rede volta como `{'Error': ...}`, sem
     levantar exceção.

Configuração (NUNCA comite a chave — o repo é público):
    export TUYA_DEVICE_ID="..."      # ou config/devices.json se preferir
    export TUYA_LOCAL_KEY="..."      # 16 dígitos hex
    export TUYA_IP="192.168.0.37"    # opcional: sem isso, procura na LAN
    export TUYA_VERSION="3.3"        # usado só quando TUYA_IP é informado

Uso:
    python3 scripts/tuya_controller.py --status
    python3 scripts/tuya_controller.py --on
    python3 scripts/tuya_controller.py --off
    python3 scripts/tuya_controller.py --brightness 50
    python3 scripts/tuya_controller.py --temp 80      # 0=quente, 100=fria
    python3 scripts/tuya_controller.py --color 255,0,0
"""

from __future__ import annotations

import argparse
import json
import os
import sys


def _print_result(label: str, result: object) -> bool:
    """Imprime o retorno cru e diz se foi sucesso. TinyTuya devolve erros como dict."""
    print(f"{label} {json.dumps(result, indent=2, ensure_ascii=False, default=str)}")
    if isinstance(result, dict) and ("Error" in result or "Err" in result):
        print(f"[FALHA] {result.get('Error') or result.get('Err')}")
        return False
    return True


class LampadaJarvis:
    """Luz RGB+CCT Tuya com controle 100% local (sem nuvem em runtime)."""

    def __init__(self, dev_id: str, local_key: str, ip: str | None = None, version: float = 3.3):
        import tinytuya  # import tardio: o módulo roda mesmo sem a lib instalada

        self.bulb = tinytuya.BulbDevice(
            dev_id=dev_id,
            address=ip or None,  # None => procura o dispositivo na LAN pelo dev_id
            local_key=local_key,
            version=version,
        )
        self.bulb.set_socketPersistent(True)
        self.bulb.set_socketTimeout(5)
        print(f"[INFO] lâmpada em {self.bulb.address} | protocolo {self.bulb.version_str or version}")

    def estado(self) -> bool:
        return _print_result("[ESTADO]", self.bulb.status())

    def ligar(self) -> bool:
        return _print_result("[LIGAR]", self.bulb.turn_on())

    def desligar(self) -> bool:
        return _print_result("[DESLIGAR]", self.bulb.turn_off())

    def brilho(self, percentual: int) -> bool:
        """Brilho de 1 a 100%."""
        return _print_result("[BRILHO]", self.bulb.set_brightness_percentage(int(percentual)))

    def temperatura(self, percentual: int) -> bool:
        """Temperatura da luz branca: 0% = quente/amarelada, 100% = fria/branca."""
        return _print_result("[TEMPERATURA]", self.bulb.set_colourtemp_percentage(int(percentual)))

    def cor(self, r: int, g: int, b: int) -> bool:
        """Cor RGB (0-255 cada) — coloca a lâmpada em modo 'colour'."""
        return _print_result("[COR]", self.bulb.set_colour(int(r), int(g), int(b)))


def main() -> None:
    parser = argparse.ArgumentParser(description="Controla a lâmpada Tuya na rede local (TinyTuya)")
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--on", action="store_true")
    parser.add_argument("--off", action="store_true")
    parser.add_argument("--brightness", type=int, help="1 a 100 (%%)")
    parser.add_argument("--temp", type=int, help="0 (quente) a 100 (fria)")
    parser.add_argument("--color", help="R,G,B entre 0 e 255 (ex.: 255,0,0)")
    args = parser.parse_args()

    dev_id = os.environ.get("TUYA_DEVICE_ID")
    local_key = os.environ.get("TUYA_LOCAL_KEY")
    ip = os.environ.get("TUYA_IP") or None
    version = float(os.environ.get("TUYA_VERSION", "3.3"))

    if not dev_id or not local_key:
        sys.exit("[ERRO] defina TUYA_DEVICE_ID e TUYA_LOCAL_KEY (veja o cabeçalho deste arquivo)")

    try:
        lampada = LampadaJarvis(dev_id, local_key, ip, version)
    except RuntimeError as exc:
        print(f"\n[RESPOSTA DEFINITIVA] {exc}")
        print("  => A lâmpada NÃO respondeu na rede local: ela é só-BLE (ou está em outra VLAN).")
        print("  => Nesse caso o TinyTuya é beco sem saída: o caminho é o `tuya-ble-sdk`.")
        sys.exit(1)

    if args.status or args.on or args.off:
        lampada.estado()
    if args.on:
        lampada.ligar()
    if args.off:
        lampada.desligar()
    if args.brightness is not None:
        lampada.brilho(args.brightness)
    if args.temp is not None:
        lampada.temperatura(args.temp)
    if args.color:
        r, g, b = (int(v) for v in args.color.split(","))
        lampada.cor(r, g, b)
    if not any([args.status, args.on, args.off, args.brightness is not None, args.temp is not None, args.color]):
        print("[DICA] nada a fazer. Use --status, --on, --off, --brightness, --temp ou --color.")


if __name__ == "__main__":
    main()
