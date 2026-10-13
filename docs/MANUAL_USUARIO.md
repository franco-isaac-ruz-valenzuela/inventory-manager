# Manual de uso de bodega

## Ingreso

Usar el enlace de producción confirmado por el encargado e ingresar con correo
y contraseña. Una cuenta de Authentication también debe estar autorizada en el
sistema. Consulta puede leer y contar; los editores pueden modificar stock.

## Inventario y filtros

Buscar por SKU o descripción. **Mostrar** abre los filtros de familia/tipo,
medida y color; pueden combinarse. Cambiar familia reinicia medida y color.
**Ocultar** conserva selecciones. El resumen muestra resultados; **Limpiar filtros**
restablece el conjunto. El inventario también permite filtrar por stock.

Los editores agregan, editan, ajustan o eliminan productos. Diferenciar un ajuste
de **sumar/restar** de **establecer una cantidad fija**. Los ajustes usan el stock
vigente; una cantidad absoluta puede rechazarse si otro usuario cambió el producto.
Actualizar y revisar antes de volver a aplicarla.

Las cantidades aceptan coma o punto decimal y se redondean a dos decimales.
No usar separadores de miles. El stock negativo está permitido actualmente y
requiere revisión: no confirma existencia física. Eliminar guarda una copia en
Firestore; no hay botón de restauración automática.

## Notas de pedido

Seleccionar productos, cantidades y referencia; revisar antes de confirmar.
Stock, recibo y auditoría se guardan juntos o la operación se cancela. Una nota
ya aplicada se rechaza, incluso con diferencias de mayúsculas o espacios exteriores.
No cambiar el número para eludir el bloqueo: verificar primero el movimiento.

## Conteo físico

1. Verificar sesión/ciclo y buscar el material.
2. Registrar la cantidad encontrada físicamente.
3. Esperar **Conteo guardado en la nube**; un número visible pendiente no confirma guardado.
4. Revisar diferencias y guardar/exportar el reporte necesario.

El título automático refleja el día al entrar; los nombres personalizados se
conservan. El conteo se comparte entre dispositivos y no cambia por sí solo el
stock maestro. **Aplicar el conteo al inventario** es una operación separada de
edición que exige revisar las diferencias y el stock vigente.

Los guardados se ordenan por producto. Los incrementos leen la nube y los valores
absolutos desactualizados se rechazan. Ante un error, mantener la pantalla, leer
el aviso y consultar al encargado; no asumir que cerrar el navegador conserva
valores pendientes. El borrador local es una contingencia, no un respaldo completo.

Reiniciar, copiar todo el stock o gestionar productos extras requiere edición y
afecta a la sesión compartida. Guardar el reporte necesario antes de reiniciar.

## Excel y comparaciones

Preparar SKU, nombre/descripción, categoría y cantidad. Revisar el mapeo de columnas.
El lector usa la primera hoja y acepta hasta 10 MB. Las filas vacías se ignoran;
cantidades inválidas se rechazan. Los SKU duplicados se consolidan sin distinguir
mayúsculas: revisar el resultado antes de confirmar.

| Modo | Efecto |
| --- | --- |
| Actualizar/agregar (`upsert`) | Establece cantidades y crea productos nuevos |
| Solo nuevos (`only_new`) | Omite productos existentes |
| Sumar stock (`add_stock`) | Suma cantidades al stock vigente |
| Reemplazar (`replace`) | Actualiza/crea y elimina productos ausentes del archivo |

Máximo por operación: 100 productos modificados y 5 eliminaciones. Superar el
límite cancela la operación antes de escribir. Dividir una importación exige
revisar las partes: no forman una única transacción. **Sumar stock** no tiene la
protección de referencia duplicada de las notas; verificar antes de repetirlo.

Comparar Excel contrasta planillas y permite guardar/exportar resultados. Comparar
no equivale a aplicar automáticamente cantidades al inventario maestro.

## Escáner, reportes e historial

La cámara requiere permiso y navegador compatible; utilizar HTTPS en producción
o localhost en desarrollo. Hay ingreso manual. Revisar el producto antes de ajustar.

Reportes reúne sesiones guardadas. Historial carga 50 registros por bloque:
**Cargar 50 anteriores** amplía la consulta y **Actualizar historial** vuelve a
lo reciente. Filtros y exportación incluyen solo lo cargado. Una operación múltiple
permite desplegar sus movimientos.

Las notificaciones son auxiliares: si falta una alerta, revisar el movimiento
antes de repetir una operación.
