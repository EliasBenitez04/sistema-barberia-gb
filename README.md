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

La integración usa WhatsApp Cloud API de Meta e incluye:

- Envío manual de recordatorios desde cada turno.
- Recordatorios automáticos antes del turno.
- Confirmación automática opcional al crear una reserva.
- Mensaje de prueba independiente usando `hello_world`.
- Webhook para verificación de Meta.
- Recepción de estados `sent`, `delivered`, `read` y `failed`.
- Registro de mensajes entrantes y estados en `whatsapp_messages`.
- Pantalla **WhatsApp** dentro del panel administrador para probar y revisar eventos.

### Variables de entorno

Copiá las variables de `.env.example` a tu `.env` y completá como mínimo:

```env
WHATSAPP_ENABLED=true
WHATSAPP_GRAPH_VERSION=v26.0
WHATSAPP_PHONE_NUMBER_ID=TU_PHONE_NUMBER_ID
WHATSAPP_ACCESS_TOKEN=TU_ACCESS_TOKEN

WHATSAPP_TEST_TEMPLATE_NAME=hello_world
WHATSAPP_TEST_TEMPLATE_LANG=en_US

WHATSAPP_TEMPLATE_NAME=appointment_reminder
WHATSAPP_TEMPLATE_LANG=es
WHATSAPP_REMINDER_HOURS=24

WHATSAPP_WEBHOOK_VERIFY_TOKEN=un-token-secreto-que-elijas
WHATSAPP_APP_SECRET=APP_SECRET_DE_META
```

Para activar confirmaciones automáticas al reservar:

```env
WHATSAPP_CONFIRMATION_TEMPLATE_NAME=appointment_confirmation
WHATSAPP_CONFIRMATION_TEMPLATE_LANG=es
```

Si `WHATSAPP_CONFIRMATION_TEMPLATE_NAME` queda vacío, las reservas funcionan normalmente pero no se envía confirmación.

### Probar sin template personalizado

En una cuenta/número de prueba de Meta podés usar:

```env
WHATSAPP_TEST_TEMPLATE_NAME=hello_world
WHATSAPP_TEST_TEMPLATE_LANG=en_US
```

Luego iniciá el sistema, entrá a **Administración → WhatsApp**, escribí el número autorizado como destinatario con código de país (por ejemplo `595981123456`) y presioná **Enviar WhatsApp de prueba**.

### Confirmación obligatoria de la reserva

El flujo final de reservas es:

1. El cliente elige servicio, barbero, fecha y hora.
2. El sistema crea el turno como `pendiente` y bloquea temporalmente ese horario.
3. Se envía un template de WhatsApp con dos botones **Quick Reply**: **Confirmar turno** y **Cancelar turno**.
4. Si el cliente confirma, el webhook cambia el turno a `confirmado`.
5. Si cancela, cambia a `cancelado` y el horario vuelve a estar disponible.
6. Si no responde dentro de `WHATSAPP_CONFIRMATION_TIMEOUT_MINUTES`, el sistema cambia automáticamente el turno a `cancelado` y libera el horario.
7. Los recordatorios posteriores se envían solamente a turnos `confirmado`.

Configuración recomendada:

```env
WHATSAPP_CONFIRMATION_REQUIRED=true
WHATSAPP_CONFIRMATION_TIMEOUT_MINUTES=10
WHATSAPP_CONFIRMATION_TEMPLATE_NAME=appointment_confirmation
WHATSAPP_CONFIRMATION_TEMPLATE_LANG=es
```

El template `appointment_confirmation` debe tener cinco variables de cuerpo, en este orden:

1. Nombre del cliente.
2. Fecha.
3. Hora.
4. Barbero.
5. Servicio.

Y dos botones **Quick Reply**, en este orden:

1. `Confirmar turno`
2. `Cancelar turno`

Ejemplo de cuerpo:

```text
Hola {{1}}. Recibimos tu solicitud de turno en Barbería GB.

Fecha: {{2}}
Hora: {{3}}
Barbero: {{4}}
Servicio: {{5}}

Confirmá el turno antes de que venza la reserva temporal.
```

El sistema asigna internamente a esos botones los payloads `booking_confirm:<id>` y `booking_cancel:<id>`, por lo que el webhook sabe exactamente qué turno confirmar o liberar.

### Recordatorio de turno

El template `appointment_reminder` también utiliza cinco variables:

1. Nombre del cliente.
2. Fecha.
3. Hora.
4. Nombre del barbero.
5. Servicio.

Ejemplo:

```text
Hola {{1}}. Te recordamos tu turno en Barbería GB para el {{2}} a las {{3}},
con {{4}}. Servicio: {{5}}. Te esperamos.
```

### Webhook

El endpoint del proyecto es:

```text
GET/POST /api/webhooks/whatsapp
```

Para que Meta pueda llamarlo desde Internet necesitás publicar temporalmente tu servidor local mediante HTTPS (por ejemplo con un túnel) o desplegarlo en un servidor público.

En Meta configurá:

- **Callback URL:** `https://TU-DOMINIO/api/webhooks/whatsapp`
- **Verify token:** el mismo valor de `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
- Suscripción al campo **messages**.

Si definís `PUBLIC_BASE_URL=https://TU-DOMINIO`, el panel de administración muestra la URL completa del webhook.

`WHATSAPP_APP_SECRET` habilita validación de la firma `x-hub-signature-256` de los POST del webhook.

### Base de datos

En instalaciones nuevas, `db/schema.sql` ya incluye `whatsapp_messages`.

En una base existente podés ejecutar:

```bash
psql -U postgres -d barberia_gb -f db/migrations/002_whatsapp.sql
```

El servidor también crea automáticamente la tabla si todavía no existe.

### Automatización

El worker revisa cada 10 minutos los turnos `pendiente` o `confirmado`. Si faltan como máximo las horas definidas en `WHATSAPP_REMINDER_HOURS` y todavía no se envió recordatorio, envía el template configurado y guarda el ID de Meta para correlacionar los estados del webhook.

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
