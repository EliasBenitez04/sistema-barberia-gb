const currency = new Intl.NumberFormat('es-PY', { style: 'currency', currency: 'PYG', maximumFractionDigits: 0 });
let services = [];
let barbers = [];

const $ = selector => document.querySelector(selector);
const els = {
  serviceCards: $('#serviceCards'), form: $('#bookingForm'), clientName: $('#clientName'), clientPhone: $('#clientPhone'),
  service: $('#service'), barber: $('#barber'), date: $('#date'), time: $('#time'), notes: $('#notes'), formMessage: $('#formMessage'),
  summaryService: $('#summaryService'), summaryBarber: $('#summaryBarber'), summaryDate: $('#summaryDate'), summaryTime: $('#summaryTime'), summaryPrice: $('#summaryPrice')
};

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function localDateISO(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDate(value) {
  if (!value) return '—';
  const [y, m, d] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('es-PY', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(y, m - 1, d));
}

async function api(url, options = {}) {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'No se pudo completar la operación.');
  return body;
}

function renderServices() {
  els.serviceCards.innerHTML = services.length ? services.map((service, index) => `
    <article class="service-card">
      <span class="service-number">${String(index + 1).padStart(2, '0')}</span>
      <h3>${escapeHtml(service.name)}</h3>
      <p>${escapeHtml(service.description || '')}</p>
      <div class="service-meta"><span>${service.duration_minutes} min</span><strong>${currency.format(Number(service.price))}</strong></div>
    </article>`).join('') : '<div class="empty-state">No hay servicios disponibles.</div>';
}

function populateSelects() {
  els.service.innerHTML = services.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  els.barber.innerHTML = barbers.map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
}

function updateSummary() {
  const service = services.find(s => String(s.id) === els.service.value);
  const barber = barbers.find(b => String(b.id) === els.barber.value);
  els.summaryService.textContent = service?.name || 'Seleccioná un servicio';
  els.summaryBarber.textContent = barber?.name || '—';
  els.summaryDate.textContent = formatDate(els.date.value);
  els.summaryTime.textContent = els.time.value || '—';
  els.summaryPrice.textContent = service ? currency.format(Number(service.price)) : '—';
}

async function loadAvailability() {
  updateSummary();
  if (!els.service.value || !els.barber.value || !els.date.value) return;
  els.time.innerHTML = '<option value="">Consultando...</option>';
  try {
    const query = new URLSearchParams({ service_id: els.service.value, barber_id: els.barber.value, date: els.date.value });
    const data = await api(`/api/public/availability?${query}`);
    els.time.innerHTML = data.slots.length
      ? '<option value="">Seleccioná un horario</option>' + data.slots.map(time => `<option value="${time}">${time}</option>`).join('')
      : '<option value="">Sin horarios disponibles</option>';
  } catch (error) {
    els.time.innerHTML = '<option value="">No se pudo consultar</option>';
  }
  updateSummary();
}

async function submitBooking(event) {
  event.preventDefault();
  els.formMessage.className = 'form-message';
  els.formMessage.textContent = 'Registrando turno...';
  try {
    const result = await api('/api/public/appointments', {
      method: 'POST',
      body: JSON.stringify({
        client_name: els.clientName.value.trim(), client_phone: els.clientPhone.value.trim(), service_id: Number(els.service.value),
        barber_id: Number(els.barber.value), date: els.date.value, time: els.time.value, notes: els.notes.value.trim()
      })
    });
    els.formMessage.textContent = `Reserva #${result.id} registrada como pendiente para ${formatDate(result.appointment_date)} a las ${String(result.start_time).slice(0, 5)}.`;
    els.formMessage.className = 'form-message success';
    els.clientName.value = '';
    els.clientPhone.value = '';
    els.notes.value = '';
    await loadAvailability();
  } catch (error) {
    els.formMessage.textContent = error.message;
    els.formMessage.className = 'form-message error';
    await loadAvailability();
  }
}

async function init() {
  const today = localDateISO();
  els.date.min = today;
  els.date.value = today;
  try {
    [services, barbers] = await Promise.all([api('/api/public/services'), api('/api/public/barbers')]);
    renderServices();
    populateSelects();
    await loadAvailability();
  } catch (error) {
    els.serviceCards.innerHTML = `<div class="empty-state">No se pudo conectar con el servidor. ${escapeHtml(error.message)}</div>`;
  }

  [els.service, els.barber, els.date].forEach(el => el.addEventListener('change', loadAvailability));
  els.time.addEventListener('change', updateSummary);
  els.form.addEventListener('submit', submitBooking);
  updateSummary();
}

init();
