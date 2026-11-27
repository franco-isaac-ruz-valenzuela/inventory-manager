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

export function incrementQuoteNumber(value) {
  const text = String(value ?? '').trim();
  const match = text.match(/^(.*?)(\d+)$/);
  if (!match) return '1';
  const [, prefix, digits] = match;
  const next = String(Number(digits) + 1).padStart(digits.length, '0');
  return `${prefix}${next}`;
}

export function quotationLineTotals(item) {
  const quantity = Number(String(item.quantity ?? '').replace(',', '.'));
  const price = Number(item.price);
  const rawDiscount = item.discount === '' || item.discount === undefined || item.discount === null ? 0 : Number(String(item.discount).replace(',', '.'));
  const hasCodeOrName = Boolean(String(item.sku ?? '').trim() || String(item.name ?? '').trim());
  if (!hasCodeOrName || String(item.price ?? '').trim() === '' || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1e9 ||
    !Number.isSafeInteger(price) || price < 0 || price > 1e9 ||
    !Number.isFinite(rawDiscount) || rawDiscount < 0 || rawDiscount > 100) {
    throw new Error('Revisa los productos: código o nombre, cantidad positiva, precio neto en pesos enteros y descuento entre 0% y 100%.');
  }
  const gross = Math.round(quantity * price);
  const discountAmount = Math.round(gross * (rawDiscount / 100));
  const net = gross - discountAmount;
  return { gross, discountPct: rawDiscount, discountAmount, net };
}

export function buildPurchaseChanges(items, products) {
  const bySku = new Map();
  for (const product of products || []) {
    const skuKey = String(product?.sku ?? '').trim().toUpperCase();
    if (skuKey && product?.id) bySku.set(skuKey, product);
  }

  const aggregated = new Map();
  const unmatchedSkus = [];

  for (const item of items || []) {
    const skuText = String(item?.sku ?? '').trim();
    const nameText = String(item?.name ?? '').trim();
    const priceText = String(item?.price ?? '').trim();
    if (!skuText && !nameText && (priceText === '' || Number(priceText) === 0)) continue;

    const quantity = Number(String(item?.quantity ?? '').replace(',', '.'));
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1e9) {
      throw new Error(`Cantidad inválida para "${skuText || nameText || 'producto'}".`);
    }

    const match = skuText ? bySku.get(skuText.toUpperCase()) : null;
    if (!match) {
      unmatchedSkus.push(skuText || nameText || 'SIN CÓDIGO');
      continue;
    }

    const existing = aggregated.get(match.id);
    if (existing) {
      existing.quantity += quantity;
    } else {
      aggregated.set(match.id, { product: match, quantity });
    }
  }

  const changes = [];
  for (const { product, quantity } of aggregated.values()) {
    const available = Number(product.quantity ?? 0);
    if (available < quantity) {
      throw new Error(`Stock insuficiente para ${product.sku} (disponible: ${available}, solicitado: ${quantity}).`);
    }
    changes.push({
      id: product.id,
      kind: 'delta',
      delta: -quantity,
      expectedQuantity: available,
    });
  }

  return { changes, unmatchedSkus };
}

export function buildWhatsAppQuoteText({
  quoteNumber,
  quoteDate,
  customer,
  validityDays = '03',
  items = [],
  totals = { net: 0, tax: 0, total: 0 },
}) {
  const clp = value => `$${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(value || 0))}`;
  const lines = [
    `*Presupuesto N° ${String(quoteNumber ?? '').trim() || '-'}* (${quoteDate || ''})`,
    customer ? `*Cliente:* ${customer.trim()}` : null,
    '',
  ].filter(v => v !== null);

  for (const item of items) {
    const sku = String(item?.sku ?? '').trim();
    const name = String(item?.name ?? '').trim();
    const price = String(item?.price ?? '').trim();
    if (!sku && !name && (price === '' || Number(price) === 0)) continue;
    let net = 0;
    let discountPct = 0;
    try {
      const calc = quotationLineTotals(item);
      net = calc.net;
      discountPct = calc.discountPct;
    } catch {
      continue;
    }
    const label = name || sku;
    const dctoTag = discountPct > 0 ? ` (-${discountPct}%)` : '';
    lines.push(`• ${item.quantity}x ${label}${dctoTag}: ${clp(net)}`);
  }

  lines.push(
    '',
    `*Neto:* ${clp(totals.net)}`,
    `*IVA (19%):* ${clp(totals.tax)}`,
    `*TOTAL:* ${clp(totals.total)}`,
    `Validez: ${String(validityDays || '03').trim()} días.`
  );
  return lines.join('\n');
}

export function quotationTotals(items) {
  if (!items.length) throw new Error('Agrega al menos un producto.');
  const net = items.reduce((sum, item) => sum + quotationLineTotals(item).net, 0);
  if (!Number.isSafeInteger(net) || net > 1e12) throw new Error('El total excede el máximo permitido.');
  const tax = Math.round(net * 0.19);
  return { net, tax, total: net + tax };
}
