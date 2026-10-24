# J.A.R.V.I.S. — Backlog & Arquitetura

> Assistente local estilo JARVIS para automação residencial.
> **Estratégia:** desenvolver e validar tudo no PC (mock) antes de partir para o hardware da Rock Pi.

## 1. Stack

| Camada      | Tecnologia                              |
| ----------- | --------------------------------------- |
| Frontend    | Next.js 16 (App Router) + React 19     |
| Estilo      | Tailwind CSS v4 + CSS custom (`globals.css`) |
| Linguagem   | TypeScript                              |
| Voz (STT)   | Web Speech API (`SpeechRecognition`)    |
| Voz (TTS)   | Web Speech API (`speechSynthesis`)      |
| Medidor mic | Web Audio API (`AnalyserNode`)          |
| Backend     | Next.js Route Handlers (`/api/*`)       |
| Runtime alvo| Node 20+ na Rock Pi (Debian/ARM64)      |

Sem banco, sem nuvem, sem dependência externa em runtime — roda 100% offline.

## 2. Arquitetura

```
┌─────────────────────────────────────────────────┐
│  UI (Client Components)                         │
│  JarvisMain ─┬─ JarvisOrb (orbe, estados)       │
│              ├─ AudioWaveform (8 barras reativas)│
│              ├─ input texto + mic (STT)          │
│              ├─ drawer voz + StatusPanel         │
│              └─ modal histórico da sessão       │
│  JarvisConsole (console alternativo texto/voz)   │
└──────────────────────┬──────────────────────────┘
                       │ fetch JSON
┌──────────────────────▼──────────────────────────┐
│  API (Route Handlers)                           │
│  POST /api/command → processCommand(texto)      │
│  GET  /api/status  → sistema + dispositivos     │
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────┐
│  Núcleo (src/lib/jarvis/)                       │
│  brain.ts     → intenções PT-BR (regras)         │
│  hardware.ts  → abstração mock | rockpi          │
│  system.ts    → telemetria via node:os           │
│  types.ts     → contratos compartilhados        │
└─────────────────────────────────────────────────┘
```

### Fluxo de um comando

1. Usuário digita ou fala → texto PT-BR.
2. `POST /api/command { command }`.
3. `brain.ts` normaliza (minúsculas, sem acento) e casa intenção:
   `saudacao | horas | data | controle-luz | status | ajuda | desconhecido`.
4. Se for ação física → `hardware.ts → executeAction()` (hoje simula em memória).
5. Resposta `{ text, intent, actions, speak }` volta à UI.
6. UI exibe no card/histórico e fala via `speechSynthesis` (voz calibrável: rate 1.03, pitch 0.94).

### Estados da interface

`idle | listening | processing | speaking` — orbe, waveform e saudação reagem a cada estado; o
nível do microfone (`audioLevel` 0–1) modula a altura das barras em tempo real.

## 3. Estrutura de pastas

```
src/
  app/
    page.tsx              → renderiza <JarvisMain />
    layout.tsx            → metadata + lang pt-BR
    globals.css           → tema, orbe, waveform, mic overlap, glass, scrollbar
    api/command/route.ts  → POST comando
    api/status/route.ts   → GET telemetria + dispositivos
  components/
    JarvisMain.tsx        → tela principal (orbe + entrada + drawers)
    JarvisOrb.tsx         → orbe com estados
    AudioWaveform.tsx     → 8 barras reativas ao áudio
    JarvisConsole.tsx     → console alternativo (texto/voz + quick actions)
    StatusPanel.tsx       → hardware/núcleo + dispositivos da casa
  lib/jarvis/
    brain.ts | hardware.ts | system.ts | types.ts
deploy/jarvis.service     → unit systemd (Rock Pi)
docs/ROADMAP_ROCKPI.md    → plano de deploy
.env / .env.example       → HARDWARE_MODE=mock | rockpi
```

## 4. O que já foi feito

