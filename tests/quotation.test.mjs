import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source = fs.readFileSync('src/lib/quotation.js', 'utf8');
const { normalizeRut, classifyActivities, incrementQuoteNumber, buildPurchaseChanges, buildWhatsAppQuoteText, quotationLineTotals, quotationTotals } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
test('RUT checks digit and rejects malformed input', () => {
  assert.equal(normalizeRut('12.345.678-5'), '12345678-5');
  assert.equal(normalizeRut('123456785'), '12345678-5');
  for (const value of ['12.345.678-9', 'abc123456785', '', '00000000-0']) assert.equal(normalizeRut(value), null);
});
test('activity classification allows both sectors and unknown results', () => {
  assert.equal(classifyActivities('VENTA AL POR MENOR DE ARTÍCULOS DE FERRETERÍA'), 'Ferretería');
  assert.equal(classifyActivities('CONSTRUCCIÓN DE EDIFICIOS'), 'Constructora');
  assert.equal(classifyActivities('Ferretería y construcción'), 'Ferretería y constructora');
  assert.equal(classifyActivities('Servicios informáticos'), 'Sin determinar');
  assert.equal(classifyActivities('VENTA AL POR MENOR DE ARTICULOS DE FERRETERIA Y MATERIALES DE CONSTRUCCION'), 'Ferretería');
  assert.equal(classifyActivities([{ code: '475201', description: 'FERRETERIA Y MATERIALES DE CONSTRUCCION' }]), 'Ferretería');
  assert.equal(classifyActivities([{ code: '773002', description: 'ALQUILER DE MAQUINARIA DE CONSTRUCCION' }]), 'Sin determinar');
  assert.equal(classifyActivities([{ code: '410010', description: 'CONSTRUCCION DE EDIFICIOS' }]), 'Constructora');
  assert.equal(classifyActivities([{ code: '475201', description: 'FERRETERIA' }, { code: '439000', description: 'ACTIVIDADES ESPECIALIZADAS DE CONSTRUCCION' }]), 'Ferretería y constructora');
});
test('quotation rounds CLP lines and tax and rejects invalid financial inputs', () => {
  assert.deepEqual(quotationTotals([{ name: 'Producto', quantity: '2.5', price: '1000' }]), { net: 2500, tax: 475, total: 2975 });
  assert.deepEqual(quotationTotals([{ sku: 'SKU-001', name: '', quantity: '2', price: '1500' }]), { net: 3000, tax: 570, total: 3570 });
  for (const item of [{ quantity: 1, price: '' }, { quantity: -1, price: 1 }, { quantity: 1, price: -1 }, { quantity: 1, price: 1.5 }, { quantity: Infinity, price: 1 }]) {
    assert.throws(() => quotationTotals([{ name: 'Producto', ...item }]));
  }
  assert.throws(() => quotationTotals([{ sku: '', name: '', quantity: 1, price: 1000 }]));
  assert.throws(() => quotationTotals([]));
});

test('quotation line and total discounts match CLP rounding', () => {
  assert.deepEqual(
    quotationLineTotals({ sku: '113216401', name: 'PC ALVEOLAR 4 1.05x2.90 CLEAR', quantity: '1', price: '19046', discount: '42' }),
    { gross: 19046, discountPct: 42, discountAmount: 7999, net: 11047 }
  );
  assert.deepEqual(
    quotationTotals([
      { sku: '113216401', quantity: 1, price: 19046, discount: 42 },
      { sku: '113215401', quantity: 1, price: 38092, discount: 42 },
      { sku: '113216501', quantity: 1, price: 30568, discount: 42 },
      { sku: '113215501', quantity: 1, price: 61134, discount: 42 },
      { sku: '113214402', quantity: 1, price: 76183, discount: 40 },
    ]),
    { net: 132037, tax: 25087, total: 157124 }
  );
  assert.throws(() => quotationLineTotals({ sku: '113216401', quantity: 1, price: 19046, discount: 105 }));
  assert.throws(() => quotationLineTotals({ sku: '113216401', quantity: 1, price: 19046, discount: -5 }));
});

test('incrementQuoteNumber increments trailing digits and preserves padding', () => {
  assert.equal(incrementQuoteNumber('10262'), '10263');
  assert.equal(incrementQuoteNumber('009'), '010');
  assert.equal(incrementQuoteNumber('COT-0099'), 'COT-0100');
  assert.equal(incrementQuoteNumber(''), '1');
});

test('buildPurchaseChanges aggregates SKUs, validates stock and skips unmatched items', () => {
  const products = [
    { id: 'p1', sku: '113216401', name: 'PC ALVEOLAR', quantity: 10 },
    { id: 'p2', sku: '519001', name: 'BOLSA ONDA', quantity: 3 },
  ];
  const { changes, unmatchedSkus } = buildPurchaseChanges([
    { sku: '113216401', quantity: '2', price: '19046' },
    { sku: '113216401', quantity: '3', price: '19046' },
    { sku: '1', name: 'DESPACHO', quantity: '1', price: '29412' },
  ], products);
  assert.deepEqual(changes, [{ id: 'p1', kind: 'delta', delta: -5, expectedQuantity: 10 }]);
  assert.deepEqual(unmatchedSkus, ['1']);
  assert.throws(() => buildPurchaseChanges([{ sku: '519001', quantity: '5', price: '1000' }], products));
});

test('buildWhatsAppQuoteText formats client, items and CLP totals', () => {
  const text = buildWhatsAppQuoteText({
    quoteNumber: '10262',
    quoteDate: '27/11/2026',
    customer: 'Constructora Sur',
    validityDays: '03',
    items: [{ sku: '113216401', name: 'PC ALVEOLAR 4 1.05x2.90 CLEAR', quantity: '1', price: '19046', discount: '42' }],
    totals: { net: 11047, tax: 2099, total: 13146 },
  });
  assert.match(text, /Presupuesto N° 10262/);
  assert.match(text, /Constructora Sur/);
  assert.match(text, /1x PC ALVEOLAR 4 1\.05x2\.90 CLEAR \(-42%\): \$11\.047/);
  assert.match(text, /\*TOTAL:\* \$13\.146/);
});
