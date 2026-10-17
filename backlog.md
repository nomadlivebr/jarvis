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
  - [ ] `npm install @abandonware/noble` na placa (BlueZ já vem no Debian)
  - [ ] Preencher `config/devices.json` (MAC + chave de controle do app Govee)
  - [ ] Validar frames Govee (`goveePowerFrame`/`goveeColorFrame`) contra o modelo real
  - [ ] **Tuya BLE:** protocolo criptografado (local_key extraída do app) — implementar quando decidir o modelo
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
