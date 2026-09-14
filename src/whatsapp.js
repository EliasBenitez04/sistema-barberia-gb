function whatsappConfigured() {
  return String(process.env.WHATSAPP_ENABLED).toLowerCase() === 'true' &&
    process.env.WHATSAPP_GRAPH_VERSION &&
    process.env.WHATSAPP_PHONE_NUMBER_ID &&
    process.env.WHATSAPP_ACCESS_TOKEN &&
    process.env.WHATSAPP_TEMPLATE_NAME;
}

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

async function sendAppointmentReminder({ phone, clientName, dateLabel, timeLabel, barberName, serviceName }) {
  if (!whatsappConfigured()) {
    const error = new Error('WhatsApp Cloud API no está configurado.');
    error.code = 'WHATSAPP_NOT_CONFIGURED';
    throw error;
  }

  const version = process.env.WHATSAPP_GRAPH_VERSION;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const url = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizePhone(phone),
    type: 'template',
    template: {
      name: process.env.WHATSAPP_TEMPLATE_NAME,
      language: { code: process.env.WHATSAPP_TEMPLATE_LANG || 'es' },
      components: [{
        type: 'body',
        parameters: [
          { type: 'text', text: clientName },
          { type: 'text', text: dateLabel },
          { type: 'text', text: timeLabel },
          { type: 'text', text: barberName },
          { type: 'text', text: serviceName }
        ]
      }]
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body?.error?.message || `WhatsApp respondió ${response.status}`);
    error.details = body;
    throw error;
  }

  return body;
}

module.exports = { whatsappConfigured, sendAppointmentReminder, normalizePhone };
