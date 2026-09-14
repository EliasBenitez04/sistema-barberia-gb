const services = [
  { id: 'corte', name: 'Corte clásico', duration: 40, price: 50000, description: 'Corte personalizado con terminación y styling.' },
  { id: 'corte-barba', name: 'Corte + barba', duration: 60, price: 75000, description: 'Servicio completo de cabello y perfilado de barba.' },
  { id: 'barba', name: 'Barba', duration: 30, price: 35000, description: 'Perfilado, definición y terminación de barba.' }
];

const barbers = [
  { id: 'barbero-1', name: 'Barbero 1' },
  { id: 'barbero-2', name: 'Barbero 2' }
];

const STORAGE_KEY = 'barberia-gb-appointments';
const openingHour = 9;
const closingHour = 20;
const slotMinutes = 30;

const currency = new Intl.NumberFormat('es-PY', {
  style: 'currency',
  currency: 'PYG',
  maximumFractionDigits: 0
});

const els = {
  serviceCards: document.querySelector('#serviceCards'),
  form: document.querySelector('#bookingForm'),
  clientName: document.querySelector('#clientName'),
  clientPhone: document.querySelector('#clientPhone'),
  service: document.querySelector('#service'),
  barber: document.querySelector('#barber'),
  date: document.querySelector('#date'),
  time: document.querySelector('#time'),
  notes: document.querySelector('#notes'),
  formMessage: document.querySelector('#formMessage'),
  appointmentList: document.querySelector('#appointmentList'),
  clearAppointments: document.querySelector('#clearAppointments'),
  summaryService: document.querySelector('#summaryService'),
  summaryBarber: document.querySelector('#summaryBarber'),
  summaryDate: document.querySelector('#summaryDate'),
  summaryTime: document.querySelector('#summaryTime'),
  summaryPrice: document.querySelector('#summaryPrice')
};

function localDateISO(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildTimeSlots() {
  const slots = [];
  for (let minutes = openingHour * 60; minutes < closingHour * 60; minutes += slotMinutes) {
    const hours = String(Math.floor(minutes / 60)).padStart(2, '0');
    const mins = String(minutes % 60).padStart(2, '0');
    slots.push(`${hours}:${mins}`);
  }
  return slots;
}

function renderServices() {
  els.serviceCards.innerHTML = services.map((service, index) => `
    <article class="service-card">
      <span class="service-number">0${index + 1}</span>
      <h3>${service.name}</h3>
      <p>${service.description}</p>
      <div class="service-meta">
        <span>${service.duration} min</span>
        <strong>${currency.format(service.price)}</strong>
      </div>
    </article>
  `).join('');
}

function populateSelects() {
  els.service.innerHTML = services.map(service => `<option value="${service.id}">${service.name}</option>`).join('');
  els.barber.innerHTML = barbers.map(barber => `<option value="${barber.id}">${barber.name}</option>`).join('');
  els.time.innerHTML = buildTimeSlots().map(time => `<option value="${time}">${time}</option>`).join('');
}

function getAppointments() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveAppointments(appointments) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(appointments));
}

function formatDate(dateString) {
  if (!dateString) return '—';
  const [year, month, day] = dateString.split('-').map(Number);
  return new Intl.DateTimeFormat('es-PY', { day: '2-digit', month: 'short', year: 'numeric' })
    .format(new Date(year, month - 1, day));
}

function updateSummary() {
  const service = services.find(item => item.id === els.service.value);
  const barber = barbers.find(item => item.id === els.barber.value);
  els.summaryService.textContent = service?.name || 'Seleccioná un servicio';
  els.summaryBarber.textContent = barber?.name || '—';
  els.summaryDate.textContent = formatDate(els.date.value);
  els.summaryTime.textContent = els.time.value || '—';
  els.summaryPrice.textContent = service ? currency.format(service.price) : '—';
}

function showMessage(text, type = '') {
  els.formMessage.textContent = text;
  els.formMessage.className = `form-message ${type}`.trim();
}

function isSlotTaken(date, time, barberId) {
  return getAppointments().some(item => item.date === date && item.time === time && item.barberId === barberId);
}

function renderAppointments() {
  const appointments = getAppointments().sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  if (!appointments.length) {
    els.appointmentList.innerHTML = '<div class="empty-state">Todavía no hay turnos registrados en este dispositivo.</div>';
    return;
  }

  els.appointmentList.innerHTML = appointments.map(item => `
    <article class="appointment-card">
      <div>
        <h3>${escapeHtml(item.clientName)} · ${escapeHtml(item.serviceName)}</h3>
        <p>${escapeHtml(item.clientPhone)} · ${escapeHtml(item.barberName)}</p>
      </div>
      <div class="appointment-date">
        <strong>${formatDate(item.date)} · ${item.time}</strong>
        <p>${currency.format(item.price)}</p>
      </div>
      <button class="delete-button" type="button" data-delete-id="${item.id}">Eliminar</button>
    </article>
  `).join('');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function submitBooking(event) {
  event.preventDefault();
  showMessage('');

  const service = services.find(item => item.id === els.service.value);
  const barber = barbers.find(item => item.id === els.barber.value);
  const date = els.date.value;
  const time = els.time.value;

  if (!service || !barber || !date || !time) {
    showMessage('Completá todos los campos obligatorios.', 'error');
    return;
  }

  const selectedDate = new Date(`${date}T00:00:00`);
  if (selectedDate.getDay() === 0) {
    showMessage('Los domingos la barbería está cerrada. Elegí otra fecha.', 'error');
    return;
  }

  if (isSlotTaken(date, time, barber.id)) {
    showMessage('Ese horario ya está ocupado para este barbero. Elegí otro.', 'error');
    return;
  }

  const appointment = {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    clientName: els.clientName.value.trim(),
    clientPhone: els.clientPhone.value.trim(),
    serviceId: service.id,
    serviceName: service.name,
    barberId: barber.id,
    barberName: barber.name,
    date,
    time,
    price: service.price,
    notes: els.notes.value.trim(),
    createdAt: new Date().toISOString()
  };

  const appointments = getAppointments();
  appointments.push(appointment);
  saveAppointments(appointments);
  renderAppointments();
  showMessage('Turno reservado correctamente.', 'success');

  els.clientName.value = '';
  els.clientPhone.value = '';
  els.notes.value = '';
}

function deleteAppointment(id) {
  saveAppointments(getAppointments().filter(item => item.id !== id));
  renderAppointments();
}

function init() {
  renderServices();
  populateSelects();

  const today = localDateISO();
  els.date.min = today;
  els.date.value = today;

  ['change', 'input'].forEach(eventName => {
    [els.service, els.barber, els.date, els.time].forEach(element => element.addEventListener(eventName, updateSummary));
  });

  els.form.addEventListener('submit', submitBooking);
  els.appointmentList.addEventListener('click', event => {
    const button = event.target.closest('[data-delete-id]');
    if (button) deleteAppointment(button.dataset.deleteId);
  });

  els.clearAppointments.addEventListener('click', () => {
    if (getAppointments().length && confirm('¿Querés borrar todos los turnos guardados en este dispositivo?')) {
      saveAppointments([]);
      renderAppointments();
    }
  });

  updateSummary();
  renderAppointments();
}

init();
