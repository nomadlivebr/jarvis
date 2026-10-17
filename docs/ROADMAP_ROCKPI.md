# JARVIS — Roadmap Rock Pi

## Fase 1 — DEV no PC (atual)
- [x] Next.js + Tailwind + API `/api/command` + `/api/status`
- [x] Cérebro local por regras PT-BR (`src/lib/jarvis/brain.ts`)
- [x] Hardware mock (`HARDWARE_MODE=mock`)
- [x] Console web + voz (SpeechRecognition + speechSynthesis)
- [ ] Testar: `npm run dev` → http://localhost:3000

## Fase 2 — Preparar Rock Pi
1. Instalar Debian/Ubuntu ARM64 + Node 20 LTS + Git.
2. Clonar projeto, `npm install --omit=dev`, `npm run build`, `npm start`.
3. Rodar como serviço systemd (reinicia sozinho, roda no boot).
4. (Opcional) Ollama ARM para LLM 100% offline: `ollama run llama3.2:1b`.
5. (Opcional) Mosquitto MQTT para integrar relays/sensores.

## Fase 3 — Hardware real
- Trocar `src/lib/jarvis/hardware.ts` para `HARDWARE_MODE=rockpi`.
- Drivers sugeridos:
  - Relés/lâmpadas: GPIO via `onoff` ou MQTT + ESP32/Tasmota.
  - Sensores: DHT22/BME280 via I2C (`i2c-bus`).
  - Voz always-on: microfone USB + Porcupine (wake-word "Jarvis") + Whisper local.
  - Áudio: alto-falante P2/USB + `speaker` ou `mpg123` para TTS.
- Manter interface `listDevices()` / `executeAction()` — o resto do app não muda.

## Comandos de deploy (Rock Pi)
```bash
git clone <seu-repo> jarvis && cd jarvis
npm install --omit=dev
npm run build
HARDWARE_MODE=rockpi npm start -- -p 80
```
