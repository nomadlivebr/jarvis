# Lâmpada Tuya BLE — protocolo, evidências e controle local

> Documento gerado a partir da análise estática do APK oficial (`com.tuya.smart`
> 7.11.4) feita com **REA + JADX**, cruzada com o comportamento do pacote
> `tuya-ble-sdk` 0.1.3. Serve para o Jarvis falar com a lâmpada sem nuvem.

## 1. O que a lâmpada é (e o que ela não é)

- **Tuya BLE pura** (`device_id = eb2063v1wmphf3wu`, categoria `dj`).
- Não responde na LAN, não aparece no TinyTuya e a nuvem **não** expõe controle
  para dispositivo só-BLE (só serve para obter `device_id` / `local_key` / `uuid`).
- Portanto: **GATT direto + handshake cifrado**. Nada de MQTT, TCP 6668 ou cloud.

> Correção importante: o APK que estava em `Documents/.../tuya/tuyasmart.apk` era o
> **Aptoide 9.22.5.3** (loja de apps), não o Tuya. O APK correto já estava em
> `C:\Users\thiago.bahia\rea-targets\tuya\com.tuya.smart.apk` (+ split de nativas
> `com.tuya.smart.s1.apk`).

## 2. Evidências (REA)

Comandos executados (REA 6.5.0 + JADX headless 0.7.1, JDK 21):

```powershell
rea inspect-android-package com.tuya.smart.apk          # 78.129 classes, 7.11.4
rea search-android-classes  com.tuya.smart.apk BleDevice
rea inspect-android-class   com.tuya.smart.apk com.thingclips.sdk.ble.core.protocol.api.CommonConstant
rea inspect-android-class   com.tuya.smart.apk com.thingclips.sdk.ble.core.manager.NormalBleConnectManager
```

O que foi observado:

| Evidência | Fonte |
|---|---|
| UUIDs `00002b10-...` (notify) e `00002b11-...` (write) | strings do `classes14.dex` |
| Camada de protocolo `com.thingclips.sdk.ble.core.*` | inventário de classes |
| Pacotes `SecurityAuth1Rep/2/3`, `ECDHRep`, `PairRep`, `DpsSendRep`, `DeviceInfoRep` | `core/packet/bean` |
| `libBleLib.so` exporta `madeSessionKey`, `getNormalRequestData`, `getCommandRequestData`, `parseDataRecived`, `parseKLVData`, `crc4otaPackage` | símbolos do split `s1` (arm64-v8a) |
| BouncyCastle + `AES/GCM/NoPadding`, `AES/CBC/*`, `secp256r1`, `HmacSHA256` presentes no APK | strings do dex (usados por vários SDKs Tuya) |

Conclusão sustentada: o app usa **GATT com frames cifrados e chave derivada da
`local_key`** — exatamente o que o `tuya-ble-sdk` implementa. O `libBleLib.so` só
monta/parseia frames e deriva a chave de sessão (`madeSessionKey`).

## 3. Protocolo no fio

```
Serviço GATT : 0000a201-0000-1000-8000-00805f9b34fb
Notificação  : 00002b10-0000-1000-8000-00805f9b34fb
Escrita      : 00002b11-0000-1000-8000-00805f9b34fb  (write without response)
MTU útil     : 20 bytes por fragmento
```

Frame em claro (tudo big-endian):

```
seq:u32 | response_to:u32 | code:u16 | len:u16 | data[len] | crc16:u16 | zeros até múltiplo de 16
```

Payload no ar:

```
security_flag:u8 | iv:16 | AES-128-CBC(key, iv, frame_em_claro)
```

- `crc16` = CRC-16/MODBUS (poly 0xA001, init 0xFFFF).
- Chaves: `login_key = MD5(local_key[0:6])`; `session_key = MD5(local_key[0:6] + srand)`.
- `security_flag`: `0x01` auth key, `0x04` login key, `0x05` session key.
- Fragmentação: `varint(index)` + (no primeiro) `varint(total_len)` + `protocol_version << 4`.

Códigos usados no controle:

| code | sentido | uso |
|---|---|---|
| `0x0000` | app → dev | pedir info do dispositivo (início do handshake) |
| `0x0001` | app → dev | pareamento (envia `uuid` + 6 chars da key + `device_id`) |
| `0x0002` | app → dev | **enviar datapoints** (liga/desliga, cor, brilho…) |
| `0x0003` | app → dev | pedir status |
| `0x8001/0x8003` | dev → app | relatório de datapoints (com/sem timestamp) |

Datapoint (leitura e escrita usam o mesmo formato):

```
id:u8 | tipo:u8 | tamanho:u8 | valor[n]
```

Tipos: `0` raw, `1` bool, `2` value (4 bytes), `3` string, `4` enum (1 byte), `5` bitmap.

DPs usuais de lâmpada (`dj`): `20` power (bool), `21` work_mode (enum: 0 branco,
1 cor, 2 cena, 3 música), `22` bright_value (10–1000), `23` temp_value (0–1000),
`24` colour_data (string `{"h":0-360,"s":0-1000,"v":0-1000}`).

## 4. O que faltava no SDK (e foi implementado aqui)

O `tuya-ble-sdk` 0.1.3 **só lê** datapoints (`async_read_data_points`). Sem
escrita não há controle — daí a impressão de "não existe possibilidade".

`scripts/tuya-ble-ctl.py` reaproveita conexão/handshake/chaves do SDK e adiciona o
comando `0x0002`:

```python
records = [(20, DP_BOOLEAN, 1), (22, DP_VALUE, 400)]   # liga + brilho 40%
payload = build_dp_payload(records)                    # 14 01 01 01 16 02 04 00 00 01 90
Frame(seq, 0, 0x0002, payload).encode(session_key, 0x05)
```

