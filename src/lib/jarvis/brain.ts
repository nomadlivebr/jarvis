import { executeAction } from "./hardware";
import type { ChatMessage, HardwareAction, JarvisResponse } from "./types";

// Configurações do Ollama (Local na Rock Pi ou Dev)
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:1.5b";
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 45000);
const OLLAMA_NUM_PREDICT = Number(process.env.OLLAMA_NUM_PREDICT || 45);

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

// Prompt enxuto de propósito: na RK3399 a avaliação do prompt roda a ~7 tok/s,
// então cada token custa ~140ms de espera. ~60 tokens ≈ 9s na primeira chamada.
const JARVIS_SYSTEM_PROMPT = `Você é o J.A.R.V.I.S., assistente de Tony Stark. Responda em português do Brasil, no máximo 2 frases curtas, sem markdown ou emojis. Chame o usuário de "senhor". Dispositivos: luz-sala, luz-quarto, ventilador. Para acionar, anexe ao final: [ACTION: {"device": "luz-sala", "action": "on"}]`;

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
  const t0 = Date.now();
  console.log(`[OLLAMA] >> modelo=${OLLAMA_MODEL} url=${OLLAMA_URL} prompt="${prompt.slice(0, 80)}"`);
  try {
    const messages = [
      { role: "system", content: JARVIS_SYSTEM_PROMPT },
      // Histórico curto: cada mensagem extra é lida pela CPU a ~7 tok/s
      ...history.slice(-2).map((m) => ({
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
          temperature: 0.3,
          num_predict: OLLAMA_NUM_PREDICT,
          num_thread: 4,   // Usa as threads da Rock Pi
        },
      }),
      signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
    });

    if (!res.ok) {
      lastOllamaError = `HTTP ${res.status} de ${OLLAMA_URL}`;
      console.warn(`[OLLAMA] !! HTTP ${res.status} (${Date.now() - t0}ms) ao consultar ${OLLAMA_URL}`);
      return null;
    }

    const data = await res.json();
    const rawContent = data?.message?.content || "";
    if (!rawContent) {
      lastOllamaError = "resposta vazia do modelo";
      console.warn(`[OLLAMA] !! resposta vazia (${Date.now() - t0}ms)`);
      return null;
    }

    let actionData: { device: string; action: string; params?: any } | undefined;
    const actionMatch = rawContent.match(/\[ACTION:\s*(\{[\s\S]*?\})\s*\]/i);
    if (actionMatch) {
      try {
        actionData = JSON.parse(actionMatch[1]);
      } catch (err) {
        console.warn("[OLLAMA] Falha no parse da action:", actionMatch[1]);
      }
    }

    const cleanSpeech = cleanTextForSpeech(rawContent);
    lastOllamaError = null;
    console.log(
      `[OLLAMA] << ok em ${Date.now() - t0}ms | "${cleanSpeech.slice(0, 80)}"${actionData ? ` | ACTION=${JSON.stringify(actionData)}` : ""}`
    );
    return {
      text: cleanSpeech || "Às suas ordens, senhor.",
      action: actionData,
    };
  } catch (err) {
    const msg = (err as Error).message || String(err);
    lastOllamaError = msg;
    console.warn(`[OLLAMA] !! falha em ${Date.now() - t0}ms (${OLLAMA_URL}): ${msg}`);
    return null;
  }
}

// Último erro do Ollama — usado na mensagem de fallback para o usuário ver o motivo real
export let lastOllamaError: string | null = null;

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

  // 1. Respostas Instantâneas de Automação (0.01s - sem latência)
  // Horas
  if (n.includes("que horas") || n.includes("hora atual")) {
    const hora = new Date().toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
    return reply("horas", `Agora são exatamente ${hora}, senhor.`);
  }

  // Data
  if (n.includes("que dia") || n.includes("data de hoje")) {
    const data = new Date().toLocaleDateString("pt-BR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    return reply("data", `Hoje é ${data}, senhor.`);
  }

  // Saudações rápidas
  if (/^(ola|oi|bom dia|boa tarde|boa noite|jarvis)\b/.test(n) && n.length < 25) {
    const hour = new Date().getHours();
    const periodo = hour < 12 ? "bom dia" : hour < 18 ? "boa tarde" : "boa noite";
    return reply("saudacao", `${periodo}, senhor. Sistemas online. Em que posso ser útil?`);
  }

  // Controle de luz e ventilador imediato
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
        : `Dispositivo ${device} ajustado, senhor.`,
      [{ device, action, simulated: process.env.HARDWARE_MODE !== "rockpi" }]
    );
  }

  // Status
  if (n.includes("status") || n.includes("sistema") || n.includes("como voce esta")) {
    return reply(
      "status",
      "Todos os sistemas operacionais, senhor. Núcleo neural ativo e pronto para suas ordens."
    );
  }

  // 2. Para qualquer outra pergunta ou conversa geral, consulta o Qwen no Ollama (rápido com 45 tokens)
  console.log(`[BRAIN] "${text.slice(0, 80)}" → sem regra local, consultando Ollama…`);
  const ollamaResult = await askOllama(text, history);

  if (ollamaResult) {
    const actionsTaken: HardwareAction[] = [];

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
        console.error("[HARDWARE] Erro:", err);
      }
    }

    return reply("ia-qwen", ollamaResult.text, actionsTaken);
  }

  return reply(
    "fallback",
    `Às suas ordens, senhor, mas o núcleo neural não respondeu (${lastOllamaError ?? "motivo desconhecido"}). Os controles locais estão ativos.`
  );
}
