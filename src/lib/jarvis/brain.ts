import { executeAction } from "./hardware";
import type { ChatMessage, HardwareAction, JarvisResponse } from "./types";

// Configurações do Ollama (Local na Rock Pi ou Dev)
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:1.5b";

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

// Prompt de personalidade oficial J.A.R.V.I.S (Marvel / Tony Stark)
const JARVIS_SYSTEM_PROMPT = `Você é o J.A.R.V.I.S., a inteligência artificial altamente sofisticada de Tony Stark.
Você atende com elegância britânica, extrema lealdade, precisão técnica e cortesia, tratando o usuário como "senhor" (ou "senhora" se indicado).
Suas respostas são lidas em voz alta pelo sintetizador do aparelho do usuário.

REGRAS DE COMUNICAÇÃO:
1. Seja direto, conciso e natural (máximo 1 a 3 frases).
2. NUNCA utilize markdown (sem asteriscos *, sem cerquilhas #, sem hífens de tópicos -, sem barras /).
3. NUNCA utilize emojis.
4. Fale com naturalidade e calma.

CONTROLE DE DISPOSITIVOS RESIDENCIAIS (TOOL CALLING):
Você tem controle direto dos seguintes dispositivos da casa:
- "luz-sala" (Luz da Sala)
- "luz-quarto" (Luz do Quarto)
- "ventilador" (Ventilador)

Ações possíveis:
- Ligar: "on"
- Desligar: "off"
- Ajustar cor: "on" com params {"r": número, "g": número, "b": número} (ex: vermelho: 255, 0, 0 | azul: 0, 0, 255 | verde: 0, 255, 0 | branco: 255, 255, 255)

Quando o usuário pedir para acender, apagar, ligar, desligar ou trocar cor de algo (ou disser frases como "está escuro na sala", "ligue o ar/ventilador", "apague tudo"):
Responda confirmando no tom elegante do Jarvis e, OBRIGATORIAMENTE no final da resposta, inclua a tag de ação:
[ACTION: {"device": "luz-sala", "action": "on"}]
ou para cores:
[ACTION: {"device": "luz-sala", "action": "on", "params": {"r": 0, "g": 0, "b": 255}}]

Se for uma pergunta geral, curiosidade ou conversa cotidiana, responda com elegância e sabedoria SEM incluir a tag [ACTION].`;

function cleanTextForSpeech(text: string): string {
  return text
    .replace(/\[ACTION:[\s\S]*?\]/gi, "") // Remove tags de ação
    .replace(/[*_#`~>]/g, "") // Remove caracteres markdown
    .replace(/\s+/g, " ")
    .trim();
}

async function askOllama(
  prompt: string,
  history: ChatMessage[] = []
): Promise<{ text: string; action?: { device: string; action: string; params?: any } } | null> {
  try {
    const messages = [
      { role: "system", content: JARVIS_SYSTEM_PROMPT },
      // Mantém as últimas 6 mensagens para contexto de memória
      ...history.slice(-6).map((m) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.content,
      })),
      { role: "user", content: prompt },
    ];

    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages,
        stream: false,
        options: {
          temperature: 0.6,
          num_predict: 180,
        },
      }),
      signal: AbortSignal.timeout(12000), // 12s de timeout
    });

    if (!res.ok) {
      console.warn(`[OLLAMA] Erro HTTP ${res.status} ao consultar ${OLLAMA_URL}`);
      return null;
    }

    const data = await res.json();
    const rawContent = data?.message?.content || "";
    if (!rawContent) return null;

    // Detecta se o Qwen emitiu uma Tool Action [ACTION: {...}]
    let actionData: { device: string; action: string; params?: any } | undefined;
    const actionMatch = rawContent.match(/\[ACTION:\s*(\{[\s\S]*?\})\s*\]/i);
    if (actionMatch) {
      try {
        actionData = JSON.parse(actionMatch[1]);
      } catch (err) {
        console.warn("[OLLAMA] Falha ao fazer parse da action do modelo:", actionMatch[1]);
      }
    }

    const cleanSpeech = cleanTextForSpeech(rawContent);
    return {
      text: cleanSpeech || "Às suas ordens, senhor.",
      action: actionData,
    };
  } catch (err) {
    console.warn(`[OLLAMA] Não foi possível conectar ao Ollama (${OLLAMA_URL}):`, (err as Error).message);
    return null;
  }
}

