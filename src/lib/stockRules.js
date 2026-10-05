/**
 * Configuración centralizada de umbrales de Stock Bajo por Categoría
 * Reglas de negocio personalizadas:
 * - Accesorios: < 5 uds
 * - Onduladas: < 50 uds
 * - Compacto: < 3 uds
 * - Industrial: < 20 uds
 * - Perfiles: < 30 uds
 * - Rollos: < 5 uds
 * - Alveolares: < 50 uds
 * - Pinturas y adhesivos: IGNORADAS (nunca alertan)
 * - Todo lo de 8.70 / 8,70 en perfiles y planchas: IGNORADAS de stock (nunca alertan)
 * - CLEAR 0,81X1 y 001 - PC ONDULADO D y G 0,81X1: IGNORADAS de stock (nunca alertan)
 * - Otras categorías: < 5 uds por defecto
 */

export const CATEGORY_THRESHOLDS_INFO = [
  { name: 'Perfiles', threshold: 30, pattern: 'PERFIL' },
  { name: 'Onduladas', threshold: 50, pattern: 'ONDULAD' },
  { name: 'Alveolares', threshold: 50, pattern: 'ALVEOLAR' },
  { name: 'Industrial', threshold: 20, pattern: 'INDUSTRI' },
  { name: 'Rollos', threshold: 5, pattern: 'ROLLO' },
  { name: 'Accesorios', threshold: 5, pattern: 'ACCESORIO' },
  { name: 'Compacto', threshold: 3, pattern: 'COMPACT' },
];

export const DEFAULT_LOW_STOCK_THRESHOLD = 5;

/**
 * Determina si un producto o ítem debe ser ignorado en temas de alertas y cálculo de stock bajo:
 * 1. Pinturas y Adhesivos: ignoradas siempre (nunca alertan).
 * 2. Todo lo de 8.70 (o 8,70) en temas de perfiles y planchas: ignorado (ej: ALVEOLAR 8.70, PERFIL H 8,70, etc.).
 * 3. CLEAR 0,81X1 y 001 - PC ONDULADO D y G 0,81X1: ignorado (todas las variantes de 0,81X1 en Ondulado D y G, Clear/Bronce/Opal).
 * @param {Object|string} productOrCategory - Objeto producto o nombre de categoría
 * @param {Object} [productObj] - Objeto producto opcional si el primer parámetro fue categoría
 * @returns {boolean}
 */
export function isProductIgnoredFromStock(productOrCategory, productObj) {
  if (!productOrCategory && !productObj) return false;

  const product = typeof productOrCategory === 'object' && productOrCategory !== null
    ? productOrCategory
    : (productObj || {});

  const category = (
    typeof productOrCategory === 'string'
      ? productOrCategory
      : (product.category || '')
  ).trim().toUpperCase();

  const name = String(product.name || '').trim().toUpperCase();
  const sku = String(product.sku || '').trim().toUpperCase();
  const fullText = `${category} ${name} ${sku}`;

  // 1. Pinturas y adhesivos se ignoran explícitamente
  if (category.includes('PINTUR') || name.includes('PINTUR') || category.includes('ADHESIV') || name.includes('ADHESIV')) {
    return true;
  }

  // 2. Ignorar todo lo de 8.70 / 8,70 en temas de perfiles y planchas
  // (perfiles: H, A, AF, CLIP, etc.; planchas: ALVEOLAR, ONDULADAS, COMPACTO, INDUSTRIAL, PLANCHAS)
  const has870 = /8[.,]70/.test(fullText);
  const isPerfilOrPlancha =
    category.includes('PERFIL') ||
    category.includes('ALVEOLAR') ||
    category.includes('ONDULAD') ||
    category.includes('PLANCHA') ||
    category.includes('COMPACT') ||
    category.includes('INDUSTRI') ||
    name.includes('PERFIL') ||
    name.includes('ALVEOLAR') ||
    name.includes('ONDULAD') ||
    name.includes('PLANCHA') ||
    name.includes('COMPACT') ||
    name.includes('INDUSTRI');

  if (has870 && isPerfilOrPlancha) {
    return true;
  }

  // 3. CLEAR 0,81X1 y 001 - PC ONDULADO D y G 0,81X1
  // Coincide con cualquier dimensión 0,81X1 / 0.81X1 en PC ONDULADO (D, G, Clear, Bronce, Opal) o con prefijo 001
  const has081x1 = /0[.,]81\s*[xX*]\s*1(\b|[^\d]|$)/.test(fullText);
  if (has081x1) {
    const isOndulado = category.includes('ONDULAD') || name.includes('ONDULAD') || fullText.includes('ONDULAD');
    const hasClear = fullText.includes('CLEAR');
    const has001 = fullText.includes('001');
    const hasDyG = /D\s*(?:y|Y|&)\s*G/i.test(fullText) || /ONDULADO\s+[DG](\b|[^\w])/i.test(fullText);

    if (isOndulado || hasClear || has001 || hasDyG) {
      return true;
    }
  }

  // 4. Verificación explícita de código de familia 001 con PC ONDULADO
  if (fullText.includes('001') && (fullText.includes('ONDULAD') || /D\s*(?:y|Y|&)\s*G/i.test(fullText))) {
    if (has081x1 || fullText.includes('0,81') || fullText.includes('0.81')) {
      return true;
    }
  }

  return false;
}

