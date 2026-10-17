export type HardwareMode = "mock" | "rockpi";

export interface JarvisCommand {
  raw: string;
  intent: string;
  entities: Record<string, string>;
  confidence: number;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface JarvisResponse {
  text: string;
  intent: string;
  actions: HardwareAction[];
  speak: boolean;
  timestamp: string;
}

export interface HardwareAction {
  device: string;
  action: string;
  params?: Record<string, string | number | boolean>;
  simulated: boolean;
}

export interface DeviceState {
  id: string;
  name: string;
  type: "light" | "switch" | "sensor" | "system";
  state: string;
  updatedAt: string;
}

export interface SystemStatus {
  hostname: string;
  platform: string;
  arch: string;
  uptimeSec: number;
  loadAvg: number[];
  freeMem: number;
  totalMem: number;
  mode: HardwareMode;
  timestamp: string;
}