O caminho criptográfico foi validado localmente (encode → fragmentos ≤ 20 bytes →
decode → payload idêntico), sem precisar da lâmpada.

## 5. Como usar

Pré-requisitos já presentes nesta máquina: `~/tuya-ble/.venv` (Python 3.12 +
`bleak` + `tuya-ble-sdk`). No Windows o BLE vai por WinRT, sem BlueZ.

```powershell
$py = "$HOME\tuya-ble\.venv\Scripts\python.exe"

& $py scripts/tuya-ble-ctl.py scan          # lista dispositivos Tuya por perto
& $py scripts/tuya-ble-ctl.py read          # handshake + datapoints atuais
& $py scripts/tuya-ble-ctl.py on
& $py scripts/tuya-ble-ctl.py off
& $py scripts/tuya-ble-ctl.py brightness 40
& $py scripts/tuya-ble-ctl.py temp 80       # 0 = quente, 100 = fria
& $py scripts/tuya-ble-ctl.py color 255,80,0
& $py scripts/tuya-ble-ctl.py set --dp 20 --type bool --value 1
```

Credenciais: `config/devices.local.json` (gitignored) ou
`TUYA_BLE_DEVICE_ID` / `TUYA_BLE_LOCAL_KEY` / `TUYA_BLE_UUID`.
Se o `uuid` ficar vazio, ele é descoberto no anúncio BLE (o SDK decifra o UUID
com o product-id bruto).

Pelo Jarvis (PC), sem mudar o resto do hardware:

```powershell
$env:BLE_ENABLED = "1"
npm run dev
# "ligar luz da sala" -> hardware.ts -> ble.ts -> tuyaBle.ts -> tuya-ble-ctl.py
```

Configuração (já criada):

- `config/devices.json`: dispositivo `luz-sala` com `protocol: "tuya_ble"` e MAC.
- `config/devices.local.json`: `deviceId` + `localKey` (não versionado).

## 6. Limites conhecidos

- **Rock Pi**: BlueZ 5.53 < 5.55 (mínimo do `bleak`) → o BLE falha na placa.
  Opções: controlar a lâmpada pelo PC (WinRT), ou compilar BlueZ ≥ 5.55 /
  subir para Ubuntu 22.04+.
- O endereço BLE pode ser **aleatório/rotativo**; por isso a descoberta também
  casa por `uuid` do anúncio, não só por MAC.
- Cada comando abre uma sessão completa (connect → handshake → 1 frame →
  disconnect): ~3–8 s. É o padrão de dispositivo a bateria.
- O `read` confirma os IDs reais dos DPs. Se o modelo não usar `20/22/23/24`,
  ajuste com `--dp-power/--dp-bright/--dp-temp/--dp-colour` ou use `set --dp`.

## 7. Segurança

- A `local_key` dá controle total do dispositivo: manter apenas em
  `devices.local.json` / variáveis de ambiente.
- A `local_key` já circulou em scripts locais (`~/tuya-ble/try_keys.py`).
  Recomendado remover do aparelho / re-vincular para gerar outra.
- Se o projeto IoT da Tuya foi usado, regenerar o **Access Secret** no painel.

## 8. Estado atual (2026-10-24): a rota GATT não vale para este modelo

As seções 1–6 descrevem o protocolo **GATT** da Tuya (serviço `0xA201`,
handshake, frames cifrados). Ele está implementado e validado criptograficamente,
mas **esta lâmpada não aceita conexão**: em todas as capturas (inclusive em modo
pareamento) o anúncio é `ADV_NONCONN_IND` (tipo 3), e o WinRT devolve
`device = None` ao tentar conectar. Consequência: `tuya-ble-ctl.py` e
`tuyaBle.ts` ficam no repositório como referência para outros modelos Tuya BLE,
mas **não controlam a `luz-sala`**.

O canal real desta lâmpada é **broadcast cifrado** (Tuya Beacon), sem conexão:

```
pacote de 26 bytes:  header[9] | XXTEA(pt16, chave)[16] | crc[1]
  lampada : 0b 00 05 80 00 00 | sn(2) | cmd(1)   (muda de forma apos o pareamento)
  controle: 0b 7f e9 00 05 04 | ctr(2) | cmd(1)  (celular, endereco rotativo)
```

- **Cifra:** XXTEA big-endian, delta `0x9E3779B9`, `6 + 52/n` rodadas.
- **Plaintext:** `seed12` (`012345678998765432102314`) + cauda de MAC/sn/cmd;
  os parâmetros (DPs) sobrescrevem o início do seed.
- **Checksum (resolvido):** `CRC-8 poly 0x07, init 0x00, xorout 0x83` sobre os
  bytes `[1:25]` — validado em 11 pacotes reais (lâmpada e celular).
- **Contador e `cmd` vão em claro** e **fora** da cifra (o mesmo bloco cifrado
  aparece com contadores diferentes) → o contador pode ser incrementado sem
  quebrar o pacote.

**Chave:** é uma `pairKey` **por dispositivo**, entregue no pareamento
(`PairKeyResultBean(mac, pairKey)`); nem a `local_key` da nuvem nem a chave
global do APK decifram os pacotes (testado em 65 amostras). Faltam dois caminhos:
capturar o pareamento com o log HCI ligado, ou **replay** de pacotes já
capturados (o CRC e o formato permitem remontar o anúncio).

## 9. Ferramentas de investigação (fora do repo)

Em `~/tuya-ble` (sandbox): `capture_actions.py` (escuta os pacotes do celular),
`watch_lamp.py`, `FINDINGS.md` (protocolo completo) e `app_packets.txt`
(65 pacotes reais capturados do app, úteis para o sweep de replay).
