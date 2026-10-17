#!/usr/bin/env python3
"""
Sonda/controle da lâmpada Tuya pela **API de nuvem** (TinyTuya Cloud).

Por que isso é útil mesmo se o controle final for local:
  A nuvem devolve, para cada dispositivo, a **local_key**, o **uuid**, o
  **last_ip** e a **versão do protocolo** — ou seja, a nuvem serve para
  *descobrir* o que o controle local precisa. Depois o controle pode ser
  100% local (sem internet).

LIMITE IMPORTANTE:
  A nuvem só alcança dispositivo **online por Wi-Fi** (ou atrás de um
  gateway). Lâmpada só-BLE aparece sem `last_ip` e sem `version`, e o
  `sendcommand` falha — nesse caso só o `tuya-ble-sdk` resolve.

Credenciais (Access ID / Access Secret do projeto em iot.tuya.com → Cloud):
    export TUYA_API_KEY="..."       # Access ID
    export TUYA_API_SECRET="..."    # Access Secret
    export TUYA_API_REGION="us"     # us | eu | cn | in (Brasil = us)
    export TUYA_DEVICE_ID="..."     # opcional, senão usa o 1º da conta

Uso:
    python3 scripts/tuya-cloud-probe.py --list
    python3 scripts/tuya-cloud-probe.py --list --show-keys
    python3 scripts/tuya-cloud-probe.py --raw            # JSON cru da nuvem
    python3 scripts/tuya-cloud-probe.py --connect        # online/offline no ponto de vista da nuvem
    python3 scripts/tuya-cloud-probe.py --status
    python3 scripts/tuya-cloud-probe.py --functions
    python3 scripts/tuya-cloud-probe.py --on | --off
    python3 scripts/tuya-cloud-probe.py --brightness 50
    python3 scripts/tuya-cloud-probe.py --temp 80
    python3 scripts/tuya-cloud-probe.py --color 255,0,0
"""

from __future__ import annotations

import argparse
import colorsys
import json
import os
import sys

# Campos que o TinyTuya preserva em getdevices() (filter_devices em Cloud.py).
# Note que 'online' e 'ip' NÃO estão aqui — para isso use --connect e --raw.
CAMPOS_UTEIS = ("id", "name", "category", "product_name", "product_id", "model", "uuid", "mac",
                "sn", "version", "last_ip", "node_id", "gateway_id", "sub", "biz_type")


def mask(secret: str | None) -> str:
    if not secret:
        return "(vazio)"
    if len(secret) < 10:
        return secret[:2] + "***"
    return f"{secret[:4]}...{secret[-4:]}"


def unwrap(resposta: object) -> tuple[object | None, dict | None]:
    """
    tinytuya.Cloud._getdevice devolve o envelope inteiro ({'result':..., 'success':...})
    ou um error_json ({'Error':..., 'Err':...}) quando a nuvem recusa.
    """
    if isinstance(resposta, dict) and (resposta.get("success") is False or "Error" in resposta):
        return None, resposta
    if isinstance(resposta, dict) and "result" in resposta:
        return resposta["result"], None
    return resposta, None


class NuvemTuya:
    def __init__(self, region: str, api_key: str, api_secret: str, device_id: str | None):
        import tinytuya

        self.cloud = tinytuya.Cloud(
            apiRegion=region, apiKey=api_key, apiSecret=api_secret, apiDeviceID=device_id
        )
        self.device_id = device_id

    def resolver_dispositivo(self) -> str:
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
            print(f"- nome       : {d.get('name')}")
            print(f"  id         : {d.get('id')}")
            print(f"  categoria  : {d.get('category')}   produto: {d.get('product_name')} ({d.get('product_id')})")
            print(f"  uuid       : {d.get('uuid') or '(ausente)'}")
            print(f"  mac        : {d.get('mac') or '(ausente)'}")
            print(f"  protocolo  : {d.get('version') or '(ausente)'}")
            print(f"  last_ip    : {d.get('last_ip') or '(ausente)'}")
            print(f"  local_key  : {d.get('key') if show_keys else mask(d.get('key'))}")
            if not d.get("version") and not d.get("last_ip"):
                print("  => SEM versão de protocolo e SEM last_ip: sem presença na LAN (forte indício de só-BLE)")
            print()
        if not show_keys:
            print("[DICA] --show-keys mostra a chave completa (NÃO cole em lugar público).")
        print("[NOTA] 'online'/'ip' não vêm neste endpoint do TinyTuya — veja --connect e --raw.")

    def raw(self) -> None:
        dados = self.cloud.getdevices(verbose=True)
        print(json.dumps(dados, indent=2, ensure_ascii=False, default=str))

    def salvar_local(self, caminho: str) -> None:
        did = self.resolver_dispositivo()
        devices = {d.get("id"): d for d in (self.cloud.getdevices() or [])}
        d = devices.get(did, {})
        os.makedirs(os.path.dirname(caminho) or ".", exist_ok=True)
        with open(caminho, "w", encoding="utf-8") as fh:
            json.dump(
                {
                    "device_id": did,
                    "local_key": d.get("key"),
                    "uuid": d.get("uuid"),
                    "ip": d.get("last_ip") or None,
                    "version": d.get("version"),
                    "name": d.get("name"),
                },
                fh,
                indent=2,
                ensure_ascii=False,
            )
        print(f"[OK] salvo em {caminho} — confira se está no .gitignore (chave: {mask(d.get('key'))})")


