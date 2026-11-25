import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/lib/stockRules.js', 'utf8');
const { detectProductLength, detectProductWidth, sortLengthKeys } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

test('detectProductLength separates 1.05m profiles without affecting 1.05xL sheet dimensions', () => {
  assert.equal(detectProductLength({ category: 'PERFILES', name: 'PC PERFIL A 4-6 CLEAR 1,05', sku: '114046501' }), '1.05m');
  assert.equal(detectProductLength({ category: 'PERFILES', name: 'PC PERFIL U 8-10 OPAL 1.05', sku: '114057703' }), '1.05m');
  assert.equal(detectProductLength({ category: 'PERFILES', name: 'PC PERFIL AF 4-6 BRONCE 1,05m', sku: '114136502' }), '1.05m');

  assert.equal(detectProductLength({ category: 'ALVEOLAR', name: 'PC ALVEOLAR 4 1.05x2.90 CLEAR', sku: '113216401' }), '2.90m');
  assert.equal(detectProductLength({ category: 'ALVEOLAR', name: 'PC ALVEOLAR 4 1.05x1.00 CLEAR', sku: '113222401' }), '1.0m');
  assert.equal(detectProductLength({ category: 'ALVEOLAR', name: 'PC ALVEOLAR 4 1.05x2.00 CLEAR', sku: '113246401' }), '2.0m');

  assert.deepEqual(sortLengthKeys(['2.0m', '1.05m', '1.0m', '1.5m']), ['1.0m', '1.05m', '1.5m', '2.0m']);
});

test('detectProductWidth separates sheet widths like 1.05m and 2.10m', () => {
  assert.equal(detectProductWidth({ category: 'ALVEOLAR', name: 'PC ALVEOLAR 4 1.05x2.90 CLEAR', sku: '113216401' }), '1.05m');
  assert.equal(detectProductWidth({ category: 'ALVEOLAR', name: 'PC ALVEOLAR 4 2.10x2.90 CLEAR', sku: '113215401' }), '2.10m');
  assert.equal(detectProductWidth({ category: 'ALVEOLAR', name: 'PC ALVEOLAR 6 1.00x3,00 CLEAR', sku: '1132228501' }), '1.0m');
  assert.equal(detectProductWidth({ category: 'COMPACTO', name: 'PC COMPACTO 4MM 2.05x3.00 CLEAR', sku: '1' }), '2.05m');
  assert.equal(detectProductWidth({ category: 'ONDULADAS', name: 'PC ONDULADO D 0,81x2,00 CLEAR', sku: '2' }), '0.81m');
  assert.equal(detectProductWidth({ category: 'PLANCHAS METALICAS', name: 'MICRO ONDULADO PP 0,40x976xNNN', sku: '620063' }), null);
  assert.equal(detectProductWidth({ category: 'PERFILES', name: 'PC PERFIL A 4-6 CLEAR 1,05', sku: '114046501' }), null);
});
