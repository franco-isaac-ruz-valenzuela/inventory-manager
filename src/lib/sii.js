export class SiiError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

const BASE = 'https://www2.sii.cl/app/stc/recurso/v1';

export function parseSiiData(data, rut) {
  if (!data || typeof data !== 'object' || data.captchaInvalido === true) {
    throw new SiiError('El SII requiere una verificación. Continúa la consulta en su sitio.', 409);
  }
  if (data.registrado === false) throw new SiiError('El RUT no figura registrado en el SII.', 404);
  const giros = data.girosNegocio == null && data.tieneGirosNegocio === false ? [] : data.girosNegocio;
  if (data.registrado !== true || typeof data.nombre !== 'string' || !data.nombre.trim() ||
    !Array.isArray(giros)) throw new SiiError('El SII devolvió un formato no reconocido. Intenta consultar en su sitio.');
  const activities = giros.map(activity => {
    if (!activity || typeof activity !== 'object') throw new SiiError('El SII devolvió una actividad no reconocida.');
    if (typeof activity.codigo !== 'string' || !/^\d{6}$/.test(activity.codigo) || typeof activity.descripcion !== 'string') {
      throw new SiiError('El SII devolvió actividades en un formato no reconocido.');
    }
    return { code: activity.codigo, description: activity.descripcion.trim(), startDate: String(activity.fechaInicio || '') };
  });
  return {
    rut, name: data.nombre.trim(), activities,
    startedActivities: typeof data.tieneInicio === 'boolean' ? data.tieneInicio : null,
    startDate: typeof data.fechaInicioActividades === 'string' ? data.fechaInicioActividades : '',
    consultedAt: typeof data.fechaConsulta === 'string' ? data.fechaConsulta : '',
  };
}

export async function consultSii(rut, fetcher = fetch) {
  const signal = AbortSignal.timeout(15000);
  const options = { cache: 'no-store', redirect: 'error', signal, headers: { Accept: 'application/json' } };
  try {
    const configuration = await fetcher(`${BASE}/recaptcha/key`, options);
    if (!configuration.ok) throw new SiiError('No se pudo iniciar la consulta del SII. Intenta nuevamente.');
    const config = await configuration.json();
    // Follow the public application's configuration; never bypass an enabled CAPTCHA.
    if (config.enable === true) throw new SiiError('El SII requiere una verificación. Continúa la consulta en su sitio.', 409);
    if (config.enable !== false) throw new SiiError('No se pudo verificar la disponibilidad de la consulta del SII.');
    const [body, dv] = rut.split('-');
    const response = await fetcher(`${BASE}/consulta/getConsultaData/`, {
      ...options, method: 'POST', headers: { ...options.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rut: body, dv, reAction: 'consultaSTC', reToken: ' ' }),
    });
    if ([403, 406, 429].includes(response.status)) throw new SiiError('El SII no permite completar la consulta automática ahora. Continúa en su sitio.', 409);
    if (!response.ok) throw new SiiError('El SII no está disponible en este momento. Intenta nuevamente.');
    return parseSiiData(await response.json(), rut);
  } catch (error) {
    if (error instanceof SiiError) throw error;
    throw new SiiError('No se pudo contactar al SII. Intenta nuevamente o consulta en su sitio.', 503);
  }
}
