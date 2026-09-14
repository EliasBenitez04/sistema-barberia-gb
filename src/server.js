require('dotenv').config();

const path = require('path');
const express = require('express');
const bcrypt = require('bcryptjs');
const { DateTime } = require('luxon');
const { pool, query } = require('./db');
const { signAdmin, requireAdmin } = require('./auth');
const { whatsappConfigured, sendAppointmentReminder, normalizePhone } = require('./whatsapp');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ZONE = process.env.APP_TIMEZONE || 'America/Asuncion';
const STATUSES = ['pendiente', 'confirmado', 'atendido', 'cancelado'];

if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL en .env');
if (!process.env.JWT_SECRET) throw new Error('Falta JWT_SECRET en .env');

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, '..', 'public')));

function apiError(res, status, message, details) {
  return res.status(status).json({ error: message, ...(details ? { details } : {}) });
}

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function money(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function normalizeDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : null;
}

function timeToMinutes(value) {
  const match = String(value || '').match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function minutesToTime(total) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function dateWeekday(date) {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

function formatDateEs(date) {
  return DateTime.fromISO(String(date), { zone: ZONE }).setLocale('es').toFormat('dd/LL/yyyy');
}

async function ensureInitialAdmin() {
  const count = await query('SELECT COUNT(*)::int AS total FROM admin_users');
  if (count.rows[0].total > 0) return;

  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || '');
  const name = String(process.env.ADMIN_NAME || 'Administrador').trim();
  if (!email || password.length < 8) {
    console.warn('No hay administradores. Definí ADMIN_EMAIL y ADMIN_PASSWORD (mínimo 8 caracteres) y reiniciá.');
    return;
  }

  const hash = await bcrypt.hash(password, 12);
  await query('INSERT INTO admin_users (name, email, password_hash) VALUES ($1, $2, $3)', [name, email, hash]);
  console.log(`Administrador inicial creado: ${email}`);
}

async function getSchedule(barberId, date) {
  const weekday = dateWeekday(date);
  const result = await query(
    `SELECT s.start_time::text, s.end_time::text, s.slot_minutes
       FROM barber_schedules s
      WHERE s.barber_id = $1 AND s.weekday = $2 AND s.active = TRUE`,
    [barberId, weekday]
  );
  return result.rows[0] || null;
}

async function isTimeOff(barberId, date) {
  const result = await query('SELECT 1 FROM barber_time_off WHERE barber_id = $1 AND off_date = $2 LIMIT 1', [barberId, date]);
  return result.rowCount > 0;
}

async function validateBookingSlot(client, { barberId, serviceId, date, startTime }) {
  const data = await client.query(
    `SELECT s.id AS service_id, s.name AS service_name, s.duration_minutes, s.price,
            b.id AS barber_id, b.name AS barber_name
       FROM services s
       JOIN barbers b ON b.id = $2 AND b.active = TRUE
      WHERE s.id = $1 AND s.active = TRUE`,
    [serviceId, barberId]
  );
  if (!data.rows[0]) return { error: 'Servicio o barbero no disponible.' };

  const item = data.rows[0];
  const weekday = dateWeekday(date);
  const scheduleResult = await client.query(
    `SELECT start_time::text, end_time::text, slot_minutes
       FROM barber_schedules
      WHERE barber_id = $1 AND weekday = $2 AND active = TRUE`,
    [barberId, weekday]
  );
  const schedule = scheduleResult.rows[0];
  if (!schedule) return { error: 'El barbero no trabaja ese día.' };

  const off = await client.query('SELECT 1 FROM barber_time_off WHERE barber_id = $1 AND off_date = $2 LIMIT 1', [barberId, date]);
  if (off.rowCount) return { error: 'El barbero no está disponible en esa fecha.' };

  const requested = timeToMinutes(startTime);
  const opening = timeToMinutes(schedule.start_time);
  const closing = timeToMinutes(schedule.end_time);
  const end = requested === null ? null : requested + Number(item.duration_minutes);
  if (requested === null || requested < opening || end > closing || (requested - opening) % Number(schedule.slot_minutes) !== 0) {
    return { error: 'El horario seleccionado no pertenece a la jornada del barbero.' };
  }

  const lockDate = Number(String(date).replace(/-/g, ''));
  await client.query('SELECT pg_advisory_xact_lock($1, $2)', [barberId, lockDate]);

  const conflicts = await client.query(
    `SELECT id FROM appointments
      WHERE barber_id = $1
        AND appointment_date = $2
        AND status <> 'cancelado'
        AND start_time < $4::time
        AND end_time > $3::time
      LIMIT 1`,
    [barberId, date, startTime, minutesToTime(end)]
  );
  if (conflicts.rowCount) return { error: 'Ese horario ya no está disponible.' };

  return { item, endTime: minutesToTime(end) };
}

app.get('/api/health', async (req, res) => {
  try {
    const db = await query('SELECT version() AS version, NOW() AS now');
    res.json({ ok: true, database: db.rows[0].version, time: db.rows[0].now, whatsapp: whatsappConfigured() });
  } catch (error) {
    apiError(res, 503, 'No se pudo conectar con PostgreSQL.');
  }
});

app.get('/api/public/services', async (req, res, next) => {
  try {
    const result = await query('SELECT id, name, description, duration_minutes, price FROM services WHERE active = TRUE ORDER BY id');
    res.json(result.rows);
  } catch (error) { next(error); }
});

app.get('/api/public/barbers', async (req, res, next) => {
  try {
    const result = await query('SELECT id, name, bio FROM barbers WHERE active = TRUE ORDER BY name');
    res.json(result.rows);
  } catch (error) { next(error); }
});

app.get('/api/public/availability', async (req, res, next) => {
  try {
    const barberId = parseId(req.query.barber_id);
    const serviceId = parseId(req.query.service_id);
    const date = normalizeDate(req.query.date);
    if (!barberId || !serviceId || !date) return apiError(res, 400, 'Parámetros de disponibilidad inválidos.');

    const serviceResult = await query('SELECT duration_minutes FROM services WHERE id = $1 AND active = TRUE', [serviceId]);
    if (!serviceResult.rows[0]) return apiError(res, 404, 'Servicio no encontrado.');
    if (await isTimeOff(barberId, date)) return res.json({ date, slots: [] });

    const schedule = await getSchedule(barberId, date);
    if (!schedule) return res.json({ date, slots: [] });

    const appointments = await query(
      `SELECT start_time::text, end_time::text FROM appointments
        WHERE barber_id = $1 AND appointment_date = $2 AND status <> 'cancelado'`,
      [barberId, date]
    );

    const opening = timeToMinutes(schedule.start_time);
    const closing = timeToMinutes(schedule.end_time);
    const duration = Number(serviceResult.rows[0].duration_minutes);
    const step = Number(schedule.slot_minutes);
    const slots = [];

    for (let start = opening; start + duration <= closing; start += step) {
      const end = start + duration;
      const conflict = appointments.rows.some(row => {
        const bookedStart = timeToMinutes(row.start_time);
        const bookedEnd = timeToMinutes(row.end_time);
        return start < bookedEnd && end > bookedStart;
      });
      if (!conflict) slots.push(minutesToTime(start));
    }

    res.json({ date, slots });
  } catch (error) { next(error); }
});

app.post('/api/public/appointments', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const clientName = String(req.body.client_name || '').trim();
    const phone = normalizePhone(req.body.client_phone);
    const barberId = parseId(req.body.barber_id);
    const serviceId = parseId(req.body.service_id);
    const date = normalizeDate(req.body.date);
    const startTime = String(req.body.time || '').slice(0, 5);
    const notes = String(req.body.notes || '').trim().slice(0, 1000);

    if (clientName.length < 2 || phone.length < 8 || !barberId || !serviceId || !date || timeToMinutes(startTime) === null) {
      return apiError(res, 400, 'Completá correctamente los datos de la reserva.');
    }
    if (date < DateTime.now().setZone(ZONE).toISODate()) return apiError(res, 400, 'No se puede reservar en una fecha pasada.');

    await client.query('BEGIN');
    const validation = await validateBookingSlot(client, { barberId, serviceId, date, startTime });
    if (validation.error) {
      await client.query('ROLLBACK');
      return apiError(res, 409, validation.error);
    }

    const clientResult = await client.query(
      `INSERT INTO clients (name, phone)
       VALUES ($1, $2)
       ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
       RETURNING id, name, phone`,
      [clientName, phone]
    );

    const appointment = await client.query(
      `INSERT INTO appointments
        (client_id, barber_id, service_id, appointment_date, start_time, end_time, price_snapshot, status, notes)
       VALUES ($1, $2, $3, $4, $5::time, $6::time, $7, 'pendiente', $8)
       RETURNING id, appointment_date, start_time::text, end_time::text, price_snapshot, status`,
      [clientResult.rows[0].id, barberId, serviceId, date, startTime, validation.endTime, validation.item.price, notes || null]
    );

    await client.query(
      `INSERT INTO appointment_status_history (appointment_id, from_status, to_status)
       VALUES ($1, NULL, 'pendiente')`,
      [appointment.rows[0].id]
    );
    await client.query('COMMIT');

    res.status(201).json({
      ...appointment.rows[0],
      service_name: validation.item.service_name,
      barber_name: validation.item.barber_name,
      client_name: clientName
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
});

app.post('/api/admin/login', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const result = await query('SELECT id, name, email, password_hash FROM admin_users WHERE email = $1 AND active = TRUE', [email]);
    const admin = result.rows[0];
    if (!admin || !(await bcrypt.compare(password, admin.password_hash))) return apiError(res, 401, 'Correo o contraseña incorrectos.');
    res.json({ token: signAdmin(admin), user: { id: admin.id, name: admin.name, email: admin.email } });
  } catch (error) { next(error); }
});

