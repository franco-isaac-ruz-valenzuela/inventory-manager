import * as XLSX_LIB from 'xlsx-js-style';
import { isLowStock, getLowStockThreshold } from './stockRules.js';

// Manejo seguro de export por compatibilidad ESM / CJS / Next.js
const XLSX = XLSX_LIB.default || XLSX_LIB;

/**
 * Patrones para detectar si una fila contiene headers de tabla.
 * Usados tanto por parseExcelFile (detección de header row) como detectColumns.
 */
const HEADER_PATTERNS = {
  sku: /^(sku|codigo|código|cod\.?\s*producto|code|barcode|c[oó]digo.*(barra|producto)|id.*producto|item)/i,
  name: /^(nombre|name|descripci[oó]n|description|producto|product|art[ií]culo|item.?name)/i,
  qty: /^(cantidad|qty|quantity|stock\s*total|stock|existencia|disponible|unidades|units|cant)/i,
  category: /^(grupo|categor[ií]a|category|tipo|type|familia|family|l[ií]nea|secci[oó]n|section|class)/i,
};

/**
 * Detecta la fila de headers reales dentro de un array de arrays raw.
 * Útil para Excels tipo reporte ERP que tienen filas de título antes de la tabla real.
 */
function findHeaderRowIndex(rawRows) {
  for (let i = 0; i < Math.min(rawRows.length, 20); i++) {
    const row = rawRows[i];
    if (!row || row.length < 2) continue;
    const cells = row.map((c) => String(c || '').trim()).filter(Boolean);
    if (cells.length < 2) continue;

    let matches = 0;
    for (const cell of cells) {
      if (HEADER_PATTERNS.sku.test(cell)) matches++;
      else if (HEADER_PATTERNS.name.test(cell)) matches++;
      else if (HEADER_PATTERNS.qty.test(cell)) matches++;
    }
    if (matches >= 2) return i;
  }
  return -1;
}

/**
 * Filtra filas de totales intermedios de reportes ERP
 */
function isSummaryRow(row) {
  const first = String(row[0] || '').trim();
  return /^Total\s+(Sub\s+)?Grupo|^Total\s+Final/i.test(first);
}

/**
 * Lee un archivo Excel y retorna los datos como array de objetos JSON.
 * Detecta automáticamente la fila de headers reales incluso en reportes ERP.
 */
export function parseExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];

        const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
        const headerIdx = findHeaderRowIndex(rawRows);

        if (headerIdx > 0) {
          const headers = rawRows[headerIdx].map((h) => String(h || '').trim());
          const results = [];

          for (let i = headerIdx + 1; i < rawRows.length; i++) {
            const row = rawRows[i];
            if (!row || row.every((c) => c === '' || c === null || c === undefined)) continue;
            if (isSummaryRow(row)) continue;

            const obj = {};
            let hasValue = false;
            headers.forEach((h, j) => {
              if (h) {
                obj[h] = row[j] !== undefined ? row[j] : '';
                if (row[j] !== '' && row[j] !== undefined && row[j] !== null) hasValue = true;
              }
            });
            if (hasValue) results.push(obj);
          }

          resolve(results);
        } else {
          const json = XLSX.utils.sheet_to_json(worksheet);
          resolve(json);
        }
      } catch (error) {
        reject(new Error('Error al leer el archivo Excel: ' + error.message));
      }
    };
    reader.onerror = () => reject(new Error('Error al cargar el archivo'));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Detecta automáticamente las columnas de SKU, Nombre y Cantidad en los datos.
 */
export function detectColumns(data) {
  if (!data || data.length === 0) return null;

  const headers = Object.keys(data[0]);

  const skuCol = headers.find((h) => HEADER_PATTERNS.sku.test(h));
  const nameCol = headers.find((h) => HEADER_PATTERNS.name.test(h));
  const qtyCol = headers.find((h) => HEADER_PATTERNS.qty.test(h));
  const categoryCol = headers.find((h) => HEADER_PATTERNS.category.test(h));

  return {
    sku: skuCol || null,
    name: nameCol || null,
    quantity: qtyCol || null,
    category: categoryCol || null,
    allHeaders: headers,
    detected: !!(skuCol && qtyCol),
  };
}

/**
 * Normaliza los datos del Excel a un formato estándar
 */
export function normalizeData(data, columnMapping) {
  return data.map((row) => {
    const item = {
      sku: String(row[columnMapping.sku] || '').trim(),
      name: String(row[columnMapping.name] || '').trim(),
      quantity: parseInt(row[columnMapping.quantity]) || 0,
    };
    if (columnMapping.category) {
      item.category = String(row[columnMapping.category] || '').trim().toUpperCase() || 'SIN CATEGORÍA';
    }
    return item;
  });
}

/**
 * Consolida datos duplicados agrupando por SKU y sumando cantidades.
 */
export function consolidateDuplicates(normalizedData) {
  const skuMap = new Map();
  const duplicateDetails = [];

  for (const item of normalizedData) {
    const key = item.sku.toLowerCase();
    if (skuMap.has(key)) {
      const existing = skuMap.get(key);
      existing.quantity += item.quantity;
      if (item.name.length > existing.name.length) {
        existing.name = item.name;
      }
      duplicateDetails.push({
        sku: item.sku,
        name: existing.name,
        addedQty: item.quantity,
        totalQty: existing.quantity,
        occurrences: (existing._count || 1) + 1,
      });
      existing._count = (existing._count || 1) + 1;
    } else {
      skuMap.set(key, { ...item, _count: 1 });
    }
  }

  const consolidated = [];
  skuMap.forEach((item) => {
    const { _count, ...cleanItem } = item;
    consolidated.push(cleanItem);
  });

  return {
    consolidated,
    duplicatesFound: duplicateDetails.length,
    duplicateDetails,
  };
}

/**
 * Compara dos inventarios y genera las diferencias
 */
export function compareInventories(previousData, currentData) {
  const prevMap = new Map();
  previousData.forEach((item) => prevMap.set(item.sku, item));

  const currMap = new Map();
  currentData.forEach((item) => currMap.set(item.sku, item));

  const differences = [];
  let added = 0;
  let removed = 0;
  let changed = 0;
  let unchanged = 0;

  prevMap.forEach((prevItem, sku) => {
    const currItem = currMap.get(sku);
    if (!currItem) {
      differences.push({
        sku,
        name: prevItem.name,
        previousQty: prevItem.quantity,
        currentQty: 0,
        diff: -prevItem.quantity,
        status: 'eliminado',
      });
      removed++;
    } else if (prevItem.quantity !== currItem.quantity) {
      differences.push({
        sku,
        name: currItem.name || prevItem.name,
        previousQty: prevItem.quantity,
        currentQty: currItem.quantity,
        diff: currItem.quantity - prevItem.quantity,
        status: 'modificado',
      });
      changed++;
    } else {
      unchanged++;
    }
  });

  currMap.forEach((currItem, sku) => {
    if (!prevMap.has(sku)) {
      differences.push({
        sku,
        name: currItem.name,
        previousQty: 0,
        currentQty: currItem.quantity,
        diff: currItem.quantity,
        status: 'nuevo',
      });
      added++;
    }
  });

  const statusOrder = { eliminado: 0, modificado: 1, nuevo: 2 };
  differences.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

  return {
    differences,
    summary: {
      total: previousData.length + added,
      added,
      removed,
      changed,
      unchanged,
      totalDifferences: differences.length,
    },
  };
}

/**
 * Sanitiza celdas de texto para prevenir inyecciones en hojas de cálculo
 */
function sanitizeCell(val) {
  if (typeof val === 'string' && /^[=+\-@\t\r]/.test(val.trim())) {
    return `'${val}`;
  }
  return val;
}

/**
 * Formateo uniforme de fechas
 */
