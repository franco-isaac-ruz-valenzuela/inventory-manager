# Seguridad del inventario

Los cambios locales deben publicarse junto con las reglas de Firestore. Cambiar
solo la interfaz no protege la base de datos. Las reglas locales no se activan
en Firebase hasta ejecutar el despliegue.

## Acceso

- Los editores se autorizan mediante UID exactos definidos en el código y las reglas.
- El administrador dispone de edición y gestión de accesos. Su UID también se
  define explícitamente; los nombres y correos parecidos no conceden permisos.
- Las demás cuentas deben tener un documento `authorized_users/{UID}` con
  `enabled: true`, creado desde Firebase Console o un entorno Admin confiable.
  Estas cuentas pueden consultar y registrar conteos individuales. El administrador puede
  autorizar y revocar consultas desde `/usuarios`; cada cambio exige una auditoría
  en la misma transacción. Los usuarios de consulta no pueden concederse permisos.
- Antes de publicar, registrar los UID de los usuarios de consulta que deben
  mantener acceso. No se autorizan automáticamente todas las cuentas existentes.

## Integridad

El stock, su auditoría y la nota de pedido se guardan en una misma transacción.
Los descuentos leen el stock vigente. Las modificaciones absolutas rechazan
valores desactualizados. Las notas de pedido normalizan su identificador para
evitar aplicar una misma nota dos veces. El historial y los recibos son
inmutables para los clientes. Las eliminaciones guardan un respaldo obligatorio.

Cada operación admite hasta 100 productos y hasta 5 eliminaciones, conservando
la atomicidad y los límites de acceso de las reglas. Las operaciones mayores
se rechazan antes de escribir; deben dividirse y revisarse explícitamente.
No dividir automáticamente una nota de pedido en operaciones parciales.
Se mantienen cantidades negativas porque el sistema ya las utiliza.

## Verificación y publicación

```powershell
npm.cmd test
npm.cmd run test:security
npm.cmd run build
npm.cmd audit
.\node_modules\.bin\firebase.cmd login
.\node_modules\.bin\firebase.cmd deploy --only firestore:rules --project ID_REAL_DEL_PROYECTO
```

Usar el proyecto que corresponde a `NEXT_PUBLIC_FIREBASE_PROJECT_ID` en
`.env.local`; no desplegar contra el proyecto de demostración de las pruebas.
Las pruebas utilizan exclusivamente `demo-leker-security` en el emulador local.
Requieren Java 21 y el puerto 8086 libre. Actualizar también el despliegue de la
aplicación con este código; clientes antiguos no cumplirán las reglas nuevas.

La revisión de dependencias no sustituye las copias de seguridad, el control de
las cuentas administradoras ni revisiones periódicas. Las credenciales Admin
nunca deben incluirse en variables NEXT_PUBLIC o en archivos publicados.

## Historial y conteo

El historial carga 50 registros por bloque con un cursor estable; actualizar lo
reinicia desde los más recientes. Los filtros y la exportación se aplican a los
registros cargados, sin afirmar que incluyen toda la base de datos.

El conteo conserva entradas locales mientras se guardan, serializa las peticiones
de cada producto y muestra los valores pendientes si falla la sincronización.
No se reemplazan silenciosamente por cero. El guardado rechaza sobrescrituras
desactualizadas y permite reintentar después de revisar los valores vigentes.

## Respaldos pendientes

El 12 de octubre de 2026 se confirmó que el proyecto revisado tiene la facturación
desactivada y no tiene respaldos nativos programados. No se activó facturación.
Firebase requiere facturación para sus respaldos nativos. Está pendiente elegir
entre respaldo local (depende del PC y la sesión) y respaldo nativo con costo.
Las exportaciones Excel y los borradores locales no sustituyen un respaldo completo.
