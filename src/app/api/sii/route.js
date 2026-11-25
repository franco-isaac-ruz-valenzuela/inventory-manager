import { createHash } from 'node:crypto';
import { normalizeRut } from '../../../lib/quotation';
import { consultSii, SiiError } from '../../../lib/sii';

export const runtime = 'nodejs';
const requests = new Map();
const reply = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return reply({ error: 'Origen no permitido.' }, 403);
  const token = request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9._-]{100,8192})$/)?.[1];
  if (!token) return reply({ error: 'Inicia sesión para consultar el SII.' }, 401);
  let rut;
  try {
    const body = await request.text();
    if (body.length > 200) return reply({ error: 'Solicitud demasiado extensa.' }, 413);
    rut = normalizeRut(JSON.parse(body).rut);
  } catch { return reply({ error: 'Solicitud inválida.' }, 400); }
  if (!rut) return reply({ error: 'Ingresa un RUT válido.' }, 400);
  const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!project) return reply({ error: 'El servicio no está configurado.' }, 503);
  try {
    // Firestore validates the token and applies the existing signedIn/authorized_users rules.
    const access = await fetch(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(project)}/databases/(default)/documents/products?pageSize=1&mask.fieldPaths=sku`, {
      headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000),
    });
    if ([401, 403].includes(access.status)) return reply({ error: 'Tu sesión no tiene acceso. Vuelve a iniciar sesión.' }, 403);
    if (!access.ok) return reply({ error: 'No se pudo verificar tu acceso. Intenta nuevamente.' }, 503);
    await access.body?.cancel();
    const now = Date.now();
    for (const [key, entry] of requests) if (entry.until <= now) requests.delete(key);
    const key = createHash('sha256').update(token).digest('hex');
    const entry = requests.get(key) || { until: now + 60000, count: 0 };
    if (entry.count >= 10 || requests.size >= 5000) return reply({ error: 'Espera un minuto antes de volver a consultar.' }, 429);
    entry.count += 1;
    requests.set(key, entry);
    return reply(await consultSii(rut));
  } catch (error) {
    if (error instanceof SiiError) return reply({ error: error.message }, error.status);
    return reply({ error: 'No se pudo completar la consulta. Intenta nuevamente.' }, 503);
  }
}
