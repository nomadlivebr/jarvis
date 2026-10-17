#!/usr/bin/env python3
"""
Sonda/controle da lâmpada Tuya pela **API de nuvem** (TinyTuya Cloud).

Por que isso é útil mesmo se o controle final for local:
  `cloud.getdevices()` devolve, para cada dispositivo, o **IP na LAN**, a
  **versão do protocolo** e a **local_key** — ou seja, a nuvem serve para
  *descobrir* o que o controle local precisa. Depois o controle pode ser
  100% local (sem internet).

LIMITE IMPORTANTE:
  A nuvem só alcança dispositivo que esteja **online por Wi-Fi** (ou atrás de
  um gateway). Lâmpada só-BLE aparece com `online: false` e o `sendcommand`
  falha — nesse caso só o `tuya-ble-sdk` resolve.

Credenciais (Access ID / Access Secret do projeto em iot.tuya.com → Cloud):
    export TUYA_API_KEY="..."       # Access ID
    export TUYA_API_SECRET="..."    # Access Secret
    export TUYA_API_REGION="us"     # us | eu | cn | in (Brasil = us)
    export TUYA_DEVICE_ID="..."     # opcional, senão usa o 1º da conta

Uso:
    python3 scripts/tuya-cloud-probe.py --list
    python3 scripts/tuya-cloud-probe.py --status
    python3 scripts/tuya-cloud-probe.py --functions
    python3 scripts/tuya-cloud-probe.py --on | --off
    python3 scripts/tuya-cloud-probe.py --brightness 50
    python3 scripts/tuya-cloud-probe.py --temp 80
    python3 scripts/tuya-cloud-probe.py --color 255,0,0
    python3 scripts/tuya-cloud-probe.py --list --show-keys
"""

from __future__ import annotations

import argparse
import colorsys
import json
import os
import sys


def mask(secret: str | None) -> str:
    if not secret:
        return "(vazio)"
    if len(secret) < 10:
        return secret[:2] + "***"
    return f"{secret[:4]}...{secret[-4:]}"


def _ok(label: str, result: object) -> bool:
    print(f"{label} {json.dumps(result, indent=2, ensure_ascii=False, default=str)}")
    if isinstance(result, dict) and result.get("success") is False:
        return False
    return True


class NuvemTuya:
    def __init__(self, region: str, api_key: str, api_secret: str, device_id: str | None):
        import tinytuya

        self.cloud = tinytuya.Cloud(
            apiRegion=region, apiKey=api_key, apiSecret=api_secret, apiDeviceID=device_id
        )
        self.device_id = device_id

    def resolver_dispositivo(self) -> str:
        """Se não veio TUYA_DEVICE_ID, pega o primeiro da conta."""
        if self.device_id:
            return self.device_id
        devices = self.cloud.getdevices() or []
        if not devices:
            sys.exit("[ERRO] a conta não retornou nenhum dispositivo (conta vinculada ao app?)")
        self.device_id = devices[0].get("id")
        print(f"[INFO] usando o primeiro dispositivo da conta: {devices[0].get('name')} ({self.device_id})")
        return self.device_id

    def listar(self, show_keys: bool) -> None:
        devices = self.cloud.getdevices() or []
        print(f"[LISTA] {len(devices)} dispositivo(s) na conta:\n")
        for d in devices:
            key = d.get("key") if show_keys else mask(d.get("key"))
            print(f"- nome       : {d.get('name')}")
            print(f"  id         : {d.get('id')}   (category: {d.get('category')})")
            print(f"  produto    : {d.get('product_name')}  mac: {d.get('mac')}")
            print(f"  online     : {d.get('online')}   ip: {d.get('ip') or '(sem IP -> não está na LAN)'}")
            print(f"  protocolo  : {d.get('version')}")
            print(f"  local_key  : {key}")
            print()
        if not show_keys:
            print("[DICA] rode com --show-keys para ver a local_key completa (NÃO cole em lugar público).")

    def salvar_local(self, caminho: str) -> None:
        """Grava o que o controle local precisa (arquivo ignorado pelo git)."""
        did = self.resolver_dispositivo()
        devices = {d.get("id"): d for d in (self.cloud.getdevices() or [])}
        d = devices.get(did, {})
        os.makedirs(os.path.dirname(caminho) or ".", exist_ok=True)
        with open(caminho, "w", encoding="utf-8") as fh:
            json.dump(
                {
                    "device_id": did,
                    "local_key": d.get("key"),
                    "ip": d.get("ip") or None,
                    "version": d.get("version"),
                    "name": d.get("name"),
                },
                fh,
                indent=2,
                ensure_ascii=False,
            )
        print(f"[OK] salvo em {caminho} (confira se está no .gitignore: {mask(d.get('key'))})")