app.get('/api/admin/me', requireAdmin, (req, res) => res.json({ user: req.admin }));

app.get('/api/admin/dashboard', requireAdmin, async (req, res, next) => {
  try {
    const today = DateTime.now().setZone(ZONE).toISODate();
    const monthStart = DateTime.now().setZone(ZONE).startOf('month').toISODate();
    const [todayStats, monthStats] = await Promise.all([
      query(`SELECT COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE status = 'pendiente')::int AS pendientes,
                    COUNT(*) FILTER (WHERE status = 'confirmado')::int AS confirmados,
                    COUNT(*) FILTER (WHERE status = 'atendido')::int AS atendidos
               FROM appointments WHERE appointment_date = $1`, [today]),
      query(`SELECT COUNT(*) FILTER (WHERE status = 'atendido')::int AS cortes,
                    COALESCE(SUM(price_snapshot) FILTER (WHERE status = 'atendido'), 0)::numeric AS ingresos
               FROM appointments WHERE appointment_date BETWEEN $1 AND $2`, [monthStart, today])
    ]);
    res.json({ today: todayStats.rows[0], month: monthStats.rows[0] });
  } catch (error) { next(error); }
});

app.get('/api/admin/barbers', requireAdmin, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT b.id, b.name, b.phone, b.bio, b.active,
              COALESCE(json_agg(json_build_object('weekday', s.weekday, 'start_time', s.start_time::text, 'end_time', s.end_time::text, 'slot_minutes', s.slot_minutes, 'active', s.active) ORDER BY s.weekday)
                       FILTER (WHERE s.id IS NOT NULL), '[]'::json) AS schedules
         FROM barbers b
         LEFT JOIN barber_schedules s ON s.barber_id = b.id
        GROUP BY b.id ORDER BY b.name`
    );
    res.json(result.rows);
  } catch (error) { next(error); }
});

app.post('/api/admin/barbers', requireAdmin, async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    if (name.length < 2) return apiError(res, 400, 'Nombre de barbero inválido.');
    const result = await query(
      `INSERT INTO barbers (name, phone, bio, active) VALUES ($1, $2, $3, $4)
       RETURNING id, name, phone, bio, active`,
      [name, String(req.body.phone || '').trim() || null, String(req.body.bio || '').trim() || null, req.body.active !== false]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) { next(error); }
});

app.put('/api/admin/barbers/:id', requireAdmin, async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const name = String(req.body.name || '').trim();
    if (!id || name.length < 2) return apiError(res, 400, 'Datos inválidos.');
    const result = await query(
      `UPDATE barbers SET name = $1, phone = $2, bio = $3, active = $4 WHERE id = $5
       RETURNING id, name, phone, bio, active`,
      [name, String(req.body.phone || '').trim() || null, String(req.body.bio || '').trim() || null, req.body.active !== false, id]
    );
    if (!result.rows[0]) return apiError(res, 404, 'Barbero no encontrado.');
    res.json(result.rows[0]);
  } catch (error) { next(error); }
});

app.put('/api/admin/barbers/:id/schedules', requireAdmin, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const barberId = parseId(req.params.id);
    const schedules = Array.isArray(req.body.schedules) ? req.body.schedules : [];
    if (!barberId) return apiError(res, 400, 'Barbero inválido.');

    await client.query('BEGIN');
    await client.query('DELETE FROM barber_schedules WHERE barber_id = $1', [barberId]);
    for (const schedule of schedules) {
      const weekday = Number(schedule.weekday);
      const slot = Number(schedule.slot_minutes || 30);
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || timeToMinutes(schedule.start_time) === null || timeToMinutes(schedule.end_time) === null) {
        throw new Error('Horario inválido.');
      }
      await client.query(
        `INSERT INTO barber_schedules (barber_id, weekday, start_time, end_time, slot_minutes, active)
         VALUES ($1, $2, $3::time, $4::time, $5, $6)`,
        [barberId, weekday, schedule.start_time, schedule.end_time, slot, schedule.active !== false]
      );
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally { client.release(); }
});

app.get('/api/admin/barbers/:id/time-off', requireAdmin, async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const result = await query('SELECT id, off_date, reason FROM barber_time_off WHERE barber_id = $1 ORDER BY off_date DESC', [id]);
    res.json(result.rows);
  } catch (error) { next(error); }
});

app.post('/api/admin/barbers/:id/time-off', requireAdmin, async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const date = normalizeDate(req.body.date);
    if (!id || !date) return apiError(res, 400, 'Fecha inválida.');
    await query(
      `INSERT INTO barber_time_off (barber_id, off_date, reason) VALUES ($1, $2, $3)
       ON CONFLICT (barber_id, off_date) DO UPDATE SET reason = EXCLUDED.reason`,
      [id, date, String(req.body.reason || '').trim() || null]
    );
    res.status(201).json({ ok: true });
  } catch (error) { next(error); }
});

app.delete('/api/admin/barbers/:id/time-off/:timeOffId', requireAdmin, async (req, res, next) => {
  try {
    await query('DELETE FROM barber_time_off WHERE id = $1 AND barber_id = $2', [parseId(req.params.timeOffId), parseId(req.params.id)]);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.get('/api/admin/services', requireAdmin, async (req, res, next) => {
  try {
    const result = await query('SELECT id, name, description, duration_minutes, price, active FROM services ORDER BY id');
    res.json(result.rows);
  } catch (error) { next(error); }
});

app.post('/api/admin/services', requireAdmin, async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const duration = Number(req.body.duration_minutes);
    const price = money(req.body.price);
    if (name.length < 2 || !Number.isInteger(duration) || duration < 5 || price === null) return apiError(res, 400, 'Datos del servicio inválidos.');
    const result = await query(
      `INSERT INTO services (name, description, duration_minutes, price, active)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, description, duration_minutes, price, active`,
      [name, String(req.body.description || '').trim() || null, duration, price, req.body.active !== false]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) { next(error); }
});

app.put('/api/admin/services/:id', requireAdmin, async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const name = String(req.body.name || '').trim();
    const duration = Number(req.body.duration_minutes);
    const price = money(req.body.price);
    if (!id || name.length < 2 || !Number.isInteger(duration) || duration < 5 || price === null) return apiError(res, 400, 'Datos del servicio inválidos.');
    const result = await query(
      `UPDATE services SET name = $1, description = $2, duration_minutes = $3, price = $4, active = $5
       WHERE id = $6 RETURNING id, name, description, duration_minutes, price, active`,
      [name, String(req.body.description || '').trim() || null, duration, price, req.body.active !== false, id]
    );
    if (!result.rows[0]) return apiError(res, 404, 'Servicio no encontrado.');
    res.json(result.rows[0]);
  } catch (error) { next(error); }
});

app.get('/api/admin/appointments', requireAdmin, async (req, res, next) => {
  try {
    const where = [];
    const params = [];
    const add = (clause, value) => { params.push(value); where.push(clause.replace('?', `$${params.length}`)); };
    if (normalizeDate(req.query.date)) add('a.appointment_date = ?', req.query.date);
    if (normalizeDate(req.query.from)) add('a.appointment_date >= ?', req.query.from);
    if (normalizeDate(req.query.to)) add('a.appointment_date <= ?', req.query.to);
    if (STATUSES.includes(req.query.status)) add('a.status = ?', req.query.status);
    const barberId = parseId(req.query.barber_id);
    if (barberId) add('a.barber_id = ?', barberId);

    const result = await query(
      `SELECT a.id, a.appointment_date, a.start_time::text, a.end_time::text, a.price_snapshot, a.status, a.notes,
              a.whatsapp_reminder_sent_at, c.id AS client_id, c.name AS client_name, c.phone AS client_phone,
              b.id AS barber_id, b.name AS barber_name, s.id AS service_id, s.name AS service_name
         FROM appointments a
         JOIN clients c ON c.id = a.client_id
         JOIN barbers b ON b.id = a.barber_id
         JOIN services s ON s.id = a.service_id
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY a.appointment_date DESC, a.start_time DESC
        LIMIT 500`,
      params
    );
    res.json(result.rows);
  } catch (error) { next(error); }
});

app.patch('/api/admin/appointments/:id/status', requireAdmin, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = parseId(req.params.id);
    const status = String(req.body.status || '');
    if (!id || !STATUSES.includes(status)) return apiError(res, 400, 'Estado inválido.');

    await client.query('BEGIN');
    const current = await client.query('SELECT id, client_id, status FROM appointments WHERE id = $1 FOR UPDATE', [id]);
    if (!current.rows[0]) {
      await client.query('ROLLBACK');
      return apiError(res, 404, 'Turno no encontrado.');
    }
    const previous = current.rows[0].status;
    await client.query('UPDATE appointments SET status = $1 WHERE id = $2', [status, id]);
    await client.query(
      'INSERT INTO appointment_status_history (appointment_id, from_status, to_status, changed_by) VALUES ($1, $2, $3, $4)',
      [id, previous, status, Number(req.admin.sub)]
    );
    if (status === 'atendido') {
      await client.query(
        `UPDATE clients
            SET first_visit_at = COALESCE(first_visit_at, NOW()), last_visit_at = NOW()
          WHERE id = $1`,
        [current.rows[0].client_id]
      );
    }
    await client.query('COMMIT');
    res.json({ id, status });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally { client.release(); }
});

async function fetchAppointmentForReminder(id) {
  const result = await query(
    `SELECT a.id, a.appointment_date, a.start_time::text, a.status, c.name AS client_name, c.phone AS client_phone,
            b.name AS barber_name, s.name AS service_name
       FROM appointments a
       JOIN clients c ON c.id = a.client_id
       JOIN barbers b ON b.id = a.barber_id
       JOIN services s ON s.id = a.service_id
      WHERE a.id = $1`, [id]
  );
  return result.rows[0];
}

async function sendReminderForAppointment(appointment) {
  const response = await sendAppointmentReminder({
    phone: appointment.client_phone,
    clientName: appointment.client_name,
    dateLabel: formatDateEs(appointment.appointment_date),
    timeLabel: String(appointment.start_time).slice(0, 5),
    barberName: appointment.barber_name,
    serviceName: appointment.service_name
  });
  const messageId = response?.messages?.[0]?.id || null;
  await query(
    'UPDATE appointments SET whatsapp_reminder_sent_at = NOW(), whatsapp_message_id = $1 WHERE id = $2',
    [messageId, appointment.id]
  );
  return { messageId };
}

app.post('/api/admin/appointments/:id/reminder', requireAdmin, async (req, res, next) => {
  try {
    const appointment = await fetchAppointmentForReminder(parseId(req.params.id));
    if (!appointment) return apiError(res, 404, 'Turno no encontrado.');
    const result = await sendReminderForAppointment(appointment);
    res.json({ ok: true, ...result });
  } catch (error) {
    if (error.code === 'WHATSAPP_NOT_CONFIGURED') return apiError(res, 503, error.message);
    next(error);
  }
});

app.get('/api/admin/whatsapp/status', requireAdmin, (req, res) => {
  res.json({ configured: whatsappConfigured(), reminder_hours: Number(process.env.WHATSAPP_REMINDER_HOURS || 24) });
});

app.get('/api/admin/clients', requireAdmin, async (req, res, next) => {
  try {
    const search = String(req.query.search || '').trim();
    const params = search ? [`%${search}%`] : [];
    const result = await query(
      `SELECT c.id, c.name, c.phone, c.first_visit_at, c.last_visit_at,
              COUNT(a.id)::int AS total_turnos,
              COUNT(a.id) FILTER (WHERE a.status = 'atendido')::int AS cortes,
              COALESCE(SUM(a.price_snapshot) FILTER (WHERE a.status = 'atendido'), 0)::numeric AS total_gastado
         FROM clients c
         LEFT JOIN appointments a ON a.client_id = c.id
         ${search ? 'WHERE c.name ILIKE $1 OR c.phone ILIKE $1' : ''}
        GROUP BY c.id ORDER BY c.name LIMIT 300`,
      params
    );
    res.json(result.rows);
  } catch (error) { next(error); }
});

app.get('/api/admin/clients/:id/history', requireAdmin, async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const clientResult = await query('SELECT id, name, phone, notes, first_visit_at, last_visit_at FROM clients WHERE id = $1', [id]);
    if (!clientResult.rows[0]) return apiError(res, 404, 'Cliente no encontrado.');
    const history = await query(
      `SELECT a.id, a.appointment_date, a.start_time::text, a.status, a.price_snapshot,
              b.name AS barber_name, s.name AS service_name
         FROM appointments a
         JOIN barbers b ON b.id = a.barber_id
         JOIN services s ON s.id = a.service_id
        WHERE a.client_id = $1
        ORDER BY a.appointment_date DESC, a.start_time DESC`, [id]
    );
    res.json({ client: clientResult.rows[0], appointments: history.rows });
  } catch (error) { next(error); }
});

app.get('/api/admin/reports', requireAdmin, async (req, res, next) => {
  try {
    const now = DateTime.now().setZone(ZONE);
    const from = normalizeDate(req.query.from) || now.startOf('month').toISODate();
    const to = normalizeDate(req.query.to) || now.toISODate();
    if (from > to) return apiError(res, 400, 'El rango de fechas es inválido.');

    const [summary, byBarber, byService, daily] = await Promise.all([
      query(`SELECT COUNT(*)::int AS total_turnos,
                    COUNT(*) FILTER (WHERE status = 'atendido')::int AS cortes,
                    COUNT(*) FILTER (WHERE status = 'cancelado')::int AS cancelados,
                    COALESCE(SUM(price_snapshot) FILTER (WHERE status = 'atendido'), 0)::numeric AS ingresos
               FROM appointments WHERE appointment_date BETWEEN $1 AND $2`, [from, to]),
      query(`SELECT b.id, b.name,
                    COUNT(a.id) FILTER (WHERE a.status = 'atendido')::int AS cortes,
                    COALESCE(SUM(a.price_snapshot) FILTER (WHERE a.status = 'atendido'), 0)::numeric AS ingresos
               FROM barbers b
               LEFT JOIN appointments a ON a.barber_id = b.id AND a.appointment_date BETWEEN $1 AND $2
              GROUP BY b.id ORDER BY ingresos DESC`, [from, to]),
      query(`SELECT s.id, s.name,
                    COUNT(a.id) FILTER (WHERE a.status = 'atendido')::int AS cortes,
                    COALESCE(SUM(a.price_snapshot) FILTER (WHERE a.status = 'atendido'), 0)::numeric AS ingresos
               FROM services s
               LEFT JOIN appointments a ON a.service_id = s.id AND a.appointment_date BETWEEN $1 AND $2
              GROUP BY s.id ORDER BY cortes DESC`, [from, to]),
      query(`SELECT appointment_date,
                    COUNT(*) FILTER (WHERE status = 'atendido')::int AS cortes,
                    COALESCE(SUM(price_snapshot) FILTER (WHERE status = 'atendido'), 0)::numeric AS ingresos
               FROM appointments
              WHERE appointment_date BETWEEN $1 AND $2
              GROUP BY appointment_date ORDER BY appointment_date`, [from, to])
    ]);

    res.json({ from, to, summary: summary.rows[0], by_barber: byBarber.rows, by_service: byService.rows, daily: daily.rows });
  } catch (error) { next(error); }
});

async function reminderWorker() {
  if (!whatsappConfigured()) return;
  try {
    const now = DateTime.now().setZone(ZONE);
    const maxDate = now.plus({ days: 2 }).toISODate();
    const result = await query(
      `SELECT a.id, a.appointment_date, a.start_time::text, a.status, c.name AS client_name, c.phone AS client_phone,
              b.name AS barber_name, s.name AS service_name
         FROM appointments a
         JOIN clients c ON c.id = a.client_id
         JOIN barbers b ON b.id = a.barber_id
         JOIN services s ON s.id = a.service_id
        WHERE a.status IN ('pendiente', 'confirmado')
          AND a.whatsapp_reminder_sent_at IS NULL
          AND a.appointment_date BETWEEN $1 AND $2
        ORDER BY a.appointment_date, a.start_time`,
      [now.toISODate(), maxDate]
    );

    const reminderHours = Number(process.env.WHATSAPP_REMINDER_HOURS || 24);
    for (const appointment of result.rows) {
      const at = DateTime.fromISO(`${appointment.appointment_date}T${appointment.start_time}`, { zone: ZONE });
      const diffHours = at.diff(now, 'hours').hours;
      if (diffHours > 0 && diffHours <= reminderHours) {
        try {
          await sendReminderForAppointment(appointment);
          console.log(`Recordatorio WhatsApp enviado para turno #${appointment.id}`);
        } catch (error) {
          console.error(`No se pudo enviar recordatorio #${appointment.id}:`, error.message);
        }
      }
    }
  } catch (error) {
    console.error('Error del worker de recordatorios:', error.message);
  }
}

app.use('/api', (req, res) => apiError(res, 404, 'Endpoint no encontrado.'));

app.use((error, req, res, next) => {
  console.error(error);
  const message = process.env.NODE_ENV === 'production' ? 'Error interno del servidor.' : error.message;
  apiError(res, 500, message);
});

(async () => {
  try {
    await query('SELECT 1');
    await ensureInitialAdmin();
    app.listen(PORT, () => console.log(`Barbería GB en http://localhost:${PORT}`));
    setInterval(reminderWorker, 10 * 60 * 1000);
    setTimeout(reminderWorker, 15 * 1000);
  } catch (error) {
    console.error('No se pudo iniciar la aplicación:', error.message);
    process.exit(1);
  }
})();
