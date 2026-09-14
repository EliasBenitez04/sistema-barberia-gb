# Sistema Barbería GB

Primera versión de un sistema web de agendamiento para una barbería.

## Funcionalidades V1

- Catálogo de servicios.
- Selección de barbero.
- Selección de fecha y hora.
- Validación de domingos cerrados.
- Bloqueo de doble reserva para el mismo barbero/fecha/hora.
- Registro de nombre, teléfono y nota del cliente.
- Listado de turnos registrados.
- Eliminación individual o total de turnos.
- Persistencia local usando `localStorage`.
- Diseño responsive para celular y computadora.

## Cómo probarlo

No necesita instalar dependencias.

1. Descargá o cloná el proyecto.
2. Abrí `index.html` en el navegador.

También podés levantar un servidor local:

```bash
python3 -m http.server 8080
```

Después visitá `http://localhost:8080`.

## Próximos pasos sugeridos

- Base de datos real.
- Panel de administración con inicio de sesión.
- Alta y edición de barberos.
- Horarios personalizados por barbero.
- Servicios y precios administrables.
- Estados de turno: pendiente, confirmado, atendido, cancelado.
- Recordatorios por WhatsApp.
- Historial de clientes.
- Reportes de ingresos y cantidad de cortes.
- Publicación en Internet.

## Nota

La V1 usa almacenamiento del navegador para que podamos validar rápidamente el flujo y el diseño antes de agregar infraestructura y autenticación.
