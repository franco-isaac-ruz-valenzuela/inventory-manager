# Pruebas y gestión de cambios

```powershell
npm.cmd test
npm.cmd run test:security
npm.cmd run build
npm.cmd audit
```

## Cobertura actual

Tres pruebas en `tests/validation.test.mjs`: cantidades, campos de producto y
normalización/consolidación Excel. Doce pruebas en `tests/security.test.mjs`
usan las reglas reales y helpers de producción dentro del emulador:

- Conteo 563, rechazo de valor antiguo e incrementos simultáneos.
- Alta/revocación por el administrador con auditoría atómica.
- Rechazo de anónimos, identidades incorrectas y stock sin evidencia.
- UID del administrador independiente del proveedor del token.
- Dos descuentos: 10 pasa a 8 con registros inmutables.
- Rechazo de stock absoluto antiguo y reversión si falla auditoría.
- Notas aplicadas una sola vez; cancelación por producto ausente.
- Baja respaldada y operación de 100 productos.
- Protección de autores, reportes y notificaciones.
- Conteo de consulta sin reemplazo completo de sesión.

Se verificaron 15 pruebas durante los cambios del 12 de octubre de 2026.
No garantizan toda la interfaz, conectividad ni carga nacional. `npm audit` solo
informa avisos conocidos en ese momento. Java 21 y puerto 8086 libre son necesarios.
Identificar procesos si el puerto está ocupado; un fallo al iniciar el emulador
no es un resultado de reglas. No ejecutar estas pruebas contra producción.

## Verificación funcional en datos de prueba

Revisar login y revocación; filtros móvil/escritorio; descuentos concurrentes;
notas repetidas; conteo entre dispositivos y errores de conexión; importaciones
válidas/inválidas; historial de más de 50 registros; código y reglas del despliegue.
Un número pendiente no debe anunciarse como guardado. El usuario confirmó el
conteo en uso real; no se afirma validación exhaustiva de todas las bodegas.

## Plantilla para un cambio importante

```text
Título y fecha:
Responsable:
Necesidad o problema:
Comportamiento anterior y nuevo:
Módulos afectados:
Datos/permisos/procedimientos afectados:
Migración (o ninguna):
Pruebas realmente ejecutadas y resultados:
Limitaciones:
Publicación y reversión:
Commit y despliegue:
Documentación actualizada:
```

Actualizar CHANGELOG y documentos afectados en el mismo commit. Para datos/permisos,
incluir reglas, compatibilidad y pruebas. Los ajustes visuales pequeños no requieren
informes largos. Los cambios críticos deben ser revisables por otra persona.
Un flujo obligatorio de aprobación empresarial aún no está implementado.
