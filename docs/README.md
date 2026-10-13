# Documentación LEKER

Revisión: 12 de octubre de 2026. Código de referencia: `45c389a` y `8fffc65`.
Los documentos describen la implementación actual; las propuestas se identifican
como pendientes. No constituyen una certificación legal.

| Documento | Destinatario y contenido |
| --- | --- |
| [Manual de uso](MANUAL_USUARIO.md) | Personal de bodega: inventario, conteo, Excel, escáner e historial |
| [Administración](ADMINISTRACION.md) | Encargados: cuentas, permisos y responsabilidades |
| [Arquitectura](ARQUITECTURA.md) | Desarrollo: componentes, datos y transacciones |
| [Despliegue](DESPLIEGUE.md) | Instalación, Firebase, GitHub y Vercel |
| [Operación](OPERACION.md) | Mantenimiento, incidentes, respaldos y recuperación |
| [Pruebas y cambios](PRUEBAS_Y_CAMBIOS.md) | Verificación y documentación de versiones |
| [Privacidad y evolución](PRIVACIDAD_Y_EVOLUCION.md) | Decisiones de empresa y ampliación nacional |
| [Registro de cambios](../CHANGELOG.md) | Cambios importantes |
| [Seguridad](../SECURITY.md) | Controles implementados |

## Alcance

Control interno de materiales de una bodega: un inventario y una sesión de
conteo compartidos. No emite documentos tributarios ni reemplaza la contabilidad.
Las notas de pedido son referencias operativas. No hay aislamiento por sucursal.

GitHub conserva código; Firebase guarda datos; Vercel publica la web. Restaurar
código no restaura cantidades. Excel y el borrador local no son respaldos completos.

Actualizar documentación y CHANGELOG en el mismo cambio que afecte stock,
permisos, datos, despliegue o procedimientos. Usar la plantilla del documento de pruebas.
