export const MAX_QUANTITY = 1000000000;

export function parseQuantity(value, label = 'Cantidad') {
  const text = typeof value === 'number' ? String(value) : String(value ?? '').trim();
  if (!/^[+-]?\d+(?:[.,]\d+)?$/.test(text)) {
    throw new Error(`${label}: ingresa un número válido, sin separadores de miles.`);
  }
  const quantity = Number(text.replace(',', '.'));
  if (!Number.isFinite(quantity) || Math.abs(quantity) > MAX_QUANTITY) {
    throw new Error(`${label}: cantidad fuera del rango permitido.`);
  }
  return Math.round(quantity * 100) / 100;
}

export function parseQuantityExpression(value) {
  const text = String(value ?? '').trim().replace(/,/g, '.').replace(/\s+/g, '');
  if (!/^[+-]?\d+(?:\.\d+)?(?:[+-]\d+(?:\.\d+)?)*$/.test(text)) {
    throw new Error('Ingresa una cantidad válida o una suma/resta, por ejemplo 10+2,5.');
  }
  return parseQuantity(text.match(/[+-]?\d+(?:\.\d+)?/g).reduce((sum, term) => sum + Number(term), 0));
}

export function validateProduct(product) {
  const sku = String(product.sku ?? '').trim();
  const name = String(product.name ?? '').trim();
  const category = String(product.category || 'SIN CATEGORÍA').trim().toUpperCase();
  if (!sku || sku.length > 100 || /[\u0000-\u001f]/.test(sku)) throw new Error('SKU inválido (máximo 100 caracteres).');
  if (!name || name.length > 200) throw new Error(`Nombre inválido para ${sku} (máximo 200 caracteres).`);
  if (!category || category.length > 100) throw new Error(`Categoría inválida para ${sku}.`);
  return { sku, name, category, quantity: parseQuantity(product.quantity, `Cantidad de ${sku}`) };
}
