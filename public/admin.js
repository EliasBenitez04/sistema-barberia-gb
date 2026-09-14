const TOKEN_KEY = 'barberia-gb-admin-token';
const currency = new Intl.NumberFormat('es-PY', { style: 'currency', currency: 'PYG', maximumFractionDigits: 0 });
const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
let token = localStorage.getItem(TOKEN_KEY) || '';
let barbers = [];
let services = [];
let editingScheduleBarber = null;

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
function esc(v) { return String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;'); }
function today() { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function monthStart() { return `${today().slice(0,7)}-01`; }
function shortTime(v) { return String(v || '').slice(0,5); }
function dateLabel(v) { if(!v) return '—'; const [y,m,d]=String(v).slice(0,10).split('-').map(Number); return new Intl.DateTimeFormat('es-PY').format(new Date(y,m-1,d)); }

async function api(url, options={}) {
  const headers = { 'Content-Type':'application/json', ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 && url !== '/api/admin/login') { logout(); throw new Error('Sesión vencida.'); }
  if (!response.ok) throw new Error(body.error || 'Error en la operación.');
  return body;
}

function showSection(name) {
  $$('.admin-section').forEach(s => s.classList.add('hidden'));
  $(`#section-${name}`).classList.remove('hidden');
  $$('#adminNav button').forEach(b => b.classList.toggle('active', b.dataset.section === name));
  const titles = {dashboard:'Resumen', appointments:'Turnos', barbers:'Barberos', services:'Servicios', clients:'Clientes', reports:'Reportes'};
  $('#sectionTitle').textContent = titles[name] || name;
  if (name==='dashboard') loadDashboard();
  if (name==='appointments') loadAppointments();
  if (name==='barbers') loadBarbers();
  if (name==='services') loadServices();
  if (name==='clients') loadClients();
  if (name==='reports') loadReports();
}

async function login(event) {
  event.preventDefault();
  try {
    const data = await api('/api/admin/login', { method:'POST', body:JSON.stringify({ email:$('#loginEmail').value, password:$('#loginPassword').value }) });
    token = data.token; localStorage.setItem(TOKEN_KEY, token); $('#adminName').textContent = data.user.name; openAdmin();
  } catch (error) { $('#loginMessage').textContent=error.message; $('#loginMessage').className='form-message error'; }
}
function logout() { token=''; localStorage.removeItem(TOKEN_KEY); $('#adminView').classList.add('hidden'); $('#loginView').classList.remove('hidden'); }

async function openAdmin() {
  try {
    const me = await api('/api/admin/me');
    $('#adminName').textContent = me.user.name || me.user.email;
    $('#loginView').classList.add('hidden'); $('#adminView').classList.remove('hidden');
    const wa = await api('/api/admin/whatsapp/status');
    $('#whatsappBadge').textContent = wa.configured ? 'WhatsApp activo' : 'WhatsApp sin configurar';
    $('#whatsappBadge').classList.toggle('success', wa.configured);
    showSection('dashboard');
  } catch (error) { logout(); }
}

async function loadDashboard() {
  const [data, appointments] = await Promise.all([api('/api/admin/dashboard'), api(`/api/admin/appointments?date=${today()}`)]);
  $('#dashboardCards').innerHTML = [
    ['Turnos hoy', data.today.total], ['Pendientes', data.today.pendientes], ['Atendidos hoy', data.today.atendidos], ['Ingresos del mes', currency.format(Number(data.month.ingresos))]
  ].map(([label,value])=>`<article class="stat-card"><span>${esc(label)}</span><strong>${esc(value)}</strong></article>`).join('');
  $('#todayAppointments').innerHTML = appointments.length ? appointments.slice().reverse().map(a=>appointmentMini(a)).join('') : '<div class="empty-state">No hay turnos para hoy.</div>';
}
function appointmentMini(a) { return `<div class="list-row"><div><strong>${shortTime(a.start_time)} · ${esc(a.client_name)}</strong><span>${esc(a.service_name)} con ${esc(a.barber_name)}</span></div><span class="status status-${a.status}">${esc(a.status)}</span></div>`; }

async function loadAppointments() {
  const qs = new URLSearchParams();
  if ($('#filterFrom').value) qs.set('from',$('#filterFrom').value); if ($('#filterTo').value) qs.set('to',$('#filterTo').value); if ($('#filterStatus').value) qs.set('status',$('#filterStatus').value);
  const data = await api(`/api/admin/appointments?${qs}`);
  $('#appointmentsTable').innerHTML = data.length ? data.map(a=>`<tr>
    <td><strong>${dateLabel(a.appointment_date)}</strong><br><span class="muted">${shortTime(a.start_time)}</span></td><td>${esc(a.client_name)}<br><span class="muted">${esc(a.client_phone)}</span></td>
    <td>${esc(a.service_name)}</td><td>${esc(a.barber_name)}</td><td><select class="status-select" data-status-id="${a.id}">${['pendiente','confirmado','atendido','cancelado'].map(s=>`<option ${s===a.status?'selected':''}>${s}</option>`).join('')}</select></td>
    <td>${currency.format(Number(a.price_snapshot))}</td><td><button class="button ghost small" data-reminder-id="${a.id}">WhatsApp</button></td></tr>`).join('') : '<tr><td colspan="7">No hay turnos.</td></tr>';
}

async function changeStatus(id,status) { try { await api(`/api/admin/appointments/${id}/status`,{method:'PATCH',body:JSON.stringify({status})}); loadAppointments(); } catch(e){ alert(e.message); loadAppointments(); } }
async function sendReminder(id) { try { await api(`/api/admin/appointments/${id}/reminder`,{method:'POST'}); alert('Recordatorio enviado.'); loadAppointments(); } catch(e){ alert(e.message); } }

async function loadBarbers() {
  barbers = await api('/api/admin/barbers');
  $('#barbersList').innerHTML = barbers.map(b=>`<div class="stack-item"><div><strong>${esc(b.name)}</strong><span>${b.active?'Activo':'Inactivo'} · ${esc(b.phone||'Sin teléfono')}</span></div><div class="row-actions"><button class="button ghost small" data-edit-barber="${b.id}">Editar</button><button class="button ghost small" data-schedule-barber="${b.id}">Horarios</button></div></div>`).join('') || '<div class="empty-state">No hay barberos.</div>';
}
function resetBarberForm(){ $('#barberId').value=''; $('#barberName').value=''; $('#barberPhone').value=''; $('#barberBio').value=''; $('#barberActive').checked=true; $('#barberFormTitle').textContent='Nuevo barbero'; }
function editBarber(id){ const b=barbers.find(x=>x.id===Number(id)); if(!b)return; $('#barberId').value=b.id; $('#barberName').value=b.name; $('#barberPhone').value=b.phone||''; $('#barberBio').value=b.bio||''; $('#barberActive').checked=b.active; $('#barberFormTitle').textContent='Editar barbero'; window.scrollTo({top:0,behavior:'smooth'}); }
async function saveBarber(e){ e.preventDefault(); const id=$('#barberId').value; const payload={name:$('#barberName').value,phone:$('#barberPhone').value,bio:$('#barberBio').value,active:$('#barberActive').checked}; try{ await api(id?`/api/admin/barbers/${id}`:'/api/admin/barbers',{method:id?'PUT':'POST',body:JSON.stringify(payload)}); resetBarberForm(); loadBarbers(); }catch(err){alert(err.message);} }
function openSchedule(id){ const b=barbers.find(x=>x.id===Number(id)); if(!b)return; editingScheduleBarber=b; $('#scheduleTitle').textContent=`Horarios de ${b.name}`; const byDay=new Map((b.schedules||[]).map(s=>[Number(s.weekday),s])); $('#scheduleGrid').innerHTML=days.map((name,weekday)=>{ const s=byDay.get(weekday); return `<div class="schedule-row" data-weekday="${weekday}"><label class="check-row"><input class="schedule-active" type="checkbox" ${s?.active?'checked':''}> ${name}</label><input class="schedule-start" type="time" value="${shortTime(s?.start_time)||'09:00'}"><span>a</span><input class="schedule-end" type="time" value="${shortTime(s?.end_time)||'20:00'}"><select class="schedule-slot">${[15,20,30,45,60].map(v=>`<option value="${v}" ${Number(s?.slot_minutes||30)===v?'selected':''}>cada ${v} min</option>`).join('')}</select></div>`; }).join(''); $('#schedulePanel').classList.remove('hidden'); $('#schedulePanel').scrollIntoView({behavior:'smooth'}); }
async function saveSchedule(){ if(!editingScheduleBarber)return; const schedules=$$('#scheduleGrid .schedule-row').filter(r=>r.querySelector('.schedule-active').checked).map(r=>({weekday:Number(r.dataset.weekday),start_time:r.querySelector('.schedule-start').value,end_time:r.querySelector('.schedule-end').value,slot_minutes:Number(r.querySelector('.schedule-slot').value),active:true})); try{await api(`/api/admin/barbers/${editingScheduleBarber.id}/schedules`,{method:'PUT',body:JSON.stringify({schedules})}); $('#schedulePanel').classList.add('hidden'); await loadBarbers();}catch(e){alert(e.message);} }

async function loadServices(){ services=await api('/api/admin/services'); $('#servicesList').innerHTML=services.map(s=>`<div class="stack-item"><div><strong>${esc(s.name)}</strong><span>${s.duration_minutes} min · ${currency.format(Number(s.price))} · ${s.active?'Activo':'Inactivo'}</span></div><button class="button ghost small" data-edit-service="${s.id}">Editar</button></div>`).join('')||'<div class="empty-state">No hay servicios.</div>'; }
function resetServiceForm(){ $('#serviceId').value=''; $('#serviceName').value=''; $('#serviceDescription').value=''; $('#serviceDuration').value='40'; $('#servicePrice').value='50000'; $('#serviceActive').checked=true; $('#serviceFormTitle').textContent='Nuevo servicio'; }
function editService(id){ const s=services.find(x=>x.id===Number(id)); if(!s)return; $('#serviceId').value=s.id; $('#serviceName').value=s.name; $('#serviceDescription').value=s.description||''; $('#serviceDuration').value=s.duration_minutes; $('#servicePrice').value=Number(s.price); $('#serviceActive').checked=s.active; $('#serviceFormTitle').textContent='Editar servicio'; window.scrollTo({top:0,behavior:'smooth'}); }
async function saveService(e){ e.preventDefault(); const id=$('#serviceId').value; const payload={name:$('#serviceName').value,description:$('#serviceDescription').value,duration_minutes:Number($('#serviceDuration').value),price:Number($('#servicePrice').value),active:$('#serviceActive').checked}; try{await api(id?`/api/admin/services/${id}`:'/api/admin/services',{method:id?'PUT':'POST',body:JSON.stringify(payload)}); resetServiceForm(); loadServices();}catch(err){alert(err.message);} }

async function loadClients(){ const q=$('#clientSearch').value.trim(); const data=await api(`/api/admin/clients${q?`?search=${encodeURIComponent(q)}`:''}`); $('#clientsTable').innerHTML=data.length?data.map(c=>`<tr><td>${esc(c.name)}</td><td>${esc(c.phone)}</td><td>${c.total_turnos}</td><td>${c.cortes}</td><td>${currency.format(Number(c.total_gastado))}</td><td><button class="button ghost small" data-client-history="${c.id}">Historial</button></td></tr>`).join(''):'<tr><td colspan="6">No hay clientes.</td></tr>'; }
async function showClientHistory(id){ const data=await api(`/api/admin/clients/${id}/history`); $('#clientHistory').classList.remove('hidden'); $('#clientHistory').innerHTML=`<div class="panel-heading"><div><p class="eyebrow">HISTORIAL</p><h2>${esc(data.client.name)}</h2><span>${esc(data.client.phone)}</span></div><button class="button ghost small" onclick="document.querySelector('#clientHistory').classList.add('hidden')">Cerrar</button></div>${data.appointments.length?data.appointments.map(a=>`<div class="list-row"><div><strong>${dateLabel(a.appointment_date)} · ${shortTime(a.start_time)}</strong><span>${esc(a.service_name)} con ${esc(a.barber_name)}</span></div><div><span class="status status-${a.status}">${a.status}</span> ${currency.format(Number(a.price_snapshot))}</div></div>`).join(''):'<div class="empty-state">Sin turnos.</div>'}`; $('#clientHistory').scrollIntoView({behavior:'smooth'}); }

async function loadReports(){ const qs=new URLSearchParams({from:$('#reportFrom').value||monthStart(),to:$('#reportTo').value||today()}); const data=await api(`/api/admin/reports?${qs}`); $('#reportFrom').value=data.from; $('#reportTo').value=data.to; $('#reportSummary').innerHTML=[['Ingresos',currency.format(Number(data.summary.ingresos))],['Cortes',data.summary.cortes],['Turnos',data.summary.total_turnos],['Cancelados',data.summary.cancelados]].map(([l,v])=>`<article class="stat-card"><span>${l}</span><strong>${v}</strong></article>`).join(''); $('#reportBarbers').innerHTML=data.by_barber.map(x=>`<div class="list-row"><strong>${esc(x.name)}</strong><span>${x.cortes} cortes · ${currency.format(Number(x.ingresos))}</span></div>`).join(''); $('#reportServices').innerHTML=data.by_service.map(x=>`<div class="list-row"><strong>${esc(x.name)}</strong><span>${x.cortes} cortes · ${currency.format(Number(x.ingresos))}</span></div>`).join(''); $('#reportDaily').innerHTML=data.daily.length?data.daily.map(x=>`<div class="list-row"><strong>${dateLabel(x.appointment_date)}</strong><span>${x.cortes} cortes · ${currency.format(Number(x.ingresos))}</span></div>`).join(''):'<div class="empty-state">Sin actividad en el rango.</div>'; }

$('#loginForm').addEventListener('submit',login); $('#logoutBtn').addEventListener('click',logout); $('#adminNav').addEventListener('click',e=>{const b=e.target.closest('[data-section]'); if(b)showSection(b.dataset.section);});
document.addEventListener('click',e=>{ const go=e.target.closest('[data-go]'); if(go)showSection(go.dataset.go); const eb=e.target.closest('[data-edit-barber]'); if(eb)editBarber(eb.dataset.editBarber); const sb=e.target.closest('[data-schedule-barber]'); if(sb)openSchedule(sb.dataset.scheduleBarber); const es=e.target.closest('[data-edit-service]'); if(es)editService(es.dataset.editService); const ch=e.target.closest('[data-client-history]'); if(ch)showClientHistory(ch.dataset.clientHistory); const rem=e.target.closest('[data-reminder-id]'); if(rem)sendReminder(rem.dataset.reminderId); });
document.addEventListener('change',e=>{ if(e.target.matches('[data-status-id]')) changeStatus(e.target.dataset.statusId,e.target.value); });
$('#filterAppointmentsBtn').addEventListener('click',loadAppointments); $('#barberForm').addEventListener('submit',saveBarber); $('#barberResetBtn').addEventListener('click',resetBarberForm); $('#saveScheduleBtn').addEventListener('click',saveSchedule); $('#closeScheduleBtn').addEventListener('click',()=>$('#schedulePanel').classList.add('hidden')); $('#serviceForm').addEventListener('submit',saveService); $('#serviceResetBtn').addEventListener('click',resetServiceForm); $('#searchClientsBtn').addEventListener('click',loadClients); $('#loadReportsBtn').addEventListener('click',loadReports);
$('#filterFrom').value=today(); $('#filterTo').value=today(); $('#reportFrom').value=monthStart(); $('#reportTo').value=today();
if(token) openAdmin();