- [x] Projeto Next.js + Tailwind v4 + TypeScript criado e buildando
- [x] Tela principal `JarvisMain` (orbe, saudação por horário, waveform, card de resposta)
- [x] Entrada por texto + voz (STT `pt-BR`) com botão mic sobreposto
- [x] TTS com calibração (seleção de voz, velocidade, timbre, botão testar)
- [x] Medidor de nível do microfone em tempo real (Web Audio API)
- [x] Drawer "Central de Operações" (status + voz) e modal "Histórico de Diálogo"
- [x] Console alternativo `JarvisConsole` com quick actions
- [x] `POST /api/command` + `GET /api/status` funcionais (testados via HTTP)
- [x] Cérebro local por regras PT-BR (7 intenções, fallback `desconhecido`)
- [x] Camada `hardware.ts` com modo `mock` (3 dispositivos simulados) e ponto de troca para `rockpi`
- [x] Telemetria real (`hostname, plataforma, uptime, memória`) via `node:os`
- [x] `.env` + `deploy/jarvis.service` (systemd) prontos
- [x] 14 avisos canônicos do Tailwind corrigidos; 6 `cssConflict` avaliados como falsos positivos e mantidos
- [x] Painel de Diagnóstico de Voz (`VoiceDiagnostics.tsx`) no drawer: mede HTTPS, SpeechRecognition, permissão, captura e TTS no aparelho
- [x] Teste de microfone ao vivo no painel (transcrição mostrada na tela, sem console)
- [x] Voz no celular (Android Chrome) funcionando via tunnel Cloudflare HTTPS

### Notas técnicas — voz no mobile (descobertas 2026-10)
- **Conflito de mic no Android:** `getUserMedia` (medidor de nível) concorrendo com `SpeechRecognition` derrubava o SR em silêncio. Correção: no mobile (pointer coarse/touch), o medidor é desativado e o SR roda sozinho (fluxo idêntico ao teste que funcionava). Commit `339bfc9`.
- **iPhone (Safari) não tem Web Speech API** — reconhecimento impossível no iOS via web. Solução futura: fallback `MediaRecorder` + Whisper local na Rock Pi (mesmo caminho serve para eliminar a dependência do Google no Android).
- Erros de voz aparecem no chat como `[Aviso de Áudio]: ...` (permissão, no-speech, network, audio-capture) e no `console.warn` `[VOZ]`.

