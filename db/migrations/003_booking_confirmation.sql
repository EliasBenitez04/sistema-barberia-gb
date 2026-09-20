-- Reserva temporal y confirmación por WhatsApp
BEGIN;

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS whatsapp_confirmation_sent_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS whatsapp_confirmation_message_id VARCHAR(255);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS confirmation_deadline TIMESTAMP WITH TIME ZONE;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS confirmation_responded_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS confirmation_response VARCHAR(30);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS cancellation_reason VARCHAR(80);

CREATE INDEX IF NOT EXISTS appointments_confirmation_deadline_idx
  ON appointments (status, confirmation_deadline);

COMMIT;
