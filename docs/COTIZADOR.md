# Cotizador

El apartado `/cotizador` permite preparar un borrador con productos del inventario (buscados u ordenados por código SKU o nombre, usando el código como campo principal y la descripción como campo opcional) o ingresados manualmente, precios netos en CLP, cantidades, IVA del 19% y total. Los precios se ingresan manualmente; no existen tarifas diferenciadas configuradas para los giros. No descuenta existencias ni escribe registros en Firestore. El borrador se conserva solamente mientras el apartado está abierto. Para conservarlo, usar Imprimir / guardar PDF.

## Consulta del cliente

El RUT se valida localmente mediante módulo 11. El botón Consultar RUT en SII (o Enter en el campo RUT) consulta `/api/sii` con la sesión de Firebase y completa razón social, inicio de actividades, fecha de consulta y actividades económicas vigentes. El detalle muestra códigos, descripciones y fechas. Al cambiar el RUT se cancela la consulta anterior y se borran los datos asociados. Los errores permiten reintentar o abrir https://www2.sii.cl/stc/noauthz.

La clasificación sugerida usa los códigos de construcción de las divisiones 41, 42 y 43 y los giros de ferretería 466302 y 475201, además de descripciones explícitas de ferretería. La venta de materiales y el arriendo de maquinaria de construcción no bastan para clasificar como constructora. Para texto manual se usa una orientación por descripción. Puede mostrar ambos sectores o Sin determinar. Es una inferencia de la aplicación, no una clasificación oficial del SII. Si se editan manualmente la razón social o las actividades se retira la indicación de datos obtenidos del SII.

## Consulta directa

Se verificó el servicio utilizado por la página pública del SII el 18-10-2026 con un RUT de empresa: `/app/stc/recurso/v1/recaptcha/key` informa si exige CAPTCHA; cuando `enable` es exactamente `false`, se consulta `/app/stc/recurso/v1/consulta/getConsultaData/` con `rut`, `dv`, `reAction: consultaSTC` y `reToken` en blanco, como hace la página pública. Se extraen `nombre`, `tieneInicio`, `fechaInicioActividades`, `fechaConsulta` y `girosNegocio`.

Si el SII activa CAPTCHA, rechaza la solicitud o cambia el formato, se detiene la consulta automática y se muestra un error con acceso al sitio oficial. Esta interfaz usada por la web puede cambiar. No hay credenciales del SII ni servicios de terceros. Las solicitudes y respuestas no se guardan en caché. El servidor verifica acceso al inventario con el token y las reglas existentes de Firestore. Aplica un límite de diez consultas por minuto por token en cada instancia; el límite no es distribuido entre servidores. Hay plazos máximos para Firebase y SII y se descartan respuestas de consultas canceladas.

## Validación

Ejecutar `npm test` y `npm run build`.
