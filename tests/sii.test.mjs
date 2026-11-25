import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source = fs.readFileSync('src/lib/sii.js', 'utf8');
const siiModule = 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const { consultSii, parseSiiData } = await import(siiModule);
const sample = { registrado: true, captchaInvalido: false, nombre: 'EMPRESA DE PRUEBA', tieneInicio: true, fechaInicioActividades: '01-01-2020', fechaConsulta: '18-10-2026', girosNegocio: [{ codigo: '475201', descripcion: 'VENTA AL POR MENOR DE ARTICULOS DE FERRETERIA', fechaInicio: '01-01-2020' }], observacion1: '<script>untrusted</script>' };

test('public SII lookup uses the observed request and returns only required fields', async () => {
  const calls = [];
  const result = await consultSii('97004000-5', async (url, options) => {
    calls.push({ url, options });
    return Response.json(calls.length === 1 ? { enable: false } : sample);
  });
  assert.equal(result.name, sample.nombre);
  assert.equal(result.activities[0].code, '475201');
  assert.equal(result.startedActivities, true);
  assert.equal(result.rut, '97004000-5');
  assert.equal('observacion1' in result, false);
  assert.deepEqual(JSON.parse(calls[1].options.body), { rut: '97004000', dv: '5', reAction: 'consultaSTC', reToken: ' ' });
  assert.equal(calls[0].options.cache, 'no-store');
});

test('enabled or unknown CAPTCHA configuration never triggers the contributor request', async () => {
  for (const config of [{ enable: true }, {}]) {
    let count = 0;
    await assert.rejects(consultSii('97004000-5', async () => { count++; return Response.json(config); }));
    assert.equal(count, 1);
  }
});

test('unregistered, challenge and invalid results never become customer records', () => {
  assert.throws(() => parseSiiData({ registrado: false }, '97004000-5'), error => error.status === 404);
  assert.throws(() => parseSiiData({ captchaInvalido: true }, '97004000-5'), error => error.status === 409);
  for (const data of [{}, { ...sample, nombre: '' }, { ...sample, girosNegocio: null }, { ...sample, girosNegocio: [{ codigo: 'x', descripcion: 'x' }] }]) assert.throws(() => parseSiiData(data, '97004000-5'));
  assert.equal(parseSiiData({ ...sample, girosNegocio: [], tieneInicio: false }, '97004000-5').activities.length, 0);
  assert.equal(parseSiiData({ ...sample, girosNegocio: null, tieneGirosNegocio: false }, '97004000-5').activities.length, 0);
});

test('SII network failures and upstream rejections produce actionable errors', async () => {
  await assert.rejects(consultSii('97004000-5', async () => { throw new Error('network'); }), error => error.status === 503);
  let count = 0;
  await assert.rejects(consultSii('97004000-5', async () => ++count === 1 ? Response.json({ enable: false }) : new Response('', { status: 406 })), error => error.status === 409);
});

test('API rejects unauthenticated, cross-origin and invalid-RUT requests before accessing services', async () => {
  const quotationModule = 'data:text/javascript;base64,' + Buffer.from(fs.readFileSync('src/lib/quotation.js', 'utf8')).toString('base64');
  const routeSource = fs.readFileSync('src/app/api/sii/route.js', 'utf8').replace("'../../../lib/quotation'", JSON.stringify(quotationModule)).replace("'../../../lib/sii'", JSON.stringify(siiModule));
  const { POST } = await import('data:text/javascript;base64,' + Buffer.from(routeSource).toString('base64'));
  assert.equal((await POST(new Request('https://example.com/api/sii', { method: 'POST' }))).status, 401);
  assert.equal((await POST(new Request('https://example.com/api/sii', { method: 'POST', headers: { Origin: 'https://other.com' } }))).status, 403);
  assert.equal((await POST(new Request('https://example.com/api/sii', { method: 'POST', headers: { Authorization: `Bearer ${'a'.repeat(100)}` }, body: JSON.stringify({ rut: 'invalid' }) }))).status, 400);
  const originalFetch = globalThis.fetch;
  const originalProject = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const makeRequest = () => new Request('https://example.com/api/sii', { method: 'POST', headers: { Authorization: `Bearer ${'a'.repeat(100)}` }, body: JSON.stringify({ rut: '97004000-5' }) });
  try {
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'test-project';
    let siiCalls = 0;
    globalThis.fetch = async url => {
      assert.match(url, /^https:\/\/firestore.googleapis.com\//);
      return new Response('', { status: 403 });
    };
    assert.equal((await POST(makeRequest())).status, 403);
    globalThis.fetch = async url => {
      if (url.startsWith('https://firestore.googleapis.com/')) return Response.json({});
      siiCalls++;
      if (url.endsWith('/recaptcha/key')) return Response.json({ enable: false });
      assert.ok(url.endsWith('/consulta/getConsultaData/'));
      return Response.json(sample);
    };
    const success = await POST(makeRequest());
    assert.equal(success.status, 200);
    assert.equal((await success.json()).name, sample.nombre);
    for (let index = 0; index < 9; index++) assert.equal((await POST(makeRequest())).status, 200);
    assert.equal((await POST(makeRequest())).status, 429);
    assert.equal(siiCalls, 20);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalProject === undefined) delete process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    else process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = originalProject;
  }
});
