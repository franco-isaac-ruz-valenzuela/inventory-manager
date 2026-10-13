# Registro de cambios

Git conserva los archivos y commits exactos. La versión npm sigue en `1.0.0`;
no se inventan versiones retroactivas.

## 2026-10-12 — Documentación

- Índice, manual, administración, arquitectura/datos, despliegue, operación,
  recuperación, pruebas y planificación de privacidad/expansión.
- Límites y funciones pendientes; plantilla para próximos cambios.
- Cambio documental: no altera stock, permisos ni comportamiento.

## 2026-10-12 — Filtros contraíbles (`8fffc65`)

- Panel compartido entre Inventario y Conteo Físico; conserva selecciones al ocultar.
- Búsqueda y resumen visibles.
- Compilación correcta y estado de despliegue Vercel exitoso.

## 2026-10-12 — Integridad y operación (`45c389a`)

- Transacciones para stock, auditoría, recibos de nota y conciliaciones.
- Rechazo de duplicados y cantidades absolutas desactualizadas; copia de bajas.
- Validación de cantidades/planillas e importaciones atómicas con límites.
- Editores por UID; consultas autorizadas y administración por Franco.
- Conteo conserva entradas pendientes y ordena guardados.
- Historial paginado, filtros por familia/medida/color e interfaz sobria.
- Salidas de build/dev separadas localmente y salida estándar en Vercel.
- Dependencias actualizadas y cabeceras de seguridad.
- Evidencia de esa revisión: 3 pruebas de validación y 12 de seguridad aprobadas,
  compilación correcta y auditoría de dependencias sin avisos conocidos entonces.
- Reglas publicadas en `leker-inventario`; código publicado por GitHub/Vercel.
- El usuario confirmó que el conteo funciona en su uso real.

## Antecedentes

- `6aca462`: identificación visible de M. Silva como Jefe de Bodega.
- `f2d0ff4`: botones de edición móvil.
- `f366faf`: sincronización y persistencia anterior del conteo.

Estos antecedentes provienen de mensajes Git; no se reconstruyen fechas ni
pruebas que no se registraron en esta revisión.
