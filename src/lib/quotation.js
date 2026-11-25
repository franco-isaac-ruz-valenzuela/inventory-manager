export function normalizeRut(value) {
  const text = String(value ?? '').trim().replace(/\./g, '').toUpperCase();
  if (!/^\d{7,8}-?[\dK]$/.test(text)) return null;
  const raw = text.replace('-', '');
  const body = raw.slice(0, -1);
  if (/^0+$/.test(body)) return null;
  let sum = 0;
  let factor = 2;
  for (const digit of [...body].reverse()) {
    sum += Number(digit) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const result = 11 - sum % 11;
  const dv = result === 11 ? '0' : result === 10 ? 'K' : String(result);
  return dv === raw.at(-1) ? `${body}-${dv}` : null;
}

// Orientación por descripción, no certificación ni clasificación oficial del SII.
export function classifyActivities(value) {
  if (Array.isArray(value)) {
    const hardware = value.some(activity => ['466302', '475201'].includes(activity.code) || /ferreter[ií]a/i.test(activity.description || ''));
    const construction = value.some(activity => /^(41|42|43)\d{4}$/.test(activity.code));
    if (hardware && construction) return 'Ferretería y constructora';
    if (hardware) return 'Ferretería';
    if (construction) return 'Constructora';
    return 'Sin determinar';
  }
  const text = String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const hardware = /\bferreteria\b/.test(text);
  const construction = /\b(constructoras?|construccion de|actividades[^\n]*de construccion)\b/.test(text) || text.trim() === 'ferreteria y construccion';
  if (hardware && construction) return 'Ferretería y constructora';
  if (hardware) return 'Ferretería';
  if (construction) return 'Constructora';
  return 'Sin determinar';
}

export function quotationTotals(items) {
  if (!items.length) throw new Error('Agrega al menos un producto.');
  const net = items.reduce((sum, item) => {
    const quantity = Number(String(item.quantity).replace(',', '.'));
    const price = Number(item.price);
    const hasCodeOrName = Boolean(String(item.sku ?? '').trim() || String(item.name ?? '').trim());
    if (!hasCodeOrName || String(item.price ?? '').trim() === '' || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1e9 ||
      !Number.isSafeInteger(price) || price < 0 || price > 1e9) {
      throw new Error('Revisa los productos: código o nombre, cantidad positiva y precio neto en pesos enteros.');
    }
    return sum + Math.round(quantity * price);
  }, 0);
  if (!Number.isSafeInteger(net) || net > 1e12) throw new Error('El total excede el máximo permitido.');
  const tax = Math.round(net * 0.19);
  return { net, tax, total: net + tax };
}