def escalar(percentual: int, spec: dict) -> int:
    """Converte 0-100% para a faixa nativa do data point (ex.: 10..1000)."""
    minimo = int(spec.get("min", 10) or 10)
    maximo = int(spec.get("max", 1000) or 1000)
    return int(minimo + (maximo - minimo) * max(0, min(100, percentual)) / 100)


def main() -> None:
    parser = argparse.ArgumentParser(description="Sonda/controle da lâmpada Tuya pela nuvem (TinyTuya Cloud)")
    parser.add_argument("--list", action="store_true", help="lista os dispositivos da conta")
    parser.add_argument("--show-keys", action="store_true", help="mostra a local_key completa na listagem")
    parser.add_argument("--raw", action="store_true", help="despeja o JSON cru que a nuvem devolve")
    parser.add_argument("--connect", action="store_true", help="online/offline segundo a nuvem")
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--functions", action="store_true", help="dp codes aceitos pela nuvem")
    parser.add_argument("--on", action="store_true")
    parser.add_argument("--off", action="store_true")
    parser.add_argument("--brightness", type=int, help="1 a 100 (%%)")
    parser.add_argument("--temp", type=int, help="0 (quente) a 100 (fria)")
    parser.add_argument("--color", help="R,G,B (ex.: 255,0,0)")
    parser.add_argument("--save-local", nargs="?", const="config/devices.local.json")
    parser.add_argument("--device-id", default=os.environ.get("TUYA_DEVICE_ID"))
    parser.add_argument("--region", default=os.environ.get("TUYA_API_REGION", "us"))
    args = parser.parse_args()

    api_key = os.environ.get("TUYA_API_KEY")
    api_secret = os.environ.get("TUYA_API_SECRET")
    if not api_key or not api_secret:
        sys.exit("[ERRO] defina TUYA_API_KEY (Access ID) e TUYA_API_SECRET (Access Secret)")

    nuvem = NuvemTuya(args.region, api_key, api_secret, args.device_id)

    if args.list:
        nuvem.listar(args.show_keys)
    if args.raw:
        nuvem.raw()
    if args.save_local:
        nuvem.salvar_local(args.save_local)
    if args.connect:
        did = nuvem.resolver_dispositivo()
        estado = nuvem.cloud.getconnectstatus(did)
        print(f"[CONNECT] {did} -> online/status: {estado!r}")
        if estado is False:
            print("  => a nuvem considera o dispositivo OFFLINE: sem Wi-Fi/gateway, ela não tem como falar com ele.")

    acoes = [args.status, args.functions, args.on, args.off, args.brightness is not None, args.temp is not None, args.color]
    if not any(acoes):
        if not (args.list or args.save_local or args.connect or args.raw):
            print("[DICA] nada a fazer. Use --list, --raw, --connect, --status, --functions, --on/--off, --brightness, --temp, --color.")
        return

    did = nuvem.resolver_dispositivo()

    lista_funcoes, erro_funcoes = unwrap(nuvem.cloud.getfunctions(did) or {})
    if erro_funcoes:
        print("[NUVEM RECUSOU] getfunctions ->")
        print(json.dumps(erro_funcoes, indent=2, ensure_ascii=False, default=str))
        funcoes = []
    else:
        funcoes = lista_funcoes if isinstance(lista_funcoes, list) else []
    por_code = {f.get("code"): f for f in funcoes if isinstance(f, dict)}

    def spec(code: str) -> dict:
        bruto = (por_code.get(code) or {}).get("values")
        try:
            return json.loads(bruto) if bruto else {}
        except (TypeError, ValueError):
            return {}

    if args.functions:
        if erro_funcoes:
            print("[FUNÇÕES] a nuvem recusou (veja acima). É isso que explica não dar para controlar por ela.")
        else:
            print(f"[FUNÇÕES] {did} — dp codes aceitos pela nuvem:")
            for f in funcoes:
                print(f"  {f.get('code'):<22} tipo={f.get('type')}  valores={f.get('values')}")

    if args.status:
        resultado, erro = unwrap(nuvem.cloud.getstatus(did) or {})
        if erro:
            print("[STATUS] a nuvem recusou ->")
            print(json.dumps(erro, indent=2, ensure_ascii=False, default=str))
        else:
            print("[STATUS]", json.dumps(resultado, indent=2, ensure_ascii=False, default=str))

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
        resultado, erro = unwrap(nuvem.cloud.sendcommand(did, comandos) or {})
        print("[RESPOSTA]", json.dumps(erro or resultado, indent=2, ensure_ascii=False, default=str))


if __name__ == "__main__":
    main()