def escalar(percentual: int, spec: dict) -> int:
    """Converte 0-100% para a faixa nativa do data point (ex.: 10..1000)."""
    minimo = int(spec.get("min", 10) or 10)
    maximo = int(spec.get("max", 1000) or 1000)
    return int(minimo + (maximo - minimo) * max(0, min(100, percentual)) / 100)


def main() -> None:
    parser = argparse.ArgumentParser(description="Sonda/controle da lâmpada Tuya pela nuvem (TinyTuya Cloud)")
    parser.add_argument("--list", action="store_true", help="lista os dispositivos da conta (IP, protocolo, local_key)")
    parser.add_argument("--show-keys", action="store_true", help="mostra a local_key completa na listagem")
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--functions", action="store_true", help="mostra os dp codes aceitos pela nuvem")
    parser.add_argument("--on", action="store_true")
    parser.add_argument("--off", action="store_true")
    parser.add_argument("--brightness", type=int, help="1 a 100 (%%)")
    parser.add_argument("--temp", type=int, help="0 (quente) a 100 (fria)")
    parser.add_argument("--color", help="R,G,B (ex.: 255,0,0)")
    parser.add_argument("--save-local", nargs="?", const="config/devices.local.json", help="grava device_id/local_key/ip/versão")
    parser.add_argument("--device-id", default=os.environ.get("TUYA_DEVICE_ID"))
    parser.add_argument("--region", default=os.environ.get("TUYA_API_REGION", "us"))
    args = parser.parse_args()

    api_key = os.environ.get("TUYA_API_KEY")
    api_secret = os.environ.get("TUYA_API_SECRET")
    if not api_key or not api_secret:
        sys.exit("[ERRO] defina TUYA_API_KEY (Access ID) e TUYA_API_SECRET (Access Secret)")

    # Cloud faz polling de https; nada aqui depende de BLE.
    nuvem = NuvemTuya(args.region, api_key, api_secret, args.device_id)

    if args.list:
        nuvem.listar(args.show_keys)
    if args.save_local:
        nuvem.salvar_local(args.save_local)

    acoes = [args.status, args.functions, args.on, args.off, args.brightness is not None, args.temp is not None, args.color]
    if not any(acoes):
        if not (args.list or args.save_local):
            print("[DICA] nada a fazer. Use --list, --status, --functions, --on/--off, --brightness, --temp, --color.")
        return

    did = nuvem.resolver_dispositivo()
    funcoes = nuvem.cloud.getfunctions(did) or []
    por_code = {f.get("code"): f for f in funcoes}

    def spec(code: str) -> dict:
        bruto = (por_code.get(code) or {}).get("values")
        try:
            return json.loads(bruto) if bruto else {}
        except (TypeError, ValueError):
            return {}

    if args.functions:
        print(f"[FUNÇÕES] {did} — dp codes aceitos pela nuvem:")
        for f in funcoes:
            print(f"  {f.get('code'):<20} tipo={f.get('type')}  valores={f.get('values')}")

    if args.status:
        _ok("[STATUS]", nuvem.cloud.getstatus(did))

    comandos: list[dict] = []
    if args.on:
        comandos.append({"code": "switch_led", "value": True})
    if args.off:
        comandos.append({"code": "switch_led", "value": False})
    if args.brightness is not None:
        comandos.append({"code": "brightness", "value": escalar(args.brightness, spec("brightness"))})
    if args.temp is not None:
        comandos.append({"code": "temp_value", "value": escalar(args.temp, spec("temp_value"))})
    if args.color:
        r, g, b = (int(v) for v in args.color.split(","))
        h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        comandos.append({"code": "work_mode", "value": "colour"})
        comandos.append({"code": "colour_data", "value": json.dumps({"h": int(h * 360), "s": int(s * 255), "v": int(v * 255)})})

    if comandos:
        print(f"[ENVIANDO] {json.dumps(comandos, ensure_ascii=False)}")
        _ok("[RESPOSTA]", nuvem.cloud.sendcommand(did, comandos))


if __name__ == "__main__":
    main()
