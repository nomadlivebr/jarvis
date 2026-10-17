import os from "node:os";
import { getHardwareMode } from "./hardware";
import type { SystemStatus } from "./types";

export function getSystemStatus(): SystemStatus {
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    uptimeSec: Math.floor(os.uptime()),
    loadAvg: os.loadavg(),
    freeMem: os.freemem(),
    totalMem: os.totalmem(),
    mode: getHardwareMode(),
    timestamp: new Date().toISOString(),
  };
}
