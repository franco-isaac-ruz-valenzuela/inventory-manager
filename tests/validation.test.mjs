import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('src/lib/validation.js','utf8');
const validation=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
test('quantities preserve decimals and reject silent truncation or invalid inputs',()=>{
  assert.equal(validation.parseQuantity('2,5'),2.5);
  assert.equal(validation.parseQuantity('2.5'),2.5);
  for(const value of ['',null,'abc','10abc','Infinity','1.000,5',Infinity,1e20]) assert.throws(()=>validation.parseQuantity(value));
  assert.equal(validation.parseQuantityExpression('10+2,5-1'),11.5);
  assert.throws(()=>validation.parseQuantityExpression('10+evil()'));
});
test('product fields are bounded and required',()=>{
  assert.throws(()=>validation.validateProduct({sku:'',name:'Nombre',quantity:1}));
  assert.throws(()=>validation.validateProduct({sku:'SKU',name:'x'.repeat(201),quantity:1}));
  assert.equal(validation.validateProduct({sku:' A ',name:' B ',quantity:2}).sku,'A');
});
test('Excel normalization preserves SKU zero and decimal values; duplicates are consolidated case-insensitively',()=>{
  const excel=fs.readFileSync('src/lib/excelUtils.js','utf8');
  const functions=excel.slice(excel.indexOf('export function normalizeData'),excel.indexOf('function sanitizeCell')).replace(/export /g,'');
  const ctx={parseQuantity:validation.parseQuantity};
  vm.createContext(ctx); vm.runInContext(functions,ctx);
  const result=vm.runInContext("normalizeData([{sku:0,name:'A',qty:'2,5'}],{sku:'sku',name:'name',quantity:'qty'})",ctx);
  assert.equal(result[0].sku,'0');assert.equal(result[0].quantity,2.5);
  assert.throws(()=>vm.runInContext("normalizeData([{sku:'A',qty:'invalid'}],{sku:'sku',quantity:'qty'})",ctx));
  const comparison=vm.runInContext("compareInventories([{sku:'A',name:'A',quantity:1},{sku:'a',name:'A',quantity:2}],[{sku:'a',name:'A',quantity:3}])",ctx);
  assert.equal(comparison.summary.unchanged,1);assert.equal(comparison.differences.length,0);
});
