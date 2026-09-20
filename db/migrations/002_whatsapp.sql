-- WhatsApp Cloud API - almacenamiento de mensajes y estados
-- Seguro para ejecutar sobre una instalación existente.
BEGIN;

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id BIGSERIAL PRIMARY KEY,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  message_kind VARCHAR(40) NOT NULL DEFAULT 'template',
  wa_message_id VARCHAR(255) UNIQUE,
  phone VARCHAR(40),
  template_name VARCHAR(140),
  status VARCHAR(40),
  status_at TIMESTAMP WITH TIME ZONE,
  error_code VARCHAR(80),
  error_message TEXT,
  payload JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS whatsapp_messages_created_idx
  ON whatsapp_messages (created_at DESC);

CREATE INDEX IF NOT EXISTS whatsapp_messages_appointment_idx
  ON whatsapp_messages (appointment_id, created_at DESC);

COMMIT;
