# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Usuário doméstico em ambiente residencial que necessita de controle centralizado, rápido e sem atrito para iluminação e dispositivos conectados, além de consultas do dia a dia (horário, status, saudações e rotinas) por voz e texto.

## Product Purpose

Oferecer um assistente doméstico inteligente, rápido e esteticamente impecável (estilo J.A.R.V.I.S. / Siri / Apple Intelligence), centralizando o controle da casa e fornecendo respostas imediatas por síntese e reconhecimento de voz em português do Brasil (PT-BR).

## Positioning

Arquitetura híbrida e orientada à autonomia local: opera prioritariamente no hardware doméstico (PC de desenvolvimento e futuro deploy em Rock Pi / Linux ARM local) para automações de baixa latência e privacidade, permitindo expansão e fallback para serviços de inteligência na nuvem quando necessário.

## Operating Context

- Ambiente web responsivo otimizado para desktop, tablets e smart displays residenciais.
- Uso interativo por voz natural (Web Speech API em PT-BR) e interface táctil/teclado através de barra flutuante minimalista.
- Visualização de telemetria de hardware (Rock Pi / SO) e estado de lâmpadas/dispositivos em tempo real.

## Capabilities and Constraints

- **Reconhecimento e Síntese de Voz:** Web Speech API integrada para captura e leitura fluida em português do Brasil (`pt-BR`).
- **Automação Residencial:** Controle de atuadores e lâmpadas locais via rotas de API `/api/command` e telemetria via `/api/status`.
- **Modos de Operação:** Suporte a modo simulado (`mock`) para desenvolvimento rápido e modo nativo para integração direta com a Rock Pi.
- **Privacidade & Resiliência:** Funciona localmente mesmo sem acesso constante à internet para tarefas e automações essenciais.

## Brand Commitments

- Nome: J.A.R.V.I.S. (Home Core).
- Tom de voz: Sofisticado, conciso, prestativo e calmo.
- Identidade: Orbe de energia holográfico fluido, estética dark mode profunda, vidro translúcido fosco (*glassmorphism*), tipografia limpa e foco total no usuário.
- Idioma obrigatório: Português do Brasil (PT-BR).

## Evidence on Hand

- Código fonte ativo em Next.js 16 + React 19 + Tailwind CSS.
- Módulos de hardware e comandos locais implementados em `src/lib/jarvis/`.
- Roteiros e plano de migração para placa Rock Pi em `docs/ROADMAP_ROCKPI.md`.

## Product Principles

1. **Agilidade e Presença Mínima:** A interface deve responder instantaneamente ao toque ou à voz sem sobrecarregar visualmente o ambiente.
2. **Autonomia Local Primeiro:** O núcleo operacional essencial da residência deve responder mesmo desconectado.
3. **Clareza e Precisão:** Cada comando é confirmado com feedback visual fluido (orbe e ondas sonoras) e retorno sonoro claro.
4. **Acabamento Impecável:** A estética deve transmitir elegância futurista, sem parecer um painel técnico cru.
