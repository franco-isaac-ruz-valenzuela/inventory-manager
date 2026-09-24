/**
 * Configuración centralizada de umbrales de Stock Bajo por Categoría
 * Reglas de negocio personalizadas:
 * - Accesorios: < 5 uds
 * - Onduladas / Greca: < 50 uds
 * - Compacto: < 3 uds
 * - Industrial: < 20 uds
 * - Perfiles: < 100 uds
 * - Rollos: < 5 uds
 * - Alveolares: < 50 uds
 * - Pinturas y adhesivos: IGNORADAS (nunca alertan)
 * - Otras categorías: < 5 uds por defecto
 */

export const CATEGORY_THRESHOLDS_INFO = [
  { name: 'Perfiles', threshold: 100, pattern: 'PERFIL' },
  { name: 'Onduladas', threshold: 50, pattern: 'ONDULAD' },
  { name: 'Alveolares', threshold: 50, pattern: 'ALVEOLAR' },
  { name: 'Industrial', threshold: 20, pattern: 'INDUSTRI' },
  { name: 'Rollos', threshold: 5, pattern: 'ROLLO' },
  { name: 'Accesorios', threshold: 5, pattern: 'ACCESORIO' },
  { name: 'Compacto', threshold: 3, pattern: 'COMPACT' },
];

export const DEFAULT_LOW_STOCK_THRESHOLD = 5;

/**
 * Retorna el umbral numérico de stock bajo para una categoría dada.
 * Retorna null si la categoría debe ignorarse (ej: pinturas).
 * @param {string} category 
 * @returns {number|null}
 */
export function getLowStockThreshold(category) {
  if (!category) return DEFAULT_LOW_STOCK_THRESHOLD;
  const upper = String(category).trim().toUpperCase();

  // Las pinturas se ignoran explícitamente
  if (upper.includes('PINTUR')) {
    return null;
  }

  // Reglas por categoría solicitadas por el usuario:
  if (upper.includes('PERFIL')) return 100;
  if (upper.includes('ONDULAD') || upper.includes('GRECA')) return 50;
  if (upper.includes('ALVEOLAR')) return 50;
  if (upper.includes('INDUSTRI')) return 20;
  if (upper.includes('ROLLO')) return 5;
  if (upper.includes('ACCESORIO')) return 5;
  if (upper.includes('COMPACT')) return 3;

  return DEFAULT_LOW_STOCK_THRESHOLD;
}

/**
 * Determina si un producto tiene stock bajo según las reglas de su categoría.
 * @param {Object} product - { category, quantity }
 * @returns {boolean}
 */
export function isLowStock(product) {
  if (!product) return false;
  const threshold = getLowStockThreshold(product.category);
  if (threshold === null) return false; // Categorías ignoradas (Pinturas)

  const qty = Number(product.quantity);
  // Si la cantidad no es un número válido, no marcarlo
  if (isNaN(qty)) return false;

  return qty < threshold;
}

/**
 * Retorna un texto descriptivo del umbral de la categoría (ej: "< 50 uds" o "Ignorado")
 * @param {string} category 
 * @returns {string}
 */
export function getThresholdDescription(category) {
  const t = getLowStockThreshold(category);
  if (t === null) return 'Sin alerta (ignorado)';
  return `< ${t} uds`;
}
