const crypto = require('crypto');

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function transportConfigured() {
  return Boolean(
    String(process.env.WHATSAPP_ENABLED).toLowerCase() === 'true' &&
    process.env.WHATSAPP_GRAPH_VERSION &&
    process.env.WHATSAPP_PHONE_NUMBER_ID &&
    process.env.WHATSAPP_ACCESS_TOKEN
  );
}

function whatsappConfigured() {
  return Boolean(transportConfigured() && process.env.WHATSAPP_TEMPLATE_NAME);
}

function confirmationConfigured() {
  return Boolean(transportConfigured() && process.env.WHATSAPP_CONFIRMATION_TEMPLATE_NAME);
}

function webhookConfigured() {
  return Boolean(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN);
}

function getWhatsAppStatus() {
  const required = {
    WHATSAPP_ENABLED: String(process.env.WHATSAPP_ENABLED).toLowerCase() === 'true',
    WHATSAPP_GRAPH_VERSION: Boolean(process.env.WHATSAPP_GRAPH_VERSION),
    WHATSAPP_PHONE_NUMBER_ID: Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID),
    WHATSAPP_ACCESS_TOKEN: Boolean(process.env.WHATSAPP_ACCESS_TOKEN)
  };
  const missing = Object.entries(required).filter(([, ok]) => !ok).map(([key]) => key);

  return {
    configured: transportConfigured(),
    reminder_configured: whatsappConfigured(),
    confirmation_configured: confirmationConfigured(),
    webhook_configured: webhookConfigured(),
    signature_verification: Boolean(process.env.WHATSAPP_APP_SECRET),
    graph_version: process.env.WHATSAPP_GRAPH_VERSION || null,
    phone_number_id: process.env.WHATSAPP_PHONE_NUMBER_ID || null,
    reminder_template: process.env.WHATSAPP_TEMPLATE_NAME || null,
    reminder_language: process.env.WHATSAPP_TEMPLATE_LANG || 'es',
    confirmation_template: process.env.WHATSAPP_CONFIRMATION_TEMPLATE_NAME || null,
    confirmation_language: process.env.WHATSAPP_CONFIRMATION_TEMPLATE_LANG || process.env.WHATSAPP_TEMPLATE_LANG || 'es',
    test_template: process.env.WHATSAPP_TEST_TEMPLATE_NAME || 'hello_world',
    test_language: process.env.WHATSAPP_TEST_TEMPLATE_LANG || 'en_US',
    reminder_hours: Number(process.env.WHATSAPP_REMINDER_HOURS || 24),
    missing
  };
}

function notConfiguredError() {
  const error = new Error('WhatsApp Cloud API no está configurado. Revisá la sección WhatsApp del panel y tu archivo .env.');
  error.code = 'WHATSAPP_NOT_CONFIGURED';
  return error;
}

async function sendTemplate({ phone, templateName, language, parameters = [] }) {
  if (!transportConfigured()) throw notConfiguredError();

  const to = normalizePhone(phone);
  if (to.length < 8) {
    const error = new Error('Número de WhatsApp inválido. Usá código de país, por ejemplo 595981123456.');
    error.code = 'WHATSAPP_INVALID_PHONE';
    throw error;
  }

  if (!templateName) {
    const error = new Error('No se definió el nombre del template de WhatsApp.');
    error.code = 'WHATSAPP_TEMPLATE_MISSING';
    throw error;
  }

  const version = process.env.WHATSAPP_GRAPH_VERSION;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const url = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;

  const template = {
    name: templateName,
    language: { code: language }
  };

  if (parameters.length) {
    template.components = [{
      type: 'body',
      parameters: parameters.map(value => ({ type: 'text', text: String(value ?? '') }))
    }];
  }

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template
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
    error.code = 'WHATSAPP_API_ERROR';
    error.details = body;
    error.status = response.status;
    throw error;
  }

  return body;
}

async function sendAppointmentReminder({ phone, clientName, dateLabel, timeLabel, barberName, serviceName }) {
  if (!whatsappConfigured()) throw notConfiguredError();
  return sendTemplate({
    phone,
    templateName: process.env.WHATSAPP_TEMPLATE_NAME,
    language: process.env.WHATSAPP_TEMPLATE_LANG || 'es',
    parameters: [clientName, dateLabel, timeLabel, barberName, serviceName]
  });
}

async function sendAppointmentConfirmation({ phone, clientName, dateLabel, timeLabel, barberName, serviceName }) {
  if (!confirmationConfigured()) throw notConfiguredError();
  return sendTemplate({
    phone,
    templateName: process.env.WHATSAPP_CONFIRMATION_TEMPLATE_NAME,
    language: process.env.WHATSAPP_CONFIRMATION_TEMPLATE_LANG || process.env.WHATSAPP_TEMPLATE_LANG || 'es',
    parameters: [clientName, dateLabel, timeLabel, barberName, serviceName]
  });
}

async function sendTestMessage({ phone }) {
  return sendTemplate({
    phone,
    templateName: process.env.WHATSAPP_TEST_TEMPLATE_NAME || 'hello_world',
    language: process.env.WHATSAPP_TEST_TEMPLATE_LANG || 'en_US'
  });
}

function verifyWebhookRequest(query) {
  const mode = String(query['hub.mode'] || '');
  const token = String(query['hub.verify_token'] || '');
  const challenge = String(query['hub.challenge'] || '');
  return mode === 'subscribe' &&
    Boolean(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) &&
    token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN
    ? challenge
    : null;
}

function verifyWebhookSignature(rawBody, signature) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return true;
  if (!rawBody || !signature || !String(signature).startsWith('sha256=')) return false;

  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const actualBuffer = Buffer.from(String(signature));
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function extractWebhookEvents(payload) {
  const statuses = [];
  const messages = [];

  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      const value = change?.value || {};
      for (const status of value.statuses || []) statuses.push(status);
      for (const message of value.messages || []) messages.push(message);
    }
  }

  return { statuses, messages };
}

module.exports = {
  whatsappConfigured,
  confirmationConfigured,
  webhookConfigured,
  transportConfigured,
  getWhatsAppStatus,
  sendAppointmentReminder,
  sendAppointmentConfirmation,
  sendTestMessage,
  normalizePhone,
  verifyWebhookRequest,
  verifyWebhookSignature,
  extractWebhookEvents
};