// Alias para compatibilidad y semántica
export const isIgnoredFromStock = isProductIgnoredFromStock;

/**
 * Retorna el umbral numérico de stock bajo para una categoría o producto dado.
 * Retorna null si la categoría o producto debe ignorarse (ej: pinturas, 8.70 perfiles/planchas, CLEAR 0,81X1, 001 - PC ONDULADO D y G 0,81X1).
 * @param {string|Object} category - Nombre de categoría u objeto producto
 * @param {Object} [product] - Objeto producto opcional
 * @returns {number|null}
 */
export function getLowStockThreshold(category, product = null) {
  // Si se pasa un producto completo y debe ignorarse, retornar null
  if (product && isProductIgnoredFromStock(product)) {
    return null;
  }

  // Si el primer parámetro es el objeto producto
  if (typeof category === 'object' && category !== null) {
    if (isProductIgnoredFromStock(category)) return null;
    category = category.category;
  }

  if (!category) return DEFAULT_LOW_STOCK_THRESHOLD;
  const upper = String(category).trim().toUpperCase();

  // Las pinturas y adhesivos se ignoran explícitamente
  if (upper.includes('PINTUR') || upper.includes('ADHESIV')) {
    return null;
  }

  // Reglas por categoría solicitadas por el usuario:
  if (upper.includes('PERFIL')) return 30; // Los perfiles bajo 30 se alertan
  if (upper.includes('ONDULAD')) return 50;
  if (upper.includes('ALVEOLAR')) return 50;
  if (upper.includes('INDUSTRI')) return 20;
  if (upper.includes('ROLLO')) return 5;
  if (upper.includes('ACCESORIO')) return 5;
  if (upper.includes('COMPACT')) return 3;

  return DEFAULT_LOW_STOCK_THRESHOLD;
}

/**
 * Determina si un producto tiene stock bajo según las reglas de su categoría y exclusiones.
 * @param {Object} product - { category, name, sku, quantity }
 * @returns {boolean}
 */
export function isLowStock(product) {
  if (!product) return false;

  // Si el producto debe ignorarse en temas de stock:
  if (isProductIgnoredFromStock(product)) {
    return false;
  }

  const threshold = getLowStockThreshold(product.category, product);
  if (threshold === null) return false; // Categorías/productos ignorados

  const qty = Number(product.quantity);
  // Si la cantidad no es un número válido, no marcarlo
  if (isNaN(qty)) return false;

  return qty < threshold;
}

/**
 * Retorna un texto descriptivo del umbral de la categoría o producto (ej: "< 50 uds" o "Sin alerta (ignorado)")
 * @param {string|Object} category 
 * @param {Object} [product]
 * @returns {string}
 */
export function getThresholdDescription(category, product = null) {
  const prod = product || (typeof category === 'object' ? category : null);
  if (prod && isProductIgnoredFromStock(prod)) {
    return 'Sin alerta (ignorado)';
  }
  const t = getLowStockThreshold(category, product);
  if (t === null) return 'Sin alerta (ignorado)';
  return `< ${t} uds`;
}

/**
 * Helper para clasificar por Familia / Tipo Principal
 * @param {Object} p - Producto
 * @returns {'planchas'|'perfiles'|'accesorios'|'pinturas'|'otros'}
 */
export function getProductMainType(p) {
  const cat = (p?.category || '').toUpperCase();
  const name = (p?.name || '').toUpperCase();
  if (cat.includes('PERFIL') || name.includes('PERFIL')) return 'perfiles';
  if (cat.includes('PINTUR') || cat.includes('ADHESIV') || name.includes('PINTUR') || name.includes('SILICON')) return 'pinturas';
  if (cat.includes('ACCESORIO') || cat.includes('CANALETA') || name.includes('TORNILL') || name.includes('GOLILLA') || name.includes('CINTA') || name.includes('GANCHO') || name.includes('SOPORTE')) return 'accesorios';
  if (['ALVEOLAR', 'ONDULAD', 'INDUSTRI', 'COMPACT', 'PACK', 'ROLLO', 'PLANCHA'].some((k) => cat.includes(k) || name.includes(k))) return 'planchas';
  return 'otros';
}

/**
 * Helper para detectar tono / color del producto (Clear, Opal, Bronce)
 * @param {Object} p - Producto
 * @returns {'clear'|'opal'|'bronce'|null}
 */
export function detectProductColor(p) {
  const text = `${p?.name || ''} ${p?.sku || ''}`.toUpperCase();
  if (/\bOPAL\b/.test(text)) return 'opal';
  if (/\bBRONCE\b|\bBRONZ\b/.test(text)) return 'bronce';
  if (/\bCLEAR\b|\bCRISTAL\b|\bTRANSPARENTE\b/.test(text)) return 'clear';
  return null;
}