### Notas técnicas — BLE na Rock Pi (descobertas 2026-10)
- **`@abandonware/noble` não compila na placa:** Ubuntu 20.04 tem GCC 9; o Node 24 compila módulos nativos com `-std=gnu++20` (GCC 10+) → `g++: error: unrecognized command line option '-std=gnu++20'`. Além disso o npm 12 bloqueia *install scripts* por padrão (`npm install-scripts approve <pkg>`).
- **Solução adotada:** [`node-ble`](https://github.com/chrvadala/node-ble) — fala com o BlueZ via **D-Bus**, sem módulo nativo, sem root obrigatório (BlueZ 5.53 da placa é compatível). É o driver de `src/lib/jarvis/ble.ts`.
- **Sondagem:** `scripts/ble-probe.js` (scan de dispositivos / conexão + enumeração de serviços e características GATT).
- Se `dbus-next` reclamar do opcional nativo `usocket`/`abstract-socket`, é inofensivo: nesse caso ele usa socket Unix normal (caminho padrão do BlueZ).

### Notas técnicas — rota Tuya (nuvem → chave local) — descobertas 2026-10-17
- **O anúncio da lâmpada (`DC:23:53:A6:63:D7`) é proprietário cifrado:** flags `LE General Discoverable` + um blob binário despejado no campo `0x03` (*Complete list of 16-bit Service UUIDs*), que o nRF Connect exibe como UUIDs falsos (`0x0008, 0x8002, 0x1500, 0x02FF…`). Sem nome, sem *manufacturer data*, sem serviço real. Bate exatamente com o que o SDK Tuya descreve: dispositivo **vinculado a uma conta** passa a anunciar um *product id* ofuscado — os bytes ainda decifram o `uuid`, mas não nomeiam o produto.
- **Conclusão:** não é lâmpada BLE genérica (estilo Govee) — é **Tuya BLE** (ponto-a-ponto, GATT + handshake cifrado com `local_key`). Os frames Govee do `ble.ts` nunca vão funcionar nela; o caminho é outro driver.
- **`local_key` NÃO vem da API de compartilhamento:** o [`tuya-local-key`](https://github.com/vineetchoudhary/tuya-local-key) (e o `tuya-device-sharing-sdk` que ele usa) **não retorna `local_key` para dispositivo só-BLE** — está documentado no próprio README: *"Bluetooth-only devices have no local key to display"*. Só aparece `local_key` se o dispositivo estiver atrás de um **gateway**, e nesse caso é a chave do *gateway*, que não autentica conexão BLE direta. Ele continua útil para pegar `device_id`, `uuid`, `category`, `product_id` e a lista de data points.
- **Quem entrega a chave:** [`tuya-ble-sdk`](https://github.com/roquerodrigo/tuya-ble-sdk) (MIT, base do `ha-tuya-ble`) — implementa o protocolo BLE Tuya (handshake, session key, frames cifrados, datapoints) e o `TuyaBleCloudClient(email, password, country_code, region)` loga no **gateway do app móvel** e devolve `device_id` + `local_key` de cada dispositivo da conta.
  - CLI: `tuya-ble scan` (lista dispositivos Tuya BLE por perto com product id e uuid) · `tuya-ble read --address MAC --device-id ID --local-key KEY` (uma sessão, imprime datapoints) · `tuya-ble credentials --email EMAIL --country-code 55`.
  - **Exige Python ≥ 3.12** (a placa tem 3.8 do Ubuntu 20.04) → instalar com `uv` (`curl -LsSf https://astral.sh/uv/install.sh | sh`; `uv init --python 3.12` baixa o 3.12 sem depender do sistema).
  - Status: **alpha** (0.1.3). Pode não interpretar datapoints em forma *signed* (`0x8004`/`0x8005`): nesse caso o `read` **conecta mas não reporta datapoint**.
- **Local-first preservado:** a nuvem é usada **uma única vez** para obter `uuid`/`device_id`/`local_key`. Depois disso o handshake e o controle BLE são 100% offline.
- **Alternativas:** Plataforma IoT Tuya (`iot.tuya.com` → Cloud Project → vincular conta do app via QR) — mesma limitação para só-BLE e acesso a dados limitado no tempo (trial); ou REA/Frida num Android com root.

## 5. Backlog (próximos passos)

### Fase A — Dev no PC
- [x] Camada BLE: `devices.ts` (registro) + `ble.ts` (driver Govee) + intenção de cor no `brain.ts`
- [ ] `git init` + primeiro commit (facilita deploy na Rock Pi via clone/pull)
- [ ] Persistir histórico e calibração de voz em `localStorage`
- [ ] LLM como fallback do `desconhecido` (Ollama local **ou** API nuvem — decidir)
- [ ] Wake-word "Jarvis" always-on (avaliar Porcupine)
- [ ] Testes automatizados do `brain.ts` (intenções PT-BR)

### Fase B — Rock Pi (hardware)
- [ ] Debian/ARM64 + Node 20 LTS + Git na placa
- [ ] `npm install --omit=dev && npm run build && npm start` via `deploy/jarvis.service`
- [ ] BLE:
  - [x] Driver `node-ble` (D-Bus/BlueZ, **sem compilação nativa**) — `npm install node-ble` já vem no `package.json`
  - [ ] Preencher `config/devices.json` (MAC + chave de controle do app Govee)
  - [ ] Validar frames Govee (`goveePowerFrame`/`goveeColorFrame`) contra o modelo real
  - [ ] **Tuya BLE (`DC:23:53:A6:63:D7`):** handshake cifrado — obter `uuid`/`device_id`/`local_key` (ver *rota Tuya* abaixo), provar controle com `tuya-ble read` na placa e só então integrar ao `ble.ts`
- [ ] Implementar drivers restantes em `hardware.ts` (`HARDWARE_MODE=rockpi`):
  - Relés/lâmpadas via GPIO (`onoff`) ou MQTT + ESP32/Tasmota
  - Sensores DHT22/BME280 via I2C (`i2c-bus`)
  - Microfone USB + alto-falante P2/USB (+ Whisper local p/ STT offline)
- [ ] (Opcional) Mosquitto MQTT e Ollama ARM (`llama3.2:1b`) 100% offline

### Referências (tópico `jarvis-ai` — ideias, não integração)
- Likhithsai2580/JARVIS — wake-word + LLM local
- blogminhquy/javis-os — agentes + MCP + WebSocket
- IRISX-AI/IRIS-AI — UX de assistente (Electron)
- open-jarvis/OpenJarvis — framework local-first da Stanford (fallback LLM avançado, médio prazo)
- Govee: protocolo BLE documentado no projeto `govee-bt-hass` (base do `ble.ts`)

## 6. Como rodar

```bash
npm run dev      # dev → http://localhost:3000
npm run build    # valida tipos + build produção
npm start        # produção (após build)
```

## 7. Diagnóstico da lâmpada Tuya (BLE) — 2026-10-17

- **A lâmpada é Tuya BLE pura.** `device_id` = `eb2063v1wmphf3wu`, categoria `dj`, e o `mac` que a nuvem reporta (`DC:23:53:A6:63:D7`) é o **endereço BLE aleatório** visto nos scans. Três vias independentes confirmam: `tinytuya scan` na LAN → **0 dispositivos**; nuvem → `online: false`, sem `last_ip` e sem `version`; e o app a descreve como Bluetooth.
- **A nuvem Tuya não controla essa lâmpada** — não existe caminho até um dispositivo só-BLE. Ela serviu apenas para extrair `device_id`, `local_key` e `uuid`, que é o que o handshake BLE exige.
- **Erro `913`** em `getstatus`/`getfunctions`: API **IoT Core** não autorizada no projeto (aba *Service API → Add API*). `--list`/`--connect` funcionam porque usam *Smart Home Basic Service*.
- **Serviço BLE da Tuya: `0xA201`** (`0000a201-0000-1000-8000-00805f9b34fb`) — é o que o `tuya-ble-sdk` procura no anúncio (`_is_tuya`), e o que a lâmpada precisa anunciar para ser listada pelo `scan` do SDK.
- **Bloqueio na placa: versão do BlueZ.** O `bleak` (motor do `tuya-ble-sdk`) exige **BlueZ ≥ 5.55** — o próprio código faz `raise BleakError("Bleak requires BlueZ >= 5.55.")`. A Rock Pi tem **5.53** (focal), por isso `get_default_adapter` estoura `KeyError: 'Roles'` (o property `Roles` do adapter só existe a partir do 5.55). É a raiz provável também das falhas de `connect` do `node-ble` (`org.bluez.Error.Failed`).
- **Contorno: rodar no PC Windows**, onde o `bleak` usa WinRT e não passa por BlueZ. Projeto criado em `~/tuya-ble` (`uv init --python 3.12`, `uv add "tuya-ble-sdk[cli]"`). Novo utilitário: `scripts/tuya-ble-dump.py` (dumper BLE cru: `service_uuids`, `service_data`, `manufacturer_data` + `parse_advertisement`).
- **Pendente:** com a lâmpada anunciando, rodar `tuya-ble read --address DC:23:53:A6:63:D7 --device-id eb2063v1wmphf3wu --local-key <chave> --uuid <uuid>`; depois decidir entre compilar **BlueZ ≥ 5.55** na placa ou manter o controle em outra máquina.
- **Segurança:** a `local_key` já trafegou fora do devido lugar → não usar `--show-keys` em saídas compartilhadas; o **Access Secret** do projeto precisa ser regenerado no painel da Tuya.

### 7.1. REA no APK + escrita de datapoints — 2026-10-22

- **Alvo corrigido:** o `tuya/tuyasmart.apk` era o **Aptoide 9.22.5.3**, não o Tuya. O APK real já estava em `~/rea-targets/tuya/com.tuya.smart.apk` (7.11.4, 78.129 classes) + split de nativas `com.tuya.smart.s1.apk`.
- **Análise com REA 6.5.0 + JADX 0.7.1** (JDK 21, Windows). Confirmado no artefato: UUIDs `00002b10` (notify) e `00002b11` (write) no dex; camada `com.thingclips.sdk.ble.core.*` com `PairRep`/`SecurityAuth1-3Rep`/`ECDHRep`/`DpsSendRep`; e `libBleLib.so` exportando `madeSessionKey`, `getNormalRequestData`, `getCommandRequestData`, `parseDataRecived`, `parseKLVData`.
- **O que faltava era a escrita:** o `tuya-ble-sdk` 0.1.3 só lê datapoints. `scripts/tuya-ble-ctl.py` adiciona o comando `0x0002` (registros `id|tipo|tamanho|valor`) reaproveitando conexão/handshake/chaves do SDK. Caminho criptográfico validado offline (encode → fragmentos ≤ 20 B → decode).
- **Integração no Jarvis:** `src/lib/jarvis/tuyaBle.ts` (ponte para o script), roteamento em `ble.ts` (`protocol: "tuya_ble"`), `BLE_ENABLED=1` mantém o resto do hardware em mock no PC, e `config/devices.local.json` (gitignored) guarda `deviceId`/`localKey`.
- **Pendente:** rodar `read`/`on` com a lâmpada por perto (ela não estava no rádio durante a sessão) e confirmar os IDs de DP do modelo; se necessário ajustar `--dp-power/--dp-bright/--dp-temp/--dp-colour`.
- **Detalhes do protocolo:** ver `docs/TUYA_BLE.md`.

### 7.2. Rota GATT descartada; broadcast (Beacon) decifrado em parte — 2026-10-24

- **A lâmpada nunca aceita conexão.** Todas as capturas (inclusive em modo pareamento) mostram `ADV_NONCONN_IND` (tipo 3); `WinRT` devolve `device = None`. Logo `tuya-ble-ctl.py`/`tuyaBle.ts` (GATT `0xA201`) ficam só como referência para outros modelos — não controlam a `luz-sala`.
- **Canal real = broadcast cifrado de 26 bytes:** `header[9] + enc[16] + crc[1]`. O celular transmite (`SetExtAdvData`, endereço aleatório rotativo), a lâmpada só anuncia `ADV_NONCONN_IND`.
- **Checksum resolvido e validado em 11 pacotes:** `CRC-8 poly 0x07, init 0x00, xorout 0x83` sobre `pkt[1:25]`.
- **Cifra:** XXTEA big-endian (`delta 0x9E3779B9`, `6 + 52/n`), plaintext `seed12 + mac/sn/cmd`.
- **Contador e `cmd` vão em claro e fora da cifra** (mesmo bloco cifrado com contadores diferentes) → replay é viável, inclusive incrementando o contador.
- **Chave:** `pairKey` por dispositivo, entregue no pareamento. Nem a `local_key` da nuvem nem a chave global do APK decifram (65 amostras testadas). Faltam: capturar o pareamento com o log HCI ligado, ou fazer replay dos pacotes já capturados.
- **Log HCI do MIUI funciona** (`adb bugreport` traz `btsnoop_hci.log`), mas só capturou o que o app transmitiu a partir do momento em que foi ligado — o pareamento ficou de fora.
- **Notas completas / amostras:** `~/tuya-ble/FINDINGS.md` e `~/tuya-ble/app_packets.txt` (65 pacotes do app).
