import { NextResponse } from "next/server";
import { getSystemStatus } from "@/lib/jarvis/system";
import { listDevices } from "@/lib/jarvis/hardware";

export async function GET() {
  try {
    const [system, devices] = await Promise.all([
      Promise.resolve(getSystemStatus()),
      listDevices().catch(() => []),
    ]);
    return NextResponse.json({ system, devices });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Falha ao ler status." }, { status: 500 });
  }
}
