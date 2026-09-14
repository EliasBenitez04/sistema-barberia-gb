-- Datos iniciales opcionales. El usuario administrador se crea desde variables de entorno.
INSERT INTO services (name, description, duration_minutes, price, active)
SELECT 'Corte clásico', 'Corte personalizado con terminación y styling.', 40, 50000, TRUE
WHERE NOT EXISTS (SELECT 1 FROM services WHERE name = 'Corte clásico');

INSERT INTO services (name, description, duration_minutes, price, active)
SELECT 'Corte + barba', 'Servicio completo de cabello y perfilado de barba.', 60, 75000, TRUE
WHERE NOT EXISTS (SELECT 1 FROM services WHERE name = 'Corte + barba');

INSERT INTO services (name, description, duration_minutes, price, active)
SELECT 'Barba', 'Perfilado, definición y terminación de barba.', 30, 35000, TRUE
WHERE NOT EXISTS (SELECT 1 FROM services WHERE name = 'Barba');

INSERT INTO barbers (name, active)
SELECT 'Barbero 1', TRUE
WHERE NOT EXISTS (SELECT 1 FROM barbers WHERE name = 'Barbero 1');

INSERT INTO barbers (name, active)
SELECT 'Barbero 2', TRUE
WHERE NOT EXISTS (SELECT 1 FROM barbers WHERE name = 'Barbero 2');

-- Lunes a sábado, 09:00-20:00, en intervalos de 30 minutos.
INSERT INTO barber_schedules (barber_id, weekday, start_time, end_time, slot_minutes, active)
SELECT b.id, d.weekday, '09:00'::time, '20:00'::time, 30, TRUE
FROM barbers b
CROSS JOIN (SELECT 1 AS weekday UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6) d
WHERE NOT EXISTS (
  SELECT 1 FROM barber_schedules s WHERE s.barber_id = b.id AND s.weekday = d.weekday
);
