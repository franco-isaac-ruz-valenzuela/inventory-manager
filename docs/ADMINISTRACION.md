# Administración

## Permisos actuales

| Acción | Consulta autorizada | M. Silva | Franco |
| --- | --- | --- | --- |
| Consultar inventario, historial y reportes | Sí | Sí | Sí |
| Registrar conteo individual | Sí | Sí | Sí |
| Modificar/importar/eliminar stock | No | Sí | Sí |
| Aplicar conteo al inventario | No | Sí | Sí |
| Reiniciar/copiar todo/gestionar extras | No | Sí | Sí |
| Autorizar o revocar consultas | No | No | Sí |

Firestore controla permisos en el servidor. Ocultar botones no constituye protección.

Los editores se reconocen por UID exacto en `AuthContext.js`, `userAccess.js`
y `firestore.rules`; ver [SECURITY](../SECURITY.md). Un nombre o correo parecido
no concede edición. Recrear una cuenta puede cambiar su UID aunque mantenga correo.
Cambiar un editor exige verificar identidad, actualizar código/reglas, probar y publicar.

## Autorizar una consulta

1. Crear la cuenta por el procedimiento autorizado en Firebase Authentication.
2. Verificar correo y copiar el UID exacto; no compartir contraseñas.
3. Franco abre Usuarios, indica UID, correo y nombre y autoriza.
4. Comprobar ingreso y rechazo de modificaciones de stock.

Usuarios no crea cuentas ni comprueba automáticamente la correspondencia
UID/correo en Authentication. El administrador debe verificarla. Los accesos
y su auditoría se guardan en la misma transacción. Esta pantalla no convierte
consultas en editores. Un UID existente se gestiona desde su entrada de la lista.

## Revocar

Franco revoca desde Usuarios. Las reglas bloquean nuevas operaciones y la
aplicación observa la autorización para cerrar la sesión. No borra historial ni
copias/exportaciones ya descargadas. Entradas antiguas sin nombre/correo pueden
necesitar regularización administrativa porque la interfaz exige esos datos.

## Responsabilidades

Revisar accesos, negativos, diferencias y referencias repetidas; registrar
incidentes; mantener medios de recuperación de administradores y definir respaldos.
Confirmar el dominio productivo en Vercel: la dirección antigua de la descripción
de GitHub no se verificó como URL de esta versión.

No agregar una segunda bodega suponiendo que tendrá stock/permisos separados:
el modelo actual aún no implementa esa separación.
