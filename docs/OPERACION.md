# Operación y recuperación

## Rutina

Confirmar sesión/ciclo y responsables antes del conteo. Después, comprobar
guardado, diferencias y reporte. Revisar accesos, negativos y notas duplicadas.
Al reportar fallos, indicar fecha/hora, usuario, acción, SKU/referencia y mensaje;
no adjuntar contraseñas, tokens ni volcados personales completos.

| Problema | Respuesta |
| --- | --- |
| Permisos insuficientes | Verificar UID, proyecto, reglas y `enabled`; volver a iniciar sesión tras corregir |
| Conteo pendiente | Conservar pantalla y revisar aviso/conexión; no cerrar suponiendo guardado |
| Stock cambió | Actualizar y revisar el valor absoluto antes de volver a aplicar |
| Nota aplicada | Revisar recibo/auditoría; no cambiar número para duplicar descuento |
| Importación rechazada | Revisar datos y límites; confirmar cancelación completa |
| CSS/JS 404 local | Identificar puerto/servidor y reiniciar solo ese proceso; no borrar Firestore |
| Cámara indisponible | Permisos, HTTPS/localhost y compatibilidad; usar búsqueda manual |
| Historial incompleto | Cargar bloques; exportación/filtros abarcan lo cargado |

## Respaldos pendientes

El 12 de octubre de 2026 se comprobó facturación desactivada y ausencia de
respaldos nativos programados. Tampoco se implementó un respaldo local programado.
La empresa aún debe elegir la modalidad.

Excel no contiene todas las colecciones; el borrador del navegador puede perderse;
GitHub solo conserva código; `product_deletions` solo copia bajas individuales.
Ninguno sustituye un respaldo completo.

El plan debe definir responsable, frecuencia, ubicación protegida, retención,
verificación y prueba de restauración. Considerar Firestore, reglas/configuración
y recuperación separada de Authentication y archivos externos.
El respaldo local dependería del PC y sesión autorizada; el nativo requiere
facturación y tiene costo. No se activó ninguna modalidad.

## Recuperar un error

1. Pausar operaciones sobre materiales afectados y conservar evidencia.
2. Revisar historial y comprobar existencias físicas.
3. Corregir mediante un movimiento autorizado nuevo, preservando el error histórico.
4. Ante una baja, un administrador revisa `product_deletions` y referencias.
   No hay restauración automática; recrear puede no recuperar ID y relaciones.
5. Si hubiera respaldo completo, restaurar primero en un entorno aislado y verificar
   compatibilidad y movimientos posteriores antes de recuperar producción.

Revertir una versión de aplicación no recupera datos.

## Acceso comprometido

Revocar cuentas, revisar acceso administrativo a Firebase/Vercel/GitHub, conservar
evidencia y avisar al responsable empresarial. Evaluar datos afectados y obligaciones
aplicables; no inventar plazos de notificación ni certificar cumplimiento.

## Consumo

Revisar métricas reales: catálogo, usuarios, listeners, reglas y reportes influyen.
Las aperturas no bastan para estimar consumo. Almacenamiento se acumula;
operaciones y transferencia tienen cuotas distintas. Consultar valores vigentes
en [precios Firestore](https://firebase.google.com/docs/firestore/pricing).
