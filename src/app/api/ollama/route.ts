import { NextResponse } from "next/server";

// Saúde do Ollama — GET /api/ollama
// Testa conexão, lista modelos instalados e confere o modelo configurado.

const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:1.5b";

export async function GET() {
  const t0 = Date.now();
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return NextResponse.json({
        reachable: false,
        error: `HTTP ${res.status}`,
        url: OLLAMA_URL,
        configuredModel: OLLAMA_MODEL,
        latencyMs: Date.now() - t0,
      });
    }
    const data = await res.json();
    const models: string[] = (data?.models ?? []).map((m: any) => m.name);
    return NextResponse.json({
      reachable: true,
      url: OLLAMA_URL,
      configuredModel: OLLAMA_MODEL,
      configuredModelInstalled: models.some(
        (m) => m === OLLAMA_MODEL || m.split(":")[0] === OLLAMA_MODEL.split(":")[0]
      ),
      models,
      latencyMs: Date.now() - t0,
    });
  } catch (err: any) {
    return NextResponse.json({
      reachable: false,
      error: err?.message ?? "falha de conexão",
      url: OLLAMA_URL,
      configuredModel: OLLAMA_MODEL,
      latencyMs: Date.now() - t0,
    });
  }
}
