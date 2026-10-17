-- J.A.R.V.I.S. — estrutura do banco (PostgreSQL 12+)
-- Uso na Rock Pi:  psql -d jarvis -f sql/schema.sql

-- Dispositivos da casa (estado persistente, sobrevive a reboot)
CREATE TABLE IF NOT EXISTS devices (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('light', 'switch', 'sensor', 'system')),
  state      TEXT NOT NULL DEFAULT 'off',
  metadata   JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Histórico de comandos e respostas (auditoria)
CREATE TABLE IF NOT EXISTS command_history (
  id         BIGSERIAL PRIMARY KEY,
  command    TEXT NOT NULL,
  intent     TEXT NOT NULL DEFAULT 'desconhecido',
  response   TEXT NOT NULL,
  simulated  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_command_history_created
  ON command_history (created_at DESC);

-- Leituras de sensores ao longo do tempo (gráficos futuros)
CREATE TABLE IF NOT EXISTS sensor_readings (
  id        BIGSERIAL PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  metric    TEXT NOT NULL,              -- ex: temperature, humidity
  value     DOUBLE PRECISION NOT NULL,
  unit      TEXT,                       -- ex: C, %
  read_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sensor_readings_device_time
  ON sensor_readings (device_id, read_at DESC);

-- Seeds: mesmos dispositivos do modo mock (src/lib/jarvis/hardware.ts)
INSERT INTO devices (id, name, type, state) VALUES
  ('luz-sala',   'Luz da Sala', 'light',  'off'),
  ('luz-quarto', 'Luz do Quarto', 'light', 'off'),
  ('ventilador', 'Ventilador',    'switch', 'off')
ON CONFLICT (id) DO NOTHING;
