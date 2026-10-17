import { Pool } from "pg";
import type { DeviceState } from "./types";

// Pool de conexão com o PostgreSQL
let pool: Pool | null = null;

export function getDbPool(): Pool | null {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return null;
  }

  if (!pool) {
    pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 3000,
    });

    pool.on("error", (err) => {
      console.warn("[POSTGRES] Erro inesperado no pool do cliente:", err.message);
    });
  }

  return pool;
}

/**
 * Salva no histórico de comandos e respostas do Jarvis
 */
export async function saveCommandHistory(
  command: string,
  intent: string,
  response: string,
  simulated: boolean = true
): Promise<void> {
  const p = getDbPool();
  if (!p) return;

  try {
    await p.query(
      `INSERT INTO command_history (command, intent, response, simulated)
       VALUES ($1, $2, $3, $4)`,
      [command, intent, response, simulated]
    );
  } catch (err) {
    console.warn("[POSTGRES] Não foi possível salvar histórico:", (err as Error).message);
  }
}

/**
 * Recupera o estado de todos os dispositivos do banco de dados
 */
export async function getDevicesFromDb(): Promise<DeviceState[] | null> {
  const p = getDbPool();
  if (!p) return null;

  try {
    const res = await p.query(
      `SELECT id, name, type, state, updated_at as "updatedAt" FROM devices ORDER BY id ASC`
    );
    return res.rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      state: row.state,
      updatedAt: row.updatedAt?.toISOString() || new Date().toISOString(),
    }));
  } catch (err) {
    console.warn("[POSTGRES] Erro ao buscar dispositivos:", (err as Error).message);
    return null;
  }
}

/**
 * Atualiza o estado de um dispositivo (ex: on / off)
 */
export async function updateDeviceStateInDb(
  id: string,
  state: string,
  metadata?: Record<string, any>
): Promise<void> {
  const p = getDbPool();
  if (!p) return;

  try {
    if (metadata) {
      await p.query(
        `UPDATE devices 
         SET state = $1, metadata = $2, updated_at = now() 
         WHERE id = $3`,
        [state, JSON.stringify(metadata), id]
      );
    } else {
      await p.query(
        `UPDATE devices 
         SET state = $1, updated_at = now() 
         WHERE id = $2`,
        [state, id]
      );
    }
  } catch (err) {
    console.warn(`[POSTGRES] Erro ao atualizar dispositivo ${id}:`, (err as Error).message);
  }
}