export async function processCommand(
  raw: string,
  history: ChatMessage[] = []
): Promise<JarvisResponse> {
  const text = raw.trim();
  const n = norm(text);
  const timestamp = new Date().toISOString();

  const reply = (
    intent: string,
    responseText: string,
    actions: JarvisResponse["actions"] = []
  ): JarvisResponse => ({
    text: responseText,
    intent,
    actions,
    speak: true,
    timestamp,
  });

  // 1. Horas e Data rápidas (resposta instantânea sem latência)
  if (n.includes("que horas") || n.includes("hora atual")) {
    const hora = new Date().toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
    return reply("horas", `Agora são exatamente ${hora}, senhor.`);
  }

  if (n.includes("que dia") || n.includes("data de hoje")) {
    const data = new Date().toLocaleDateString("pt-BR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    return reply("data", `Hoje é ${data}, senhor.`);
  }

  // 2. Consulta à IA Qwen no Ollama (com memória e Tool Calling)
  const ollamaResult = await askOllama(text, history);

  if (ollamaResult) {
    const actionsTaken: HardwareAction[] = [];

    // Executa a ação física se o Jarvis tiver decidido acionar hardware
    if (ollamaResult.action && ollamaResult.action.device) {
      const act: HardwareAction = {
        device: ollamaResult.action.device,
        action: ollamaResult.action.action || "on",
        params: ollamaResult.action.params,
        simulated: process.env.HARDWARE_MODE !== "rockpi",
      };

      try {
        await executeAction(act);
        actionsTaken.push(act);
      } catch (err) {
        console.error("[HARDWARE] Erro ao executar ação via IA:", err);
      }
    }

    return reply("ia-qwen", ollamaResult.text, actionsTaken);
  }

  // 3. Fallback de regras locais (se o Ollama estiver inicializando ou offline)
  if (/^(ola|oi|bom dia|boa tarde|boa noite|jarvis)\b/.test(n)) {
    const hour = new Date().getHours();
    const periodo = hour < 12 ? "bom dia" : hour < 18 ? "boa tarde" : "boa noite";
    return reply("saudacao", `${periodo}, senhor. Sistemas online. Em que posso ajudar?`);
  }

  // Fallback rápido de iluminação por regex caso o Ollama esteja offline
  const lightMatch = n.match(/(ligar|acender|apagar|desligar)\s+(luz|ventilador|lampada)?\s*(da|do|de)?\s*(sala|quarto|cozinha|casa|ventilador)?/);
  if (lightMatch) {
    const verb = lightMatch[1];
    const room = lightMatch[5] || "sala";
    const on = verb === "ligar" || verb === "acender";
    const action = on ? "on" : "off";

    let device = "luz-sala";
    if (room.includes("quarto")) device = "luz-quarto";
    else if (room.includes("ventilador")) device = "ventilador";

    const updated = await executeAction({
      device,
      action,
      simulated: process.env.HARDWARE_MODE !== "rockpi",
    });

    return reply(
      "controle-luz",
      updated
        ? `${updated.name} ${on ? "ligada" : "desligada"}, senhor.`
        : `Dispositivo ${device} não encontrado.`,
      [{ device, action, simulated: process.env.HARDWARE_MODE !== "rockpi" }]
    );
  }

  if (n.includes("status") || n.includes("sistema")) {
    return reply(
      "status",
      "Todos os sistemas operacionais, senhor. Núcleo neural aguardando conexão do Ollama."
    );
  }

  return reply(
    "fallback",
    `Às suas ordens, senhor. Não obtive resposta do núcleo neural Qwen no momento, mas os sistemas locais permanecem ativos.`
  );
}
