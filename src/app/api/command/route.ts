import { NextResponse } from "next/server";
import { processCommand } from "@/lib/jarvis/brain";
import { saveCommandHistory } from "@/lib/jarvis/db";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const command = String(body.command ?? "").slice(0, 500);
    const history = Array.isArray(body.history) ? body.history : [];
    if (!command.trim()) {
      return NextResponse.json({ error: "Comando vazio." }, { status: 400 });
    }
    const result = await processCommand(command, history);

    // Salva no banco de dados de forma assíncrona (não bloqueia o retorno)
    saveCommandHistory(
      command,
      result.intent,
      result.text,
      process.env.HARDWARE_MODE !== "rockpi"
    ).catch(() => {});

    return NextResponse.json(result);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Falha ao processar comando." }, { status: 500 });
  }
}
