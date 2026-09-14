# Sistema Barbería GB — V2

Sistema web de reservas y administración para barbería, con backend Node.js/Express y PostgreSQL.

## Funcionalidades

- Base de datos PostgreSQL (esquema compatible con PostgreSQL 9.5).
- Reservas públicas con disponibilidad real por duración del servicio.
- Prevención de solapamientos por barbero mediante transacción y advisory lock.
- Panel de administración con inicio de sesión JWT.
- Alta y edición de barberos.
- Horarios personalizados por barbero y día de la semana.
- Días libres por barbero disponibles en la API.
- Alta y edición de servicios, duración y precios.
- Estados de turno: `pendiente`, `confirmado`, `atendido`, `cancelado`.
- Historial de cambios de estado.
- Clientes unificados por número de teléfono e historial de turnos.
- Reportes de ingresos y cortes por período, barbero, servicio y día.
- Recordatorios manuales y automáticos mediante WhatsApp Cloud API de Meta.

## Requisitos

- Node.js 18 o superior.
- PostgreSQL 9.5 o superior.
- npm.

> PostgreSQL 9.5 funciona con el esquema de este proyecto, pero está fuera de soporte oficial desde 2021. Para producción conviene migrar a una versión soportada cuando sea posible.

## Instalación

```bash
npm install
cp .env.example .env
```

Editá `.env` con la conexión real a PostgreSQL y una clave JWT segura.

### Crear base de datos

Ejemplo:

```sql
CREATE DATABASE barberia_gb;
```

Luego ejecutá:

```bash
psql -U postgres -d barberia_gb -f db/schema.sql
psql -U postgres -d barberia_gb -f db/seed.sql
```

El primer administrador se crea automáticamente al iniciar el servidor si la tabla `admin_users` está vacía. Las credenciales salen de `ADMIN_EMAIL`, `ADMIN_PASSWORD` y `ADMIN_NAME` en `.env`.

### Iniciar

```bash
npm start
```

- Reservas: `http://localhost:3000/`
- Administración: `http://localhost:3000/admin.html`
- Salud/API: `http://localhost:3000/api/health`

## WhatsApp Cloud API

El módulo usa la API oficial de WhatsApp Cloud API. Configurá en `.env`:

```env
WHATSAPP_ENABLED=true
WHATSAPP_GRAPH_VERSION=vXX.X
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_ACCESS_TOKEN=...
WHATSAPP_TEMPLATE_NAME=appointment_reminder
WHATSAPP_TEMPLATE_LANG=es
WHATSAPP_REMINDER_HOURS=24
```

`WHATSAPP_GRAPH_VERSION` se deja explícitamente configurable porque Meta actualiza periódicamente las versiones de Graph API.

El template `appointment_reminder` debe existir y estar aprobado en WhatsApp Manager. El sistema envía cinco parámetros de cuerpo en este orden:

1. Nombre del cliente.
2. Fecha del turno.
3. Hora.
4. Nombre del barbero.
5. Servicio.

El worker revisa cada 10 minutos los turnos pendientes/confirmados próximos y marca el recordatorio como enviado para evitar duplicados. También se puede disparar manualmente desde el panel.

## Estructura

```text
.
├── public/
│   ├── admin.html
│   ├── admin.js
│   ├── app.js
│   ├── index.html
│   └── styles.css
├── package.json
├── .env.example
├── db/
│   ├── schema.sql
│   └── seed.sql
└── src/
    ├── auth.js
    ├── db.js
    ├── server.js
    └── whatsapp.js
```

## Datos y reportes

Los ingresos se calculan únicamente con turnos en estado `atendido`. El precio queda copiado en el turno (`price_snapshot`) para que los reportes históricos no cambien si luego se modifica el precio del servicio.

## Seguridad mínima incluida

- Contraseñas con bcrypt.
- JWT para rutas administrativas.
- Consultas SQL parametrizadas.
- `.env` ignorado por Git.
- Validaciones de IDs, fechas, estados y horarios.

Antes de publicar en Internet se recomienda agregar HTTPS, rate limiting, backups automáticos, rotación de secretos y una política de actualización de PostgreSQL/Node.js.