function formatDate(val) {
  if (!val) return '';
  try {
    if (val && typeof val.toDate === 'function') {
      return val.toDate().toLocaleString('es-AR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    }
    const d = new Date(val);
    if (!isNaN(d.getTime())) {
      return d.toLocaleString('es-AR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    }
  } catch (e) {}
  return String(val);
}

/* ==========================================================================
   SISTEMA DE DISEÑO PROFESIONAL CORPORATIVO (PALETA, FUENTES, BORDES)
   ========================================================================== */

const PALETTE = {
  // Brand Corporativo (Slate / Deep Navy)
  navyHero: '0F172A',      // Slate 900: Banner principal de título
  navySection: '1E293B',   // Slate 800: Subheaders y títulos de sección
  navyHeader: '334155',    // Slate 700: Headers de columnas de tablas
  navySubtitle: 'CBD5E1',  // Slate 300: Texto de subtítulos sobre navy

  // Textos
  textPrimary: '0F172A',   // Slate 900: Texto principal
  textSecondary: '334155', // Slate 700: Texto secundario
  textMuted: '64748B',     // Slate 500: Etiquetas y notas
  textWhite: 'FFFFFF',     // Blanco puro para fondos oscuros

  // Superficies y Zebra Striping
  white: 'FFFFFF',
  zebraEven: 'FFFFFF',
  zebraOdd: 'F8FAFC',      // Slate 50: Alternancia suave y legible
  cardBg: 'F1F5F9',        // Slate 100: Tarjetas de resumen
  subtotalBg: 'F1F5F9',    // Slate 100: Filas de subtotal

  // Bordes
  borderDelicate: 'E2E8F0', // Slate 200: Cuadrícula interna
  borderMedium: 'CBD5E1',   // Slate 300: Separadores de encabezados
  borderThick: '0F172A',    // Slate 900: Bordes dobles / énfasis

  // Semáforos / Estados (Fondo suave + Texto de alto contraste)
  successFill: 'ECFDF5',   // Emerald 50
  successText: '065F46',   // Emerald 800
  successBorder: 'A7F3D0',

  warningFill: 'FFFBEB',   // Amber 50
  warningText: '92400E',   // Amber 800
  warningBorder: 'FDE68A',

  dangerFill: 'FEF2F2',    // Rose 50
  dangerText: '991B1B',    // Rose 800
  dangerBorder: 'FECACA',

  infoFill: 'EFF6FF',      // Blue 50
  infoText: '1E40AF',      // Blue 800
  infoBorder: 'BFDBFE',

  purpleFill: 'FAF5FF',    // Purple 50
  purpleText: '6B21A8',    // Purple 800
  purpleBorder: 'E9D5FF',
};

// Paleta cromática por categoría
const CATEGORY_COLORS = {
  'ONDULADAS': { brand: '0891B2', tint: 'ECFEFF', text: '164E63' },
  'GRECA': { brand: '7C3AED', tint: 'F5F3FF', text: '5B21B6' },
  'ALVEOLAR': { brand: '059669', tint: 'ECFDF5', text: '065F46' },
  'PERFILES': { brand: 'D97706', tint: 'FFFBEB', text: '92400E' },
  'INDUSTRIAL': { brand: 'DC2626', tint: 'FEF2F2', text: '991B1B' },
  'PACK': { brand: '2563EB', tint: 'EFF6FF', text: '1E40AF' },
  'COMPACTO': { brand: 'DB2777', tint: 'FDF2F8', text: '9D174D' },
  'ACCESORIOS': { brand: '9333EA', tint: 'FAF5FF', text: '6B21A8' },
  'ROLLO': { brand: '0D9488', tint: 'F0FDFA', text: '115E59' },
  'MATERIAS PRIMAS': { brand: 'EA580C', tint: 'FFF7ED', text: '9A3412' },
  'PLANCHAS METALICAS': { brand: '475569', tint: 'F8FAFC', text: '1E293B' },
  'PINTURAS Y ADHESIVOS': { brand: '8B5CF6', tint: 'F5F3FF', text: '5B21B6' },
  'CANALETAS Y ACCESORIOS': { brand: '16A34A', tint: 'F0FDF4', text: '166534' },
  'OTROS': { brand: '64748B', tint: 'F8FAFC', text: '334155' },
  'SIN CATEGORÍA': { brand: '64748B', tint: 'F8FAFC', text: '334155' },
};

function getCategoryColor(cat) {
  return CATEGORY_COLORS[(cat || '').toUpperCase()] || { brand: '64748B', tint: 'F8FAFC', text: '334155' };
}

// Conjunto de bordes estandarizados
const BORDERS = {
  delicate: {
    top: { style: 'thin', color: { rgb: PALETTE.borderDelicate } },
    bottom: { style: 'thin', color: { rgb: PALETTE.borderDelicate } },
    left: { style: 'thin', color: { rgb: PALETTE.borderDelicate } },
    right: { style: 'thin', color: { rgb: PALETTE.borderDelicate } },
  },
  header: {
    top: { style: 'thin', color: { rgb: PALETTE.navySection } },
    bottom: { style: 'medium', color: { rgb: PALETTE.navyHero } },
    left: { style: 'thin', color: { rgb: PALETTE.navySection } },
    right: { style: 'thin', color: { rgb: PALETTE.navySection } },
  },
  subtotal: {
    top: { style: 'thin', color: { rgb: PALETTE.borderMedium } },
    bottom: { style: 'thin', color: { rgb: PALETTE.borderMedium } },
    left: { style: 'thin', color: { rgb: PALETTE.borderDelicate } },
    right: { style: 'thin', color: { rgb: PALETTE.borderDelicate } },
  },
  grandTotal: {
    top: { style: 'thin', color: { rgb: PALETTE.navyHero } },
    bottom: { style: 'double', color: { rgb: PALETTE.navyHero } },
    left: { style: 'thin', color: { rgb: PALETTE.borderDelicate } },
    right: { style: 'thin', color: { rgb: PALETTE.borderDelicate } },
  },
  card: {
    top: { style: 'thin', color: { rgb: PALETTE.borderMedium } },
    bottom: { style: 'thin', color: { rgb: PALETTE.borderMedium } },
    left: { style: 'thin', color: { rgb: PALETTE.borderMedium } },
    right: { style: 'thin', color: { rgb: PALETTE.borderMedium } },
  },
};

/**
 * Aplica estilos completos a una celda garantizando tipografía Calibri uniforme
 */
function applyCellStyle(ws, cellRef, style = {}) {
  if (!ws[cellRef]) {
    ws[cellRef] = { v: '', t: 's' };
  }
  const defaultFont = { name: 'Calibri', sz: 10, color: { rgb: PALETTE.textPrimary } };
  ws[cellRef].s = {
    ...style,
    font: {
      ...defaultFont,
      ...(style.font || {}),
    },
    alignment: {
      vertical: 'center',
      ...(style.alignment || {}),
    },
  };
  if (style.numFmt) {
    ws[cellRef].z = style.numFmt;
  }
}

/**
 * Aplica estilos a un rango completo de columnas en una fila dada
 */
function styleRowRange(ws, rowNum, startColIndex, endColIndex, style) {
  for (let c = startColIndex; c <= endColIndex; c++) {
    const ref = XLSX.utils.encode_cell({ r: rowNum, c });
    applyCellStyle(ws, ref, style);
  }
}

/**
 * Calcula anchos óptimos de columna con márgenes de seguridad para evitar celdas recortadas o "###"
 */
function autoFitColumns(ws, rows, customMinWidths = {}) {
  const colWidths = {};
  rows.forEach((row) => {
    row.forEach((cell, c) => {
      let len = 0;
      if (cell !== null && cell !== undefined) {
        len = String(cell).length;
      }
      if (!colWidths[c] || len > colWidths[c]) {
        colWidths[c] = len;
      }
    });
  });

  const cols = [];
  const maxCol = Math.max(...Object.keys(colWidths).map(Number), 0);
  for (let c = 0; c <= maxCol; c++) {
    const calculated = (colWidths[c] || 0) + 4;
    const minW = customMinWidths[c] || 12;
    cols.push({ wch: Math.min(Math.max(calculated, minW), 60) });
  }
  ws['!cols'] = cols;
}

/**
 * Helper para renderizar bloque de encabezado ejecutivo (Hero Banner + Subtitle Bar)
 */
function renderExecutiveHeader(rows, merges, title, subtitle, colSpan = 6) {
  const startRow = rows.length;
  const titleRow = new Array(colSpan).fill('');
  titleRow[0] = title;
  rows.push(titleRow);
  merges.push({ s: { r: startRow, c: 0 }, e: { r: startRow, c: colSpan - 1 } });

  const subRow = new Array(colSpan).fill('');
  subRow[0] = subtitle;
  rows.push(subRow);
  merges.push({ s: { r: startRow + 1, c: 0 }, e: { r: startRow + 1, c: colSpan - 1 } });

  // Espaciador
  rows.push(new Array(colSpan).fill(''));

  return { titleRowIdx: startRow, subRowIdx: startRow + 1, spacerRowIdx: startRow + 2 };
}

function applyExecutiveHeaderStyles(ws, titleRowIdx, subRowIdx, colSpan = 6, bannerColor = PALETTE.navyHero) {
  // Fila de Título
  styleRowRange(ws, titleRowIdx, 0, colSpan - 1, {
    font: { sz: 14, bold: true, color: { rgb: PALETTE.textWhite } },
    fill: { fgColor: { rgb: bannerColor } },
    alignment: { horizontal: 'center', vertical: 'center' },
  });

  // Fila de Subtítulo / Metadatos
  styleRowRange(ws, subRowIdx, 0, colSpan - 1, {
    font: { sz: 9.5, italic: true, color: { rgb: PALETTE.navySubtitle } },
    fill: { fgColor: { rgb: PALETTE.navySection } },
    alignment: { horizontal: 'center', vertical: 'center' },
  });
}

/* ==========================================================================
   1. EXPORTACIÓN DE INVENTARIO COMPLETO (exportInventoryToExcel)
   ========================================================================== */

/**
 * Genera y descarga un Excel con el inventario completo, estructurado con:
 * - Hoja 1: Resumen Ejecutivo con Tarjetas KPI y desglose por categoría
 * - Hoja 2: Inventario Completo organizado por secciones con semáforos y umbrales
 * - Hoja 3: Panel de Alertas Críticas (sin stock, stock bajo, stock negativo)
 * - Hojas 4+: Hojas individuales por cada categoría
 */
export function exportInventoryToExcel(products = [], filename = 'inventario.xlsx') {
  const wb = XLSX.utils.book_new();
  const now = formatDate(new Date());

  // Agrupamiento y métricas iniciales
  const categoryGroups = {};
  let totalProducts = 0;
  let totalUnits = 0;
  let totalAlerts = 0;
  let outOfStockCount = 0;
  let negativeCount = 0;

  products.forEach((p) => {
    const cat = (p.category || 'SIN CATEGORÍA').toUpperCase();
    if (!categoryGroups[cat]) categoryGroups[cat] = [];
    categoryGroups[cat].push(p);

    totalProducts++;
    const qty = Number(p.quantity) || 0;
    totalUnits += qty;

    const low = isLowStock(p);
    if (qty < 0) {
      negativeCount++;
      totalAlerts++;
    } else if (qty === 0) {
      outOfStockCount++;
      totalAlerts++;
    } else if (low) {
      totalAlerts++;
    }
  });

  const sortedCategories = Object.keys(categoryGroups).sort((a, b) => {
    if (a === 'SIN CATEGORÍA') return 1;
    if (b === 'SIN CATEGORÍA') return -1;
    return a.localeCompare(b);
  });

  // --------------------------------------------------------------------------
  // HOJA 1: RESUMEN EJECUTIVO
  // --------------------------------------------------------------------------
  const summaryRows = [];
  const summaryMerges = [];

  const { titleRowIdx: sumTitleIdx, subRowIdx: sumSubIdx } = renderExecutiveHeader(
    summaryRows,
    summaryMerges,
    'SISTEMA DE GESTIÓN DE INVENTARIO — RESUMEN EJECUTIVO',
    `Fecha de Emisión: ${now}  |  Catálogo Total: ${totalProducts} productos  |  Stock Consolidado: ${totalUnits.toLocaleString('es-AR')} unidades`,
    6
  );

  // Tarjetas KPI (Fila 4: Etiquetas, Fila 5: Valores)
  const kpiLabelRow = summaryRows.length;
  summaryRows.push([
    '📦 TOTAL PRODUCTOS',
    '',
    '📊 UNIDADES EN STOCK',
    '',
    '🏷️ CATEGORÍAS ACTIVAS',
    '⚠️ ALERTAS DE STOCK',
  ]);
  summaryMerges.push(
    { s: { r: kpiLabelRow, c: 0 }, e: { r: kpiLabelRow, c: 1 } },
    { s: { r: kpiLabelRow, c: 2 }, e: { r: kpiLabelRow, c: 3 } }
  );

  const kpiValRow = summaryRows.length;
  summaryRows.push([
    totalProducts,
    '',
    totalUnits,
    '',
    sortedCategories.length,
    totalAlerts,
  ]);
  summaryMerges.push(
    { s: { r: kpiValRow, c: 0 }, e: { r: kpiValRow, c: 1 } },
    { s: { r: kpiValRow, c: 2 }, e: { r: kpiValRow, c: 3 } }
  );

  // Espaciador
  summaryRows.push(['', '', '', '', '', '']);

  // Título de la tabla de categorías
  const catTableTitleRow = summaryRows.length;
  summaryRows.push(['DISTRIBUCIÓN Y ESTADO POR CATEGORÍA', '', '', '', '', '']);
  summaryMerges.push({ s: { r: catTableTitleRow, c: 0 }, e: { r: catTableTitleRow, c: 5 } });

  // Encabezados de tabla
  const catHeaderRow = summaryRows.length;
  summaryRows.push([
    'Categoría',
    'Cant. Productos',
    'Stock Total (Uds)',
    '% del Inventario',
    'Umbral de Alerta',
    'Estado General',
  ]);

  // Filas por categoría
  const catStartDataRow = summaryRows.length;
  sortedCategories.forEach((cat) => {
    const items = categoryGroups[cat];
    const catUnits = items.reduce((s, p) => s + (Number(p.quantity) || 0), 0);
    const pct = totalUnits > 0 ? catUnits / totalUnits : 0;
    const threshold = getLowStockThreshold(cat);
    const thresholdText = threshold === null ? 'Sin umbral (Ignorada)' : `< ${threshold} uds`;

    // Evaluar estado general
    const catAlerts = items.filter((p) => isLowStock(p) || (p.quantity || 0) <= 0).length;
    let statusText = '✔ Óptimo';
    if (catAlerts > 0) {
      statusText = `⚠ ${catAlerts} con alerta`;
    }

    summaryRows.push([cat, items.length, catUnits, pct, thresholdText, statusText]);
  });

  // Fila de Total General
  const catTotalRow = summaryRows.length;
  summaryRows.push([
    'TOTAL GENERAL',
    totalProducts,
    totalUnits,
    1.0,
    '-',
    totalAlerts > 0 ? `${totalAlerts} alertas activas` : '✔ Inventario Óptimo',
  ]);

  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary['!merges'] = summaryMerges;
  wsSummary['!views'] = [{ showGridLines: true }];

  // Estilos del Resumen
  applyExecutiveHeaderStyles(wsSummary, sumTitleIdx, sumSubIdx, 6);

  // Estilos Tarjetas KPI
  const cardConfigs = [
    { startC: 0, endC: 1, fill: PALETTE.cardBg, text: PALETTE.navyHero, numFmt: '#,##0' },
    { startC: 2, endC: 3, fill: PALETTE.infoFill, text: PALETTE.infoText, numFmt: '#,##0' },
    { startC: 4, endC: 4, fill: PALETTE.purpleFill, text: PALETTE.purpleText, numFmt: '#,##0' },
    { startC: 5, endC: 5, fill: totalAlerts > 0 ? PALETTE.dangerFill : PALETTE.successFill, text: totalAlerts > 0 ? PALETTE.dangerText : PALETTE.successText, numFmt: '#,##0' },
  ];

  cardConfigs.forEach(({ startC, endC, fill, text, numFmt }) => {
    for (let c = startC; c <= endC; c++) {
      // Label
      applyCellStyle(wsSummary, XLSX.utils.encode_cell({ r: kpiLabelRow, c }), {
        font: { sz: 8.5, bold: true, color: { rgb: PALETTE.textMuted } },
        fill: { fgColor: { rgb: fill } },
        alignment: { horizontal: 'center' },
        border: BORDERS.card,
      });
      // Value
      applyCellStyle(wsSummary, XLSX.utils.encode_cell({ r: kpiValRow, c }), {
        font: { sz: 16, bold: true, color: { rgb: text } },
        fill: { fgColor: { rgb: fill } },
        alignment: { horizontal: 'center' },
        border: BORDERS.card,
        numFmt,
      });
    }
  });

  // Título tabla categorías
  styleRowRange(wsSummary, catTableTitleRow, 0, 5, {
    font: { sz: 11, bold: true, color: { rgb: PALETTE.textWhite } },
    fill: { fgColor: { rgb: PALETTE.navySection } },
    alignment: { horizontal: 'left' },
  });

  // Headers tabla categorías
  styleRowRange(wsSummary, catHeaderRow, 0, 5, {
    font: { sz: 10, bold: true, color: { rgb: PALETTE.textWhite } },
    fill: { fgColor: { rgb: PALETTE.navyHeader } },
    alignment: { horizontal: 'center' },
    border: BORDERS.header,
  });

  // Filas de categorías
  sortedCategories.forEach((cat, idx) => {
    const r = catStartDataRow + idx;
    const catColor = getCategoryColor(cat);
    const isOdd = idx % 2 === 1;
    const rowFill = isOdd ? PALETTE.zebraOdd : PALETTE.zebraEven;

    // Col A: Categoría
    applyCellStyle(wsSummary, XLSX.utils.encode_cell({ r, c: 0 }), {
      font: { sz: 10, bold: true, color: { rgb: catColor.text || PALETTE.textPrimary } },
      fill: { fgColor: { rgb: rowFill } },
      alignment: { horizontal: 'left' },
      border: BORDERS.delicate,
    });
    // Col B: Cant. Productos
    applyCellStyle(wsSummary, XLSX.utils.encode_cell({ r, c: 1 }), {
      font: { sz: 10 },
      fill: { fgColor: { rgb: rowFill } },
      alignment: { horizontal: 'right' },
      border: BORDERS.delicate,
      numFmt: '#,##0',
    });
    // Col C: Stock Total
    applyCellStyle(wsSummary, XLSX.utils.encode_cell({ r, c: 2 }), {
      font: { sz: 10, bold: true },
      fill: { fgColor: { rgb: rowFill } },
      alignment: { horizontal: 'right' },
      border: BORDERS.delicate,
      numFmt: '#,##0',
    });
    // Col D: % del Inventario
    applyCellStyle(wsSummary, XLSX.utils.encode_cell({ r, c: 3 }), {
      font: { sz: 10 },
      fill: { fgColor: { rgb: rowFill } },
      alignment: { horizontal: 'right' },
      border: BORDERS.delicate,
      numFmt: '0.0%',
    });
    // Col E: Umbral
    applyCellStyle(wsSummary, XLSX.utils.encode_cell({ r, c: 4 }), {
      font: { sz: 9.5, color: { rgb: PALETTE.textSecondary } },
      fill: { fgColor: { rgb: rowFill } },
      alignment: { horizontal: 'center' },
      border: BORDERS.delicate,
    });
    // Col F: Estado General
    const items = categoryGroups[cat];
    const catAlerts = items.filter((p) => isLowStock(p) || (p.quantity || 0) <= 0).length;
    applyCellStyle(wsSummary, XLSX.utils.encode_cell({ r, c: 5 }), {
      font: { sz: 9.5, bold: true, color: { rgb: catAlerts > 0 ? PALETTE.warningText : PALETTE.successText } },
      fill: { fgColor: { rgb: catAlerts > 0 ? PALETTE.warningFill : PALETTE.successFill } },
      alignment: { horizontal: 'center' },
      border: BORDERS.delicate,
    });
  });

  // Fila Total General
  applyCellStyle(wsSummary, XLSX.utils.encode_cell({ r: catTotalRow, c: 0 }), {
    font: { sz: 11, bold: true, color: { rgb: PALETTE.navyHero } },
    fill: { fgColor: { rgb: PALETTE.cardBg } },
    alignment: { horizontal: 'left' },
    border: BORDERS.grandTotal,
  });
  applyCellStyle(wsSummary, XLSX.utils.encode_cell({ r: catTotalRow, c: 1 }), {
    font: { sz: 11, bold: true, color: { rgb: PALETTE.navyHero } },
    fill: { fgColor: { rgb: PALETTE.cardBg } },
    alignment: { horizontal: 'right' },
    border: BORDERS.grandTotal,
    numFmt: '#,##0',
  });
  applyCellStyle(wsSummary, XLSX.utils.encode_cell({ r: catTotalRow, c: 2 }), {
    font: { sz: 11, bold: true, color: { rgb: PALETTE.navyHero } },
    fill: { fgColor: { rgb: PALETTE.cardBg } },
    alignment: { horizontal: 'right' },
    border: BORDERS.grandTotal,
    numFmt: '#,##0',
  });
  applyCellStyle(wsSummary, XLSX.utils.encode_cell({ r: catTotalRow, c: 3 }), {
    font: { sz: 11, bold: true, color: { rgb: PALETTE.navyHero } },
    fill: { fgColor: { rgb: PALETTE.cardBg } },
    alignment: { horizontal: 'right' },
    border: BORDERS.grandTotal,
    numFmt: '0.0%',
  });
  applyCellStyle(wsSummary, XLSX.utils.encode_cell({ r: catTotalRow, c: 4 }), {
    font: { sz: 10, bold: true, color: { rgb: PALETTE.textMuted } },
    fill: { fgColor: { rgb: PALETTE.cardBg } },
    alignment: { horizontal: 'center' },
    border: BORDERS.grandTotal,
  });
  applyCellStyle(wsSummary, XLSX.utils.encode_cell({ r: catTotalRow, c: 5 }), {
    font: { sz: 10.5, bold: true, color: { rgb: totalAlerts > 0 ? PALETTE.warningText : PALETTE.successText } },
    fill: { fgColor: { rgb: PALETTE.cardBg } },
    alignment: { horizontal: 'center' },
    border: BORDERS.grandTotal,
  });

  // Alturas de filas y anchos de columnas
  const sumRowHeights = new Array(summaryRows.length).fill(22);
  sumRowHeights[sumTitleIdx] = 36;
  sumRowHeights[sumSubIdx] = 20;
  sumRowHeights[kpiLabelRow] = 20;
  sumRowHeights[kpiValRow] = 30;
  sumRowHeights[catTableTitleRow] = 24;
  sumRowHeights[catHeaderRow] = 24;
  sumRowHeights[catTotalRow] = 26;
  wsSummary['!rows'] = sumRowHeights.map((h) => ({ hpt: h }));

  autoFitColumns(wsSummary, summaryRows, { 0: 28, 1: 18, 2: 20, 3: 18, 4: 22, 5: 22 });
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Resumen Ejecutivo');

  // --------------------------------------------------------------------------
  // HOJA 2: INVENTARIO COMPLETO (POR SECCIONES)
  // --------------------------------------------------------------------------
  const allRows = [];
  const allMerges = [];
  const allStyleMeta = [];

  const { titleRowIdx: allTitleIdx, subRowIdx: allSubIdx } = renderExecutiveHeader(
    allRows,
    allMerges,
    'INVENTARIO MAESTRO — LISTADO COMPLETO DE PRODUCTOS',
    `Exportado el: ${now}  |  ${totalProducts} productos registrados  |  ${totalUnits.toLocaleString('es-AR')} unidades totales en stock`,
    7
  );

  sortedCategories.forEach((cat) => {
    const items = categoryGroups[cat];
    const catUnits = items.reduce((s, p) => s + (Number(p.quantity) || 0), 0);
    const catColor = getCategoryColor(cat);

    // Banner de Categoría
    const catBannerRow = allRows.length;
    allRows.push([`▶  SECCIÓN: ${cat}  (${items.length} productos • ${catUnits.toLocaleString('es-AR')} uds)`, '', '', '', '', '', '']);
    allMerges.push({ s: { r: catBannerRow, c: 0 }, e: { r: catBannerRow, c: 6 } });
    allStyleMeta.push({ row: catBannerRow, type: 'categoryBanner', color: catColor.brand });

    // Encabezados de Columna
    const colHeaderRow = allRows.length;
    allRows.push([
      'SKU',
      'Descripción del Producto',
      'Categoría',
      'Stock Actual',
      'Umbral Mínimo',
      'Estado',
      'Última Actualización',
    ]);
    allStyleMeta.push({ row: colHeaderRow, type: 'colHeader' });

    // Productos ordenados por nombre
    const sortedItems = [...items].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    sortedItems.forEach((p, idx) => {
      const pRow = allRows.length;
      const qty = Number(p.quantity) || 0;
      const threshold = getLowStockThreshold(p.category);
      const thresholdStr = threshold === null ? 'N/A' : threshold;
      const low = isLowStock(p);

      let status = 'ÓPTIMO';
      if (qty < 0) status = 'CRÍTICO (NEGATIVO)';
      else if (qty === 0) status = 'SIN STOCK';
      else if (low) status = 'BAJO STOCK';

      allRows.push([
        sanitizeCell(p.sku),
        sanitizeCell(p.name),
        p.category || 'SIN CATEGORÍA',
        qty,
        thresholdStr,
        status,
        formatDate(p.lastUpdated),
      ]);

      allStyleMeta.push({
        row: pRow,
        type: 'productData',
        isOdd: idx % 2 === 1,
        qty,
        low,
      });
    });

    // Subtotal de Categoría
    const subtotalRow = allRows.length;
    allRows.push([
      '',
      `Subtotal ${cat}`,
      `${items.length} productos`,
      catUnits,
      '',
      '',
      '',
    ]);
    allStyleMeta.push({ row: subtotalRow, type: 'subtotal', tint: catColor.tint });

    // Espaciador entre categorías
    allRows.push(['', '', '', '', '', '', '']);
    allStyleMeta.push({ row: allRows.length - 1, type: 'spacer' });
  });

  // Gran Total al final
  const grandTotalRow = allRows.length;
  allRows.push([
    'TOTAL GENERAL DEL INVENTARIO',
    '',
    `${totalProducts} productos`,
    totalUnits,
    '',
    '100% Catálogo',
    '',
  ]);
  allMerges.push({ s: { r: grandTotalRow, c: 0 }, e: { r: grandTotalRow, c: 1 } });
  allStyleMeta.push({ row: grandTotalRow, type: 'grandTotal' });

  const wsAll = XLSX.utils.aoa_to_sheet(allRows);
  wsAll['!merges'] = allMerges;
  wsAll['!views'] = [{ showGridLines: true }];

  // Aplicar estilos
  applyExecutiveHeaderStyles(wsAll, allTitleIdx, allSubIdx, 7);

  const allHeights = new Array(allRows.length).fill(21);
  allHeights[allTitleIdx] = 36;
  allHeights[allSubIdx] = 20;

  allStyleMeta.forEach((meta) => {
    const r = meta.row;
    if (meta.type === 'categoryBanner') {
      allHeights[r] = 26;
      styleRowRange(wsAll, r, 0, 6, {
        font: { sz: 11, bold: true, color: { rgb: PALETTE.textWhite } },
        fill: { fgColor: { rgb: meta.color } },
        alignment: { horizontal: 'left', vertical: 'center' },
      });
    } else if (meta.type === 'colHeader') {
      allHeights[r] = 24;
      styleRowRange(wsAll, r, 0, 6, {
        font: { sz: 9.5, bold: true, color: { rgb: PALETTE.textWhite } },
        fill: { fgColor: { rgb: PALETTE.navyHeader } },
        alignment: { horizontal: 'center' },
        border: BORDERS.header,
      });
    } else if (meta.type === 'productData') {
      const rowFill = meta.isOdd ? PALETTE.zebraOdd : PALETTE.zebraEven;
      const isCritical = meta.qty <= 0;
      const isLow = meta.low;

      // Col 0: SKU
      applyCellStyle(wsAll, XLSX.utils.encode_cell({ r, c: 0 }), {
        font: { sz: 9.5, bold: true, color: { rgb: PALETTE.navyHero } },
        fill: { fgColor: { rgb: rowFill } },
        alignment: { horizontal: 'center' },
        border: BORDERS.delicate,
      });
      // Col 1: Nombre
      applyCellStyle(wsAll, XLSX.utils.encode_cell({ r, c: 1 }), {
        font: { sz: 10 },
        fill: { fgColor: { rgb: rowFill } },
        alignment: { horizontal: 'left' },
        border: BORDERS.delicate,
      });
      // Col 2: Categoría
      applyCellStyle(wsAll, XLSX.utils.encode_cell({ r, c: 2 }), {
        font: { sz: 9, color: { rgb: PALETTE.textMuted } },
        fill: { fgColor: { rgb: rowFill } },
        alignment: { horizontal: 'center' },
        border: BORDERS.delicate,
      });
      // Col 3: Stock Actual
      let qtyFontColor = PALETTE.textPrimary;
      let qtyFill = rowFill;
      if (isCritical) {
        qtyFontColor = PALETTE.dangerText;
        qtyFill = PALETTE.dangerFill;
      } else if (isLow) {
        qtyFontColor = PALETTE.warningText;
        qtyFill = PALETTE.warningFill;
      }
      applyCellStyle(wsAll, XLSX.utils.encode_cell({ r, c: 3 }), {
        font: { sz: 10, bold: true, color: { rgb: qtyFontColor } },
        fill: { fgColor: { rgb: qtyFill } },
        alignment: { horizontal: 'right' },
        border: BORDERS.delicate,
        numFmt: '#,##0',
      });
      // Col 4: Umbral Mínimo
      applyCellStyle(wsAll, XLSX.utils.encode_cell({ r, c: 4 }), {
        font: { sz: 9.5, color: { rgb: PALETTE.textSecondary } },
        fill: { fgColor: { rgb: rowFill } },
        alignment: { horizontal: 'center' },
        border: BORDERS.delicate,
        numFmt: typeof wsAll[XLSX.utils.encode_cell({ r, c: 4 })]?.v === 'number' ? '#,##0' : undefined,
      });
      // Col 5: Estado Badge
      let statusFill = PALETTE.successFill;
      let statusText = PALETTE.successText;
      if (isCritical) {
        statusFill = PALETTE.dangerFill;
        statusText = PALETTE.dangerText;
      } else if (isLow) {
        statusFill = PALETTE.warningFill;
        statusText = PALETTE.warningText;
      }
      applyCellStyle(wsAll, XLSX.utils.encode_cell({ r, c: 5 }), {
        font: { sz: 9, bold: true, color: { rgb: statusText } },
        fill: { fgColor: { rgb: statusFill } },
        alignment: { horizontal: 'center' },
        border: BORDERS.delicate,
      });
      // Col 6: Última Actualización
      applyCellStyle(wsAll, XLSX.utils.encode_cell({ r, c: 6 }), {
        font: { sz: 9, color: { rgb: PALETTE.textMuted } },
        fill: { fgColor: { rgb: rowFill } },
        alignment: { horizontal: 'center' },
        border: BORDERS.delicate,
      });
    } else if (meta.type === 'subtotal') {
      allHeights[r] = 23;
      for (let c = 0; c <= 6; c++) {
        applyCellStyle(wsAll, XLSX.utils.encode_cell({ r, c }), {
          font: { sz: 10, bold: true, color: { rgb: PALETTE.navySection } },
          fill: { fgColor: { rgb: meta.tint || PALETTE.subtotalBg } },
          alignment: { horizontal: c === 3 ? 'right' : c === 1 ? 'left' : 'center' },
          border: BORDERS.subtotal,
          numFmt: c === 3 ? '#,##0' : undefined,
        });
      }
    } else if (meta.type === 'grandTotal') {
      allHeights[r] = 28;
      for (let c = 0; c <= 6; c++) {
        applyCellStyle(wsAll, XLSX.utils.encode_cell({ r, c }), {
          font: { sz: 11, bold: true, color: { rgb: PALETTE.textWhite } },
          fill: { fgColor: { rgb: PALETTE.navyHero } },
          alignment: { horizontal: c === 3 ? 'right' : c === 0 ? 'left' : 'center' },
          border: BORDERS.grandTotal,
          numFmt: c === 3 ? '#,##0' : undefined,
        });
      }
    }
  });

  wsAll['!rows'] = allHeights.map((h) => ({ hpt: h }));
  autoFitColumns(wsAll, allRows, { 0: 18, 1: 38, 2: 20, 3: 16, 4: 16, 5: 22, 6: 22 });
  XLSX.utils.book_append_sheet(wb, wsAll, 'Inventario Completo');

  // --------------------------------------------------------------------------
  // HOJA 3: PANEL DE ALERTAS CRÍTICAS
  // --------------------------------------------------------------------------
  const alertProducts = products.filter((p) => (Number(p.quantity) || 0) <= 0 || isLowStock(p));
  const alertRows = [];
  const alertMerges = [];

  const { titleRowIdx: altTitleIdx, subRowIdx: altSubIdx } = renderExecutiveHeader(
    alertRows,
    alertMerges,
    'PANEL DE ALERTAS — PRODUCTOS CRÍTICOS Y REPOSICIÓN',
    alertProducts.length > 0
      ? `Atención Requerida: ${alertProducts.length} productos por debajo del umbral óptimo o sin stock`
      : '✔ Todos los productos cuentan con niveles de stock dentro de los parámetros establecidos',
    8
  );

  if (alertProducts.length > 0) {
    // Tarjetas de Alerta (Negativos, Sin Stock, Bajo Stock)
    const altKpiLbl = alertRows.length;
    alertRows.push([
      '🔴 CRÍTICO / NEGATIVO',
      '',
      '⭕ SIN STOCK (0 UDS)',
      '',
      '⚠️ BAJO STOCK',
      '',
      '📦 TOTAL EN ALERTA',
      '',
    ]);
    alertMerges.push(
      { s: { r: altKpiLbl, c: 0 }, e: { r: altKpiLbl, c: 1 } },
      { s: { r: altKpiLbl, c: 2 }, e: { r: altKpiLbl, c: 3 } },
      { s: { r: altKpiLbl, c: 4 }, e: { r: altKpiLbl, c: 5 } },
      { s: { r: altKpiLbl, c: 6 }, e: { r: altKpiLbl, c: 7 } }
    );

    const altKpiVal = alertRows.length;
    const lowCount = alertProducts.filter((p) => (p.quantity || 0) > 0 && isLowStock(p)).length;
    alertRows.push([
      negativeCount,
      '',
      outOfStockCount,
      '',
      lowCount,
      '',
      alertProducts.length,
      '',
    ]);
    alertMerges.push(
      { s: { r: altKpiVal, c: 0 }, e: { r: altKpiVal, c: 1 } },
      { s: { r: altKpiVal, c: 2 }, e: { r: altKpiVal, c: 3 } },
      { s: { r: altKpiVal, c: 4 }, e: { r: altKpiVal, c: 5 } },
      { s: { r: altKpiVal, c: 6 }, e: { r: altKpiVal, c: 7 } }
    );

    alertRows.push(new Array(8).fill(''));

    // Encabezados tabla alertas
    const altHeaderRow = alertRows.length;
    alertRows.push([
      'SKU',
      'Descripción del Producto',
      'Categoría',
      'Stock Actual',
      'Umbral Mínimo',
      'Déficit Estimado',
      'Prioridad',
      'Diagnóstico',
    ]);

    // Filas de Alertas (ordenadas: negativo primero, luego cero, luego bajo stock)
    const sortedAlerts = [...alertProducts].sort((a, b) => {
      const qA = Number(a.quantity) || 0;
      const qB = Number(b.quantity) || 0;
      return qA - qB;
    });

    const altStartData = alertRows.length;
    sortedAlerts.forEach((p) => {
      const qty = Number(p.quantity) || 0;
      const threshold = getLowStockThreshold(p.category) || 0;
      const deficit = threshold > 0 ? Math.max(threshold - qty, 0) : 0;

      let priority = 'MEDIA';
      let diag = 'Stock bajo umbral';
      if (qty < 0) {
        priority = 'URGENTE';
        diag = 'Stock negativo / Inconsistencia';
      } else if (qty === 0) {
        priority = 'ALTA';
        diag = 'Agotado / Sin existencias';
      }

      alertRows.push([
        sanitizeCell(p.sku),
        sanitizeCell(p.name),
        p.category || 'SIN CATEGORÍA',
        qty,
        threshold || 'N/A',
        deficit > 0 ? deficit : '-',
        priority,
        diag,
      ]);
    });

    const wsAlert = XLSX.utils.aoa_to_sheet(alertRows);
    wsAlert['!merges'] = alertMerges;
    wsAlert['!views'] = [{ showGridLines: true }];

    applyExecutiveHeaderStyles(wsAlert, altTitleIdx, altSubIdx, 8, PALETTE.dangerText);

    // Estilos KPI Alertas
    const altCardConfigs = [
      { startC: 0, endC: 1, fill: PALETTE.dangerFill, text: PALETTE.dangerText },
      { startC: 2, endC: 3, fill: PALETTE.dangerFill, text: PALETTE.dangerText },
      { startC: 4, endC: 5, fill: PALETTE.warningFill, text: PALETTE.warningText },
      { startC: 6, endC: 7, fill: PALETTE.cardBg, text: PALETTE.navyHero },
    ];
    altCardConfigs.forEach(({ startC, endC, fill, text }) => {
      for (let c = startC; c <= endC; c++) {
        applyCellStyle(wsAlert, XLSX.utils.encode_cell({ r: altKpiLbl, c }), {
          font: { sz: 8.5, bold: true, color: { rgb: PALETTE.textMuted } },
          fill: { fgColor: { rgb: fill } },
          alignment: { horizontal: 'center' },
          border: BORDERS.card,
        });
        applyCellStyle(wsAlert, XLSX.utils.encode_cell({ r: altKpiVal, c }), {
          font: { sz: 16, bold: true, color: { rgb: text } },
          fill: { fgColor: { rgb: fill } },
          alignment: { horizontal: 'center' },
          border: BORDERS.card,
          numFmt: '#,##0',
        });
      }
    });

    // Headers tabla
    styleRowRange(wsAlert, altHeaderRow, 0, 7, {
      font: { sz: 9.5, bold: true, color: { rgb: PALETTE.textWhite } },
      fill: { fgColor: { rgb: PALETTE.navyHeader } },
      alignment: { horizontal: 'center' },
      border: BORDERS.header,
    });

    // Datos tabla
    sortedAlerts.forEach((p, idx) => {
      const r = altStartData + idx;
      const qty = Number(p.quantity) || 0;
      const isOdd = idx % 2 === 1;
      const rowFill = isOdd ? PALETTE.zebraOdd : PALETTE.zebraEven;

      const isUrgent = qty < 0;
      const isZero = qty === 0;

      applyCellStyle(wsAlert, XLSX.utils.encode_cell({ r, c: 0 }), {
        font: { sz: 9.5, bold: true, color: { rgb: PALETTE.navyHero } },
        fill: { fgColor: { rgb: rowFill } },
        alignment: { horizontal: 'center' },
        border: BORDERS.delicate,
      });
      applyCellStyle(wsAlert, XLSX.utils.encode_cell({ r, c: 1 }), {
        font: { sz: 10 },
        fill: { fgColor: { rgb: rowFill } },
        alignment: { horizontal: 'left' },
        border: BORDERS.delicate,
      });
      applyCellStyle(wsAlert, XLSX.utils.encode_cell({ r, c: 2 }), {
        font: { sz: 9, color: { rgb: PALETTE.textMuted } },
        fill: { fgColor: { rgb: rowFill } },
        alignment: { horizontal: 'center' },
        border: BORDERS.delicate,
      });
      applyCellStyle(wsAlert, XLSX.utils.encode_cell({ r, c: 3 }), {
        font: { sz: 10, bold: true, color: { rgb: isUrgent || isZero ? PALETTE.dangerText : PALETTE.warningText } },
        fill: { fgColor: { rgb: isUrgent || isZero ? PALETTE.dangerFill : PALETTE.warningFill } },
        alignment: { horizontal: 'right' },
        border: BORDERS.delicate,
        numFmt: '#,##0',
      });
      applyCellStyle(wsAlert, XLSX.utils.encode_cell({ r, c: 4 }), {
        font: { sz: 9.5 },
        fill: { fgColor: { rgb: rowFill } },
        alignment: { horizontal: 'center' },
        border: BORDERS.delicate,
      });
      applyCellStyle(wsAlert, XLSX.utils.encode_cell({ r, c: 5 }), {
        font: { sz: 9.5, bold: true, color: { rgb: PALETTE.dangerText } },
        fill: { fgColor: { rgb: rowFill } },
        alignment: { horizontal: 'right' },
        border: BORDERS.delicate,
        numFmt: typeof wsAlert[XLSX.utils.encode_cell({ r, c: 5 })]?.v === 'number' ? '#,##0' : undefined,
      });
      applyCellStyle(wsAlert, XLSX.utils.encode_cell({ r, c: 6 }), {
        font: { sz: 9, bold: true, color: { rgb: isUrgent ? PALETTE.dangerText : isZero ? PALETTE.dangerText : PALETTE.warningText } },
        fill: { fgColor: { rgb: isUrgent ? PALETTE.dangerFill : isZero ? PALETTE.dangerFill : PALETTE.warningFill } },
        alignment: { horizontal: 'center' },
        border: BORDERS.delicate,
      });
      applyCellStyle(wsAlert, XLSX.utils.encode_cell({ r, c: 7 }), {
        font: { sz: 9.5, color: { rgb: PALETTE.textSecondary } },
        fill: { fgColor: { rgb: rowFill } },
        alignment: { horizontal: 'left' },
        border: BORDERS.delicate,
      });
    });

    const altHeights = new Array(alertRows.length).fill(21);
    altHeights[altTitleIdx] = 36;
    altHeights[altSubIdx] = 20;
    altHeights[altKpiLbl] = 20;
    altHeights[altKpiVal] = 30;
    altHeights[altHeaderRow] = 24;
    wsAlert['!rows'] = altHeights.map((h) => ({ hpt: h }));

    autoFitColumns(wsAlert, alertRows, { 0: 18, 1: 36, 2: 20, 3: 16, 4: 16, 5: 18, 6: 16, 7: 30 });
    XLSX.utils.book_append_sheet(wb, wsAlert, 'Alertas de Stock');
  }

  // --------------------------------------------------------------------------
  // HOJAS INDIVIDUALES POR CATEGORÍA
  // --------------------------------------------------------------------------
  sortedCategories.forEach((cat) => {
    const items = categoryGroups[cat];
    const catUnits = items.reduce((s, p) => s + (Number(p.quantity) || 0), 0);
    const catColor = getCategoryColor(cat);

    const catRows = [];
    const catMerges = [];

    const { titleRowIdx: cTitleIdx, subRowIdx: cSubIdx } = renderExecutiveHeader(
      catRows,
      catMerges,
      `SECCIÓN DE PRODUCTOS: ${cat}`,
      `${items.length} productos registrados  •  ${catUnits.toLocaleString('es-AR')} unidades en inventario`,
      5
    );

    const cHeaderRow = catRows.length;
    catRows.push(['SKU', 'Nombre del Producto', 'Stock Actual', 'Umbral Mínimo', 'Última Actualización']);

    const sorted = [...items].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    const cDataStart = catRows.length;

    sorted.forEach((p) => {
      const threshold = getLowStockThreshold(p.category);
      catRows.push([
        sanitizeCell(p.sku),
        sanitizeCell(p.name),
        Number(p.quantity) || 0,
        threshold === null ? 'N/A' : threshold,
        formatDate(p.lastUpdated),
      ]);
    });

    // Fila total de categoría
    const cTotalRow = catRows.length;
    catRows.push(['TOTAL', `${items.length} productos`, catUnits, '', '']);
    catMerges.push({ s: { r: cTotalRow, c: 0 }, e: { r: cTotalRow, c: 1 } });

    const wsCat = XLSX.utils.aoa_to_sheet(catRows);
    wsCat['!merges'] = catMerges;
    wsCat['!views'] = [{ showGridLines: true }];

    applyExecutiveHeaderStyles(wsCat, cTitleIdx, cSubIdx, 5, catColor.brand);

    // Headers
    styleRowRange(wsCat, cHeaderRow, 0, 4, {
      font: { sz: 10, bold: true, color: { rgb: PALETTE.textWhite } },
      fill: { fgColor: { rgb: PALETTE.navyHeader } },
      alignment: { horizontal: 'center' },
      border: BORDERS.header,
    });

    // Data rows
    sorted.forEach((p, idx) => {
      const r = cDataStart + idx;
      const isOdd = idx % 2 === 1;
      const rowFill = isOdd ? PALETTE.zebraOdd : PALETTE.zebraEven;
      const qty = Number(p.quantity) || 0;
      const low = isLowStock(p);

      applyCellStyle(wsCat, XLSX.utils.encode_cell({ r, c: 0 }), {
        font: { sz: 9.5, bold: true, color: { rgb: PALETTE.navyHero } },
        fill: { fgColor: { rgb: rowFill } },
        alignment: { horizontal: 'center' },
        border: BORDERS.delicate,
      });
      applyCellStyle(wsCat, XLSX.utils.encode_cell({ r, c: 1 }), {
        font: { sz: 10 },
        fill: { fgColor: { rgb: rowFill } },
        alignment: { horizontal: 'left' },
        border: BORDERS.delicate,
      });

      let qColor = PALETTE.textPrimary;
      let qFill = rowFill;
      if (qty <= 0) {
        qColor = PALETTE.dangerText;
        qFill = PALETTE.dangerFill;
      } else if (low) {
        qColor = PALETTE.warningText;
        qFill = PALETTE.warningFill;
      }
      applyCellStyle(wsCat, XLSX.utils.encode_cell({ r, c: 2 }), {
        font: { sz: 10, bold: true, color: { rgb: qColor } },
        fill: { fgColor: { rgb: qFill } },
        alignment: { horizontal: 'right' },
        border: BORDERS.delicate,
        numFmt: '#,##0',
      });
      applyCellStyle(wsCat, XLSX.utils.encode_cell({ r, c: 3 }), {
        font: { sz: 9.5, color: { rgb: PALETTE.textSecondary } },
        fill: { fgColor: { rgb: rowFill } },
        alignment: { horizontal: 'center' },
        border: BORDERS.delicate,
      });
      applyCellStyle(wsCat, XLSX.utils.encode_cell({ r, c: 4 }), {
        font: { sz: 9, color: { rgb: PALETTE.textMuted } },
        fill: { fgColor: { rgb: rowFill } },
        alignment: { horizontal: 'center' },
        border: BORDERS.delicate,
      });
    });

    // Fila total
    for (let c = 0; c <= 4; c++) {
      applyCellStyle(wsCat, XLSX.utils.encode_cell({ r: cTotalRow, c }), {
        font: { sz: 11, bold: true, color: { rgb: PALETTE.textWhite } },
        fill: { fgColor: { rgb: catColor.brand } },
        alignment: { horizontal: c === 2 ? 'right' : c <= 1 ? 'left' : 'center' },
        border: BORDERS.grandTotal,
        numFmt: c === 2 ? '#,##0' : undefined,
      });
    }

    const cHeights = new Array(catRows.length).fill(21);
    cHeights[cTitleIdx] = 36;
    cHeights[cSubIdx] = 20;
    cHeights[cHeaderRow] = 24;
    cHeights[cTotalRow] = 26;
    wsCat['!rows'] = cHeights.map((h) => ({ hpt: h }));

    autoFitColumns(wsCat, catRows, { 0: 18, 1: 40, 2: 16, 3: 16, 4: 22 });

    const cleanSheetName = cat.substring(0, 31).replace(/[\\/*?\[\]:]/g, '-');
    XLSX.utils.book_append_sheet(wb, wsCat, cleanSheetName);
  });

  // Guardar / Descargar
  XLSX.writeFile(wb, filename);
}

/* ==========================================================================
   2. REPORTE DE COMPARACIÓN / AUDITORÍA (generateDiffReport)
   ========================================================================== */

/**
 * Genera un reporte comparativo ejecutivo con diseño corporativo:
 * - Hoja 1: Resumen Ejecutivo con Tarjetas KPI y métricas de variación
 * - Hoja 2: Detalle de Discrepancias agrupado por secciones (eliminados, modificados, nuevos)
 */
export function generateDiffReport(comparisonResult, sessionName = 'Reporte') {
  const wb = XLSX.utils.book_new();
  const now = formatDate(new Date());
  const summary = comparisonResult?.summary || {};
  const differences = comparisonResult?.differences || [];

  // --------------------------------------------------------------------------
  // HOJA 1: RESUMEN COMPARATIVO
  // --------------------------------------------------------------------------
  const sumRows = [];
  const sumMerges = [];

  const { titleRowIdx: rTitleIdx, subRowIdx: rSubIdx } = renderExecutiveHeader(
    sumRows,
    sumMerges,
    'AUDITORÍA DE INVENTARIO — REPORTE DE COMPARACIÓN',
    `Sesión: ${sessionName}  |  Fecha de Comparación: ${now}`,
    5
  );

  // Tarjetas KPI de Comparación
  const kpiLblRow = sumRows.length;
  sumRows.push([
    '📦 TOTAL EVALUADOS',
    '🟢 NUEVOS',
    '🔴 ELIMINADOS',
    '🟡 CON CAMBIOS',
    '⚪ SIN CAMBIOS',
  ]);
  const kpiValRow = sumRows.length;
  sumRows.push([
    summary.total || 0,
    summary.added || 0,
    summary.removed || 0,
    summary.changed || 0,
    summary.unchanged || 0,
  ]);

  sumRows.push(new Array(5).fill(''));

  // Título tabla resumen
  const tableTitleRow = sumRows.length;
  sumRows.push(['MÉTRICAS Y RESULTADOS DE LA COMPARACIÓN', '', '', '', '']);
  sumMerges.push({ s: { r: tableTitleRow, c: 0 }, e: { r: tableTitleRow, c: 4 } });

  // Tabla detallada
  const detailStart = sumRows.length;
  const netDiff = differences.reduce((acc, d) => acc + (d.diff || 0), 0);
  const matchRate = summary.total > 0
    ? (((summary.unchanged || 0) / summary.total) * 100).toFixed(1) + '%'
    : '100.0%';

  const metricsData = [
    ['Total de productos en el catálogo evaluado', summary.total || 0, 'Base de datos y archivo comparado'],
    ['Productos nuevos incorporados', summary.added || 0, 'Detectados únicamente en la toma actual'],
    ['Productos ausentes o eliminados', summary.removed || 0, 'Presentes en inventario anterior pero no en actual'],
    ['Productos con variación de cantidad', summary.changed || 0, 'Discrepancias entre stock registrado y físico'],
    ['Productos idénticos (sin variación)', summary.unchanged || 0, 'Coincidencia exacta de existencias'],
    ['Total de discrepancias detectadas', summary.totalDifferences || differences.length, 'Artículos que requieren ajuste'],
    ['Variación neta de unidades', netDiff > 0 ? `+${netDiff}` : String(netDiff), 'Impacto neto en volumen de stock'],
    ['Índice de coincidencia de catálogo', matchRate, 'Porcentaje de productos sin discrepancia'],
  ];

  metricsData.forEach(([label, val, note]) => {
    sumRows.push([label, val, '', note, '']);
    sumMerges.push({ s: { r: sumRows.length - 1, c: 0 }, e: { r: sumRows.length - 1, c: 1 } });
    sumMerges.push({ s: { r: sumRows.length - 1, c: 3 }, e: { r: sumRows.length - 1, c: 4 } });
  });

  const wsSum = XLSX.utils.aoa_to_sheet(sumRows);
  wsSum['!merges'] = sumMerges;
  wsSum['!views'] = [{ showGridLines: true }];

  applyExecutiveHeaderStyles(wsSum, rTitleIdx, rSubIdx, 5);

  // Estilos Tarjetas KPI
  const kpiColors = [
    { c: 0, fill: PALETTE.cardBg, text: PALETTE.navyHero },
    { c: 1, fill: PALETTE.successFill, text: PALETTE.successText },
    { c: 2, fill: PALETTE.dangerFill, text: PALETTE.dangerText },
    { c: 3, fill: PALETTE.warningFill, text: PALETTE.warningText },
    { c: 4, fill: PALETTE.cardBg, text: PALETTE.textSecondary },
  ];
  kpiColors.forEach(({ c, fill, text }) => {
    applyCellStyle(wsSum, XLSX.utils.encode_cell({ r: kpiLblRow, c }), {
      font: { sz: 8.5, bold: true, color: { rgb: PALETTE.textMuted } },
      fill: { fgColor: { rgb: fill } },
      alignment: { horizontal: 'center' },
      border: BORDERS.card,
    });
    applyCellStyle(wsSum, XLSX.utils.encode_cell({ r: kpiValRow, c }), {
      font: { sz: 16, bold: true, color: { rgb: text } },
      fill: { fgColor: { rgb: fill } },
      alignment: { horizontal: 'center' },
      border: BORDERS.card,
      numFmt: '#,##0',
    });
  });

  // Título tabla métricas
  styleRowRange(wsSum, tableTitleRow, 0, 4, {
    font: { sz: 11, bold: true, color: { rgb: PALETTE.textWhite } },
    fill: { fgColor: { rgb: PALETTE.navySection } },
    alignment: { horizontal: 'left' },
  });

  // Filas métricas
  metricsData.forEach((_, idx) => {
    const r = detailStart + idx;
    const isOdd = idx % 2 === 1;
    const rowFill = isOdd ? PALETTE.zebraOdd : PALETTE.zebraEven;

    for (let c = 0; c <= 4; c++) {
      applyCellStyle(wsSum, XLSX.utils.encode_cell({ r, c }), {
        font: { sz: 10, bold: c === 1 },
        fill: { fgColor: { rgb: rowFill } },
        alignment: { horizontal: c === 1 ? 'right' : c >= 3 ? 'left' : 'left' },
        border: BORDERS.delicate,
        numFmt: c === 1 && typeof wsSum[XLSX.utils.encode_cell({ r, c })]?.v === 'number' ? '#,##0' : undefined,
      });
    }
  });

  const sumHeights = new Array(sumRows.length).fill(22);
  sumHeights[rTitleIdx] = 36;
  sumHeights[rSubIdx] = 20;
  sumHeights[kpiLblRow] = 20;
  sumHeights[kpiValRow] = 30;
  sumHeights[tableTitleRow] = 24;
  wsSum['!rows'] = sumHeights.map((h) => ({ hpt: h }));

  autoFitColumns(wsSum, sumRows, { 0: 35, 1: 18, 2: 10, 3: 45, 4: 10 });
  XLSX.utils.book_append_sheet(wb, wsSum, 'Resumen Comparativo');

  // --------------------------------------------------------------------------
  // HOJA 2: DETALLE DE DIFERENCIAS (POR SECCIÓN)
  // --------------------------------------------------------------------------
  const statusGroups = {
    'eliminado': {
      label: '🔴 PRODUCTOS ELIMINADOS / AUSENTES',
      color: 'DC2626',
      items: [],
      badge: 'ELIMINADO',
    },
    'modificado': {
      label: '🟡 PRODUCTOS CON VARIACIÓN DE STOCK',
      color: 'D97706',
      items: [],
      badge: 'MODIFICADO',
    },
    'nuevo': {
      label: '🟢 PRODUCTOS NUEVOS DETECTADOS',
      color: '059669',
      items: [],
      badge: 'NUEVO',
    },
  };

  differences.forEach((d) => {
    if (statusGroups[d.status]) {
      statusGroups[d.status].items.push(d);
    }
  });

  const diffRows = [];
  const diffMerges = [];
  const diffStyleMeta = [];

  const { titleRowIdx: dTitleIdx, subRowIdx: dSubIdx } = renderExecutiveHeader(
    diffRows,
    diffMerges,
    'DETALLE DE DISCREPANCIAS Y VARIACIONES DE STOCK',
    `Total de artículos con diferencias detectadas: ${differences.length}  |  Sesión: ${sessionName}`,
    6
  );

  Object.entries(statusGroups).forEach(([statusKey, group]) => {
    if (group.items.length === 0) return;

    // Sección Header
    const secRow = diffRows.length;
    diffRows.push([`${group.label}  (${group.items.length} artículos)`, '', '', '', '', '']);
    diffMerges.push({ s: { r: secRow, c: 0 }, e: { r: secRow, c: 5 } });
    diffStyleMeta.push({ row: secRow, type: 'sectionHeader', color: group.color });

    // Column Headers
    const colHRow = diffRows.length;
    diffRows.push(['SKU', 'Descripción del Producto', 'Stock Anterior', 'Stock Actual', 'Diferencia', 'Estado']);
    diffStyleMeta.push({ row: colHRow, type: 'colHeader' });

    // Data Rows
    group.items.forEach((d, idx) => {
      const dRow = diffRows.length;
      const diffVal = Number(d.diff) || 0;
      const prevQty = Number(d.previousQty) || 0;
      const currQty = Number(d.currentQty) || 0;

      diffRows.push([
        sanitizeCell(d.sku),
        sanitizeCell(d.name),
        prevQty,
        currQty,
        diffVal,
        group.badge,
      ]);

      diffStyleMeta.push({
        row: dRow,
        type: 'dataRow',
        isOdd: idx % 2 === 1,
        diffVal,
        statusKey,
      });
    });

    // Subtotal Row
    const groupDiffTotal = group.items.reduce((acc, d) => acc + (Number(d.diff) || 0), 0);
    const subRow = diffRows.length;
    diffRows.push([
      '',
      `Subtotal ${group.label.split(' ')[1] || ''}`,
      '',
      `${group.items.length} artículos`,
      groupDiffTotal,
      '',
    ]);
    diffStyleMeta.push({ row: subRow, type: 'subtotal' });

    // Spacer
    diffRows.push(['', '', '', '', '', '']);
    diffStyleMeta.push({ row: diffRows.length - 1, type: 'spacer' });
  });

  // Gran Total de Diferencias
  const grandDiffRow = diffRows.length;
  diffRows.push([
    'VARIACIÓN NETA TOTAL',
    '',
    '',
    `${differences.length} discrepancias`,
    netDiff,
    '',
  ]);
  diffMerges.push({ s: { r: grandDiffRow, c: 0 }, e: { r: grandDiffRow, c: 1 } });
  diffStyleMeta.push({ row: grandDiffRow, type: 'grandTotal' });

  const wsDiff = XLSX.utils.aoa_to_sheet(diffRows);
  wsDiff['!merges'] = diffMerges;
  wsDiff['!views'] = [{ showGridLines: true }];

  applyExecutiveHeaderStyles(wsDiff, dTitleIdx, dSubIdx, 6);

  const diffHeights = new Array(diffRows.length).fill(21);
  diffHeights[dTitleIdx] = 36;
  diffHeights[dSubIdx] = 20;

  diffStyleMeta.forEach((meta) => {
    const r = meta.row;
    if (meta.type === 'sectionHeader') {
      diffHeights[r] = 26;
      styleRowRange(wsDiff, r, 0, 5, {
        font: { sz: 11, bold: true, color: { rgb: PALETTE.textWhite } },
        fill: { fgColor: { rgb: meta.color } },
        alignment: { horizontal: 'left', vertical: 'center' },
      });
    } else if (meta.type === 'colHeader') {
      diffHeights[r] = 24;
      styleRowRange(wsDiff, r, 0, 5, {
        font: { sz: 9.5, bold: true, color: { rgb: PALETTE.textWhite } },
        fill: { fgColor: { rgb: PALETTE.navyHeader } },
        alignment: { horizontal: 'center' },
        border: BORDERS.header,
      });
    } else if (meta.type === 'dataRow') {
      const rowFill = meta.isOdd ? PALETTE.zebraOdd : PALETTE.zebraEven;
      const isPos = meta.diffVal > 0;

      // Col 0: SKU
      applyCellStyle(wsDiff, XLSX.utils.encode_cell({ r, c: 0 }), {
        font: { sz: 9.5, bold: true, color: { rgb: PALETTE.navyHero } },
        fill: { fgColor: { rgb: rowFill } },
        alignment: { horizontal: 'center' },
        border: BORDERS.delicate,
      });
      // Col 1: Nombre
      applyCellStyle(wsDiff, XLSX.utils.encode_cell({ r, c: 1 }), {
        font: { sz: 10 },
        fill: { fgColor: { rgb: rowFill } },
        alignment: { horizontal: 'left' },
        border: BORDERS.delicate,
      });
      // Col 2: Stock Anterior
      applyCellStyle(wsDiff, XLSX.utils.encode_cell({ r, c: 2 }), {
        font: { sz: 10 },
        fill: { fgColor: { rgb: rowFill } },
        alignment: { horizontal: 'right' },
        border: BORDERS.delicate,
        numFmt: '#,##0',
      });
      // Col 3: Stock Actual
      applyCellStyle(wsDiff, XLSX.utils.encode_cell({ r, c: 3 }), {
        font: { sz: 10, bold: true },
        fill: { fgColor: { rgb: rowFill } },
        alignment: { horizontal: 'right' },
        border: BORDERS.delicate,
        numFmt: '#,##0',
      });
      // Col 4: Diferencia (con signo explícito y color semántico)
      applyCellStyle(wsDiff, XLSX.utils.encode_cell({ r, c: 4 }), {
        font: { sz: 10, bold: true, color: { rgb: isPos ? PALETTE.successText : PALETTE.dangerText } },
        fill: { fgColor: { rgb: isPos ? PALETTE.successFill : PALETTE.dangerFill } },
        alignment: { horizontal: 'right' },
        border: BORDERS.delicate,
        numFmt: '+#,##0;-#,##0;0',
      });
      // Col 5: Badge Estado
      let sColor = PALETTE.textSecondary;
      let sFill = rowFill;
      if (meta.statusKey === 'nuevo') {
        sColor = PALETTE.successText;
        sFill = PALETTE.successFill;
      } else if (meta.statusKey === 'eliminado') {
        sColor = PALETTE.dangerText;
        sFill = PALETTE.dangerFill;
      } else if (meta.statusKey === 'modificado') {
        sColor = PALETTE.warningText;
        sFill = PALETTE.warningFill;
      }
      applyCellStyle(wsDiff, XLSX.utils.encode_cell({ r, c: 5 }), {
        font: { sz: 9, bold: true, color: { rgb: sColor } },
        fill: { fgColor: { rgb: sFill } },
        alignment: { horizontal: 'center' },
        border: BORDERS.delicate,
      });
    } else if (meta.type === 'subtotal') {
      diffHeights[r] = 23;
      for (let c = 0; c <= 5; c++) {
        applyCellStyle(wsDiff, XLSX.utils.encode_cell({ r, c }), {
          font: { sz: 10, bold: true, color: { rgb: PALETTE.navySection } },
          fill: { fgColor: { rgb: PALETTE.subtotalBg } },
          alignment: { horizontal: c === 4 ? 'right' : c === 1 ? 'left' : 'center' },
          border: BORDERS.subtotal,
          numFmt: c === 4 ? '+#,##0;-#,##0;0' : undefined,
        });
      }
    } else if (meta.type === 'grandTotal') {
      diffHeights[r] = 28;
      for (let c = 0; c <= 5; c++) {
        applyCellStyle(wsDiff, XLSX.utils.encode_cell({ r, c }), {
          font: { sz: 11, bold: true, color: { rgb: PALETTE.textWhite } },
          fill: { fgColor: { rgb: PALETTE.navyHero } },
          alignment: { horizontal: c === 4 ? 'right' : c === 0 ? 'left' : 'center' },
          border: BORDERS.grandTotal,
          numFmt: c === 4 ? '+#,##0;-#,##0;0' : undefined,
        });
      }
    }
  });

  wsDiff['!rows'] = diffHeights.map((h) => ({ hpt: h }));
  autoFitColumns(wsDiff, diffRows, { 0: 18, 1: 38, 2: 18, 3: 18, 4: 18, 5: 18 });
  XLSX.utils.book_append_sheet(wb, wsDiff, 'Detalle de Diferencias');

  return wb;
}

/* ==========================================================================
   3. EXPORTACIÓN DE HISTORIAL DE ACTIVIDAD (exportHistoryToExcel)
   ========================================================================== */

/**
 * Exporta el historial de auditoría del sistema a un Excel con diseño corporativo
 */
export function exportHistoryToExcel(logs = [], filename = 'historial_actividad.xlsx') {
  const wb = XLSX.utils.book_new();
  const now = formatDate(new Date());

  const histRows = [];
  const histMerges = [];

  const { titleRowIdx: hTitleIdx, subRowIdx: hSubIdx } = renderExecutiveHeader(
    histRows,
    histMerges,
    'REGISTRO DE AUDITORÍA — HISTORIAL DE ACTIVIDAD',
    `Exportado el: ${now}  |  Total de Registros: ${logs.length} eventos de auditoría`,
    9
  );

  // Tarjetas KPI
  const uniqueUsers = new Set(logs.map((l) => l.userName || l.userEmail).filter(Boolean)).size;
  const stockMoves = logs.filter((l) => ['cantidad_agregada', 'cantidad_descontada', 'producto_agregado'].includes(l.action)).length;
  const reportsCount = logs.filter((l) => ['reporte_descargado', 'excel_subido', 'comparacion_realizada'].includes(l.action)).length;

  const kpiLbl = histRows.length;
  histRows.push([
    '📋 TOTAL ACCIONES',
    '',
    '👤 USUARIOS ACTIVOS',
    '',
    '📦 MOVIMIENTOS STOCK',
    '',
    '📄 REPORTES / EXCEL',
    '',
    '',
  ]);
  histMerges.push(
    { s: { r: kpiLbl, c: 0 }, e: { r: kpiLbl, c: 1 } },
    { s: { r: kpiLbl, c: 2 }, e: { r: kpiLbl, c: 3 } },
    { s: { r: kpiLbl, c: 4 }, e: { r: kpiLbl, c: 5 } },
    { s: { r: kpiLbl, c: 6 }, e: { r: kpiLbl, c: 8 } }
  );

  const kpiVal = histRows.length;
  histRows.push([
    logs.length,
    '',
    uniqueUsers,
    '',
    stockMoves,
    '',
    reportsCount,
    '',
    '',
  ]);
  histMerges.push(
    { s: { r: kpiVal, c: 0 }, e: { r: kpiVal, c: 1 } },
    { s: { r: kpiVal, c: 2 }, e: { r: kpiVal, c: 3 } },
    { s: { r: kpiVal, c: 4 }, e: { r: kpiVal, c: 5 } },
    { s: { r: kpiVal, c: 6 }, e: { r: kpiVal, c: 8 } }
  );

  histRows.push(new Array(9).fill(''));

  // Encabezados tabla
  const tblHeaderRow = histRows.length;
  histRows.push([
    'Fecha y Hora',
    'Usuario',
    'Correo Electrónico',
    'Acción',
    'SKU',
    'Producto',
    'Valor Anterior',
    'Valor Nuevo',
    'Descripción del Evento',
  ]);

  const dataStartRow = histRows.length;
  logs.forEach((log) => {
    histRows.push([
      formatDate(log.timestamp),
      sanitizeCell(log.userName || 'Usuario'),
      sanitizeCell(log.userEmail || ''),
      log.action || 'acción',
      sanitizeCell(log.details?.sku || ''),
      sanitizeCell(log.details?.productName || ''),
      log.details?.previousValue ?? '',
      log.details?.newValue ?? '',
      sanitizeCell(log.details?.description || ''),
    ]);
  });

  const wsHist = XLSX.utils.aoa_to_sheet(histRows);
  wsHist['!merges'] = histMerges;
  wsHist['!views'] = [{ showGridLines: true }];

  applyExecutiveHeaderStyles(wsHist, hTitleIdx, hSubIdx, 9);

  // Estilos KPI
  const kpiConfigs = [
    { startC: 0, endC: 1, fill: PALETTE.cardBg, text: PALETTE.navyHero },
    { startC: 2, endC: 3, fill: PALETTE.infoFill, text: PALETTE.infoText },
    { startC: 4, endC: 5, fill: PALETTE.purpleFill, text: PALETTE.purpleText },
    { startC: 6, endC: 8, fill: PALETTE.successFill, text: PALETTE.successText },
  ];
  kpiConfigs.forEach(({ startC, endC, fill, text }) => {
    for (let c = startC; c <= endC; c++) {
      applyCellStyle(wsHist, XLSX.utils.encode_cell({ r: kpiLbl, c }), {
        font: { sz: 8.5, bold: true, color: { rgb: PALETTE.textMuted } },
        fill: { fgColor: { rgb: fill } },
        alignment: { horizontal: 'center' },
        border: BORDERS.card,
      });
      applyCellStyle(wsHist, XLSX.utils.encode_cell({ r: kpiVal, c }), {
        font: { sz: 16, bold: true, color: { rgb: text } },
        fill: { fgColor: { rgb: fill } },
        alignment: { horizontal: 'center' },
        border: BORDERS.card,
        numFmt: '#,##0',
      });
    }
  });

  // Headers de la tabla
  styleRowRange(wsHist, tblHeaderRow, 0, 8, {
    font: { sz: 9.5, bold: true, color: { rgb: PALETTE.textWhite } },
    fill: { fgColor: { rgb: PALETTE.navyHeader } },
    alignment: { horizontal: 'center' },
    border: BORDERS.header,
  });

  // Filas de datos
  logs.forEach((log, idx) => {
    const r = dataStartRow + idx;
    const isOdd = idx % 2 === 1;
    const rowFill = isOdd ? PALETTE.zebraOdd : PALETTE.zebraEven;

    // Col 0: Fecha y Hora
    applyCellStyle(wsHist, XLSX.utils.encode_cell({ r, c: 0 }), {
      font: { sz: 9, color: { rgb: PALETTE.textSecondary } },
      fill: { fgColor: { rgb: rowFill } },
      alignment: { horizontal: 'center' },
      border: BORDERS.delicate,
    });
    // Col 1: Usuario
    applyCellStyle(wsHist, XLSX.utils.encode_cell({ r, c: 1 }), {
      font: { sz: 9.5, bold: true },
      fill: { fgColor: { rgb: rowFill } },
      alignment: { horizontal: 'left' },
      border: BORDERS.delicate,
    });
    // Col 2: Correo
    applyCellStyle(wsHist, XLSX.utils.encode_cell({ r, c: 2 }), {
      font: { sz: 9, color: { rgb: PALETTE.textMuted } },
      fill: { fgColor: { rgb: rowFill } },
      alignment: { horizontal: 'left' },
      border: BORDERS.delicate,
    });
    // Col 3: Tipo de Acción
    let actFill = rowFill;
    let actText = PALETTE.textPrimary;
    const act = log.action || '';
    if (act.includes('creado') || act.includes('agregad')) {
      actFill = PALETTE.successFill;
      actText = PALETTE.successText;
    } else if (act.includes('eliminad') || act.includes('descontad')) {
      actFill = PALETTE.dangerFill;
      actText = PALETTE.dangerText;
    } else if (act.includes('editad')) {
      actFill = PALETTE.warningFill;
      actText = PALETTE.warningText;
    } else if (act.includes('excel') || act.includes('reporte') || act.includes('comparacion')) {
      actFill = PALETTE.purpleFill;
      actText = PALETTE.purpleText;
    }
    applyCellStyle(wsHist, XLSX.utils.encode_cell({ r, c: 3 }), {
      font: { sz: 9, bold: true, color: { rgb: actText } },
      fill: { fgColor: { rgb: actFill } },
      alignment: { horizontal: 'center' },
      border: BORDERS.delicate,
    });
    // Col 4: SKU
    applyCellStyle(wsHist, XLSX.utils.encode_cell({ r, c: 4 }), {
      font: { sz: 9.5, bold: true, color: { rgb: PALETTE.navyHero } },
      fill: { fgColor: { rgb: rowFill } },
      alignment: { horizontal: 'center' },
      border: BORDERS.delicate,
    });
    // Col 5: Producto
    applyCellStyle(wsHist, XLSX.utils.encode_cell({ r, c: 5 }), {
      font: { sz: 9.5 },
      fill: { fgColor: { rgb: rowFill } },
      alignment: { horizontal: 'left' },
      border: BORDERS.delicate,
    });
    // Col 6: Valor Anterior
    const prevIsNum = typeof log.details?.previousValue === 'number';
    applyCellStyle(wsHist, XLSX.utils.encode_cell({ r, c: 6 }), {
      font: { sz: 9.5 },
      fill: { fgColor: { rgb: rowFill } },
      alignment: { horizontal: prevIsNum ? 'right' : 'center' },
      border: BORDERS.delicate,
      numFmt: prevIsNum ? '#,##0' : undefined,
    });
    // Col 7: Valor Nuevo
    const nextIsNum = typeof log.details?.newValue === 'number';
    applyCellStyle(wsHist, XLSX.utils.encode_cell({ r, c: 7 }), {
      font: { sz: 9.5, bold: nextIsNum },
      fill: { fgColor: { rgb: rowFill } },
      alignment: { horizontal: nextIsNum ? 'right' : 'center' },
      border: BORDERS.delicate,
      numFmt: nextIsNum ? '#,##0' : undefined,
    });
    // Col 8: Descripción
    applyCellStyle(wsHist, XLSX.utils.encode_cell({ r, c: 8 }), {
      font: { sz: 9.5, color: { rgb: PALETTE.textSecondary } },
      fill: { fgColor: { rgb: rowFill } },
      alignment: { horizontal: 'left' },
      border: BORDERS.delicate,
    });
  });

  const hHeights = new Array(histRows.length).fill(21);
  hHeights[hTitleIdx] = 36;
  hHeights[hSubIdx] = 20;
  hHeights[kpiLbl] = 20;
  hHeights[kpiVal] = 30;
  hHeights[tblHeaderRow] = 24;
  wsHist['!rows'] = hHeights.map((h) => ({ hpt: h }));

  autoFitColumns(wsHist, histRows, {
    0: 20,
    1: 22,
    2: 26,
    3: 18,
    4: 18,
    5: 35,
    6: 15,
    7: 15,
    8: 45,
  });

  XLSX.utils.book_append_sheet(wb, wsHist, 'Historial de Auditoría');
  XLSX.writeFile(wb, filename);
}

/**
 * Descarga un workbook como archivo Excel
 */
export function downloadWorkbook(workbook, filename = 'reporte.xlsx') {
  XLSX.writeFile(workbook, filename);
}
