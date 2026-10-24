// Cliente Home Assistant (REST API).
// Permite ao Jarvis controlar dispositivos já configurados no HA (Tuya, Bluetooth,
// Zigbee...) via serviços, sem reimplementar protocolos. Autenticação por
// Long-Lived Access Token (HA_URL + HA_TOKEN no .env).

const DEFAULT_TIMEOUT_MS = 15_000;

export function haBaseUrl(): string | null {
  const url = process.env.HA_URL?.trim();
  return url ? url.replace(/\/+$/, "") : null;
}

export function haToken(): string | null {
  const token = process.env.HA_TOKEN?.trim();
  return token || null;
}

export function haEnabled(): boolean {
  return Boolean(haBaseUrl() && haToken());
}

async function haFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const base = haBaseUrl();
  const token = haToken();
  if (!base || !token) throw new Error("Home Assistant não configurado (HA_URL/HA_TOKEN).");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    return await fetch(`${base}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export interface HaState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed?: string;
  last_updated?: string;
}

export async function haGetState(entityId: string): Promise<HaState | null> {
  const res = await haFetch(`/api/states/${entityId}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HA GET state ${entityId}: ${res.status} ${res.statusText}`);
  return (await res.json()) as HaState;
}

export async function haListStates(): Promise<HaState[]> {
  const res = await haFetch("/api/states");
  if (!res.ok) throw new Error(`HA list states: ${res.status} ${res.statusText}`);
  return (await res.json()) as HaState[];
}

export async function haCallService(
  domain: string,
  service: string,
  data: Record<string, unknown> = {}
): Promise<unknown> {
  const res = await haFetch(`/api/services/${domain}/${service}`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HA service ${domain}.${service}: ${res.status} ${res.statusText} ${body}`.trim());
  }
  return res.json().catch(() => null);
}

// Converte ação do Jarvis em chamada de serviço HA. Retorna o entity_id usado.
export async function haExecute(
  entityId: string,
  action: string,
  params?: Record<string, string | number | boolean>
): Promise<void> {
  const [domain] = entityId.split(".");
  const p = params ?? {};
  const isOn = action === "on" || action === "acender" || action === "ligar";

  if (domain === "light") {
    if (action === "off" || action === "apagar" || action === "desligar") {
      await haCallService("light", "turn_off", { entity_id: entityId });
      return;
    }
    const data: Record<string, unknown> = { entity_id: entityId };
    if (typeof p.brightness === "number") data.brightness = Math.round(p.brightness);
    if (typeof p.brilho === "number") data.brightness = Math.round((p.brilho / 100) * 255);
    if (typeof p.r === "number" && typeof p.g === "number" && typeof p.b === "number") {
      data.rgb_color = [p.r, p.g, p.b];
    }
    if (typeof p.temp === "number" || typeof p.temperatura === "number") {
      const t = (p.temp ?? p.temperatura) as number;
      // HA usa Kelvin; mapeia 0..100 (nosso) para faixa típica 2700..6500
      data.color_temp_kelvin = Math.round(2700 + (t / 100) * (6500 - 2700));
    }
    if (!isOn && Object.keys(data).length === 1) {
      // apenas estado, sem parâmetros: ligar simples
    }
    await haCallService("light", "turn_on", data);
    return;
  }

  if (domain === "switch" || domain === "fan" || domain === "input_boolean") {
    await haCallService(domain, isOn ? "turn_on" : "turn_off", { entity_id: entityId });
    return;
  }

  // fallback genérico
  await haCallService(domain, isOn ? "turn_on" : "turn_off", { entity_id: entityId });
}
