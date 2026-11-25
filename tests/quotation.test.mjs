import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source = fs.readFileSync('src/lib/quotation.js', 'utf8');
const { normalizeRut, classifyActivities, quotationTotals } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
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
