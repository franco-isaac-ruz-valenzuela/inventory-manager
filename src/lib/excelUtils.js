import * as XLSX from '@e965/xlsx';

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
 * Retorna el índice de la fila de headers, o -1 si no se encuentra.
 */
function findHeaderRowIndex(rawRows) {
  for (let i = 0; i < Math.min(rawRows.length, 20); i++) {
    const row = rawRows[i];
    if (!row || row.length < 2) continue;
    const cells = row.map((c) => String(c || '').trim()).filter(Boolean);
    if (cells.length < 2) continue;

    // Buscar si al menos 2 de los 3 patrones coinciden
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
 * (ej: "Total Sub Grupo : ...", "Total Grupo : ...", "Total Final : ...")
 */
function isSummaryRow(row) {
  const first = String(row[0] || '').trim();
  return /^Total\s+(Sub\s+)?Grupo|^Total\s+Final/i.test(first);
}

/**
 * Lee un archivo Excel y retorna los datos como array de objetos JSON.
 * Detecta automáticamente la fila de headers reales incluso en reportes ERP
 * que tienen filas de título, filas vacías y filas de totales intermedios.
 * @param {File} file - Archivo Excel subido
 * @returns {Promise<Array>} Array de objetos con los datos del Excel
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

        // Primero, intentar lectura raw para detectar si es formato ERP
        const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
        const headerIdx = findHeaderRowIndex(rawRows);

        if (headerIdx > 0) {
          // Formato ERP detectado: construir JSON usando el header real
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
          // Formato estándar: lectura normal
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
 * Soporta variaciones comunes de nombres de columna incluyendo reportes ERP
 * (ej: "Cod. Producto", "Producto", "Stock Total").
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
 * Si un mismo SKU aparece en múltiples filas (ej: diferentes ubicaciones),
 * se suman sus cantidades y se mantiene el nombre/categoría del primer registro.
 * @param {Array} normalizedData - Datos normalizados (con sku, name, quantity, category)
 * @returns {{ consolidated: Array, duplicatesFound: number, duplicateDetails: Array }}
 */
export function consolidateDuplicates(normalizedData) {
  const skuMap = new Map();
  const duplicateDetails = [];

  for (const item of normalizedData) {
    const key = item.sku.toLowerCase();
    if (skuMap.has(key)) {
      const existing = skuMap.get(key);
      const prevQty = existing.quantity;
      existing.quantity += item.quantity;
      // Guardar nombre más largo (más descriptivo)
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

  // Limpiar campo temporal _count
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
 * @param {Array} previousData - Datos del inventario anterior (normalizado)
 * @param {Array} currentData - Datos del inventario actual (normalizado)
 * @returns {object} Resultado de la comparación con diferencias
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

  // Productos que están en el anterior
  prevMap.forEach((prevItem, sku) => {
    const currItem = currMap.get(sku);
    if (!currItem) {
      // Producto eliminado (solo en anterior)
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
      // Producto con diferencia de cantidad
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

  // Productos nuevos (solo en actual)
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

  // Ordenar: eliminados primero, luego modificados, luego nuevos
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

function sanitizeCell(val) {
  if (typeof val === 'string' && /^[=+\-@\t\r]/.test(val.trim())) {
    return `'${val}`;
  }
  return val;
}

/* ============================================
   ESTILOS PARA EXCEL
   ============================================ */

const STYLES = {
  titleFont: { bold: true, sz: 16, color: { rgb: 'FFFFFF' } },
  titleFill: { fgColor: { rgb: '0F0F23' } },
  headerFont: { bold: true, sz: 11, color: { rgb: 'FFFFFF' } },
  headerFill: { fgColor: { rgb: '1E3A5F' } },
  categoryHeaderFont: { bold: true, sz: 13, color: { rgb: 'FFFFFF' } },
  subtotalFont: { bold: true, sz: 11, color: { rgb: '1E3A5F' } },
  subtotalFill: { fgColor: { rgb: 'E8F4FD' } },
  summaryHeaderFill: { fgColor: { rgb: '0D47A1' } },
  border: {
    top: { style: 'thin', color: { rgb: 'D0D0D0' } },
    bottom: { style: 'thin', color: { rgb: 'D0D0D0' } },
    left: { style: 'thin', color: { rgb: 'D0D0D0' } },
    right: { style: 'thin', color: { rgb: 'D0D0D0' } },
  },
  borderThick: {
    top: { style: 'medium', color: { rgb: '1E3A5F' } },
    bottom: { style: 'medium', color: { rgb: '1E3A5F' } },
    left: { style: 'medium', color: { rgb: '1E3A5F' } },
    right: { style: 'medium', color: { rgb: '1E3A5F' } },
  },
};

// Colores por categoría para Excel
const CATEGORY_EXCEL_COLORS = {
  'ONDULADAS': '0097A7',
  'GRECA': '7B1FA2',
  'ALVEOLAR': '2E7D32',
  'PERFILES': 'F57F17',
  'INDUSTRIAL': 'C62828',
  'PACK': '1565C0',
  'COMPACTO': 'AD1457',
  'ACCESORIOS': '6A1B9A',
  'ROLLO': '00838F',
  'MATERIAS PRIMAS': 'E65100',
  'OTROS': '546E7A',
  'PLANCHAS METALICAS': '37474F',
  'PINTURAS Y ADHESIVOS': '8E24AA',
  'CANALETAS Y ACCESORIOS': '2E7D32',
  'SIN CATEGORÍA': '78909C',
};

function getCategoryColor(cat) {
  return CATEGORY_EXCEL_COLORS[(cat || '').toUpperCase()] || '546E7A';
}

/**
 * Aplica estilos a un rango de celdas
 */
function applyCellStyle(ws, cellRef, style) {
  if (!ws[cellRef]) ws[cellRef] = { v: '', t: 's' };
  ws[cellRef].s = style;
}

/**
 * Auto-ajusta el ancho de columnas basado en el contenido
 */
function autoFitColumns(ws, data, headers) {
  const colWidths = headers.map((h) => h.length);
  data.forEach((row) => {
    row.forEach((cell, i) => {
      const len = String(cell || '').length;
      if (len > colWidths[i]) colWidths[i] = len;
    });
  });
  ws['!cols'] = colWidths.map((w) => ({ wch: Math.min(Math.max(w + 2, 8), 50) }));
}

/**
 * Genera un archivo Excel con el reporte de diferencias — diseño por secciones
 */
export function generateDiffReport(comparisonResult, sessionName = 'Reporte') {
  const wb = XLSX.utils.book_new();

  // ==========================================
  // HOJA 1: RESUMEN EJECUTIVO
  // ==========================================
  const summaryData = [
    ['REPORTE DE COMPARACIÓN DE INVENTARIOS'],
    [''],
    ['Información General'],
    ['Fecha', new Date().toLocaleString('es-AR')],
    ['Sesión', sanitizeCell(sessionName)],
    [''],
    ['Resumen de Resultados'],
    ['Total de productos analizados', comparisonResult.summary.total],
    ['Productos nuevos', comparisonResult.summary.added],
    ['Productos eliminados', comparisonResult.summary.removed],
    ['Productos con cambios de stock', comparisonResult.summary.changed],
    ['Productos sin cambios', comparisonResult.summary.unchanged],
    ['Total de diferencias encontradas', comparisonResult.summary.totalDifferences],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);

  // Estilo título
  applyCellStyle(wsSummary, 'A1', {
    font: STYLES.titleFont,
    fill: STYLES.titleFill,
    alignment: { horizontal: 'center' },
    border: STYLES.borderThick,
  });
  wsSummary['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];

  // Estilo sección headers
  ['A3', 'A7'].forEach((ref) => {
    applyCellStyle(wsSummary, ref, {
      font: { bold: true, sz: 13, color: { rgb: '1E3A5F' } },
      fill: { fgColor: { rgb: 'E8F4FD' } },
      border: STYLES.border,
    });
  });

  // Estilo datos
  for (let r = 3; r <= 12; r++) {
    applyCellStyle(wsSummary, `A${r + 1}`, {
      font: { sz: 11 },
      border: STYLES.border,
    });
    applyCellStyle(wsSummary, `B${r + 1}`, {
      font: { bold: true, sz: 11 },
      border: STYLES.border,
      alignment: { horizontal: 'right' },
    });
  }

  wsSummary['!cols'] = [{ wch: 40 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Resumen');

  // ==========================================
  // HOJA 2: DIFERENCIAS POR SECCIÓN (ESTADO)
  // ==========================================
  const statusGroups = {
    'eliminado': { label: '🔴 PRODUCTOS ELIMINADOS', color: 'C62828', items: [] },
    'modificado': { label: '🟡 PRODUCTOS CON CAMBIOS DE STOCK', color: 'F57F17', items: [] },
    'nuevo': { label: '🟢 PRODUCTOS NUEVOS', color: '2E7D32', items: [] },
  };

  comparisonResult.differences.forEach((d) => {
    if (statusGroups[d.status]) {
      statusGroups[d.status].items.push(d);
    }
  });

  const diffRows = [];
  const diffMerges = [];
  const diffStyleRows = [];

  Object.entries(statusGroups).forEach(([status, group]) => {
    if (group.items.length === 0) return;

    // Sección header
    const sectionStartRow = diffRows.length;
    diffRows.push([`${group.label} (${group.items.length})`, '', '', '', '', '']);
    diffStyleRows.push({
      row: sectionStartRow,
      type: 'sectionHeader',
      color: group.color,
    });
    diffMerges.push({ s: { r: sectionStartRow, c: 0 }, e: { r: sectionStartRow, c: 5 } });

    // Column headers
    diffRows.push(['SKU', 'Nombre', 'Cantidad Anterior', 'Cantidad Actual', 'Diferencia', 'Estado']);
    diffStyleRows.push({ row: diffRows.length - 1, type: 'columnHeader' });

    // Data rows
    group.items.forEach((d) => {
      diffRows.push([
        sanitizeCell(d.sku),
        sanitizeCell(d.name),
        d.previousQty,
        d.currentQty,
        d.diff > 0 ? `+${d.diff}` : String(d.diff),
        d.status.charAt(0).toUpperCase() + d.status.slice(1),
      ]);
      diffStyleRows.push({ row: diffRows.length - 1, type: 'data' });
    });

    // Subtotal row
    const totalDiff = group.items.reduce((s, d) => s + d.diff, 0);
    diffRows.push(['', `Subtotal ${group.label.split(' ').slice(1).join(' ')}`, '', '', totalDiff > 0 ? `+${totalDiff}` : String(totalDiff), `${group.items.length} productos`]);
    diffStyleRows.push({ row: diffRows.length - 1, type: 'subtotal' });

    // Spacer
    diffRows.push(['', '', '', '', '', '']);
  });

  const wsDiff = XLSX.utils.aoa_to_sheet(diffRows);

  // Apply styles to diff sheet
  diffStyleRows.forEach(({ row, type, color }) => {
    const cols = ['A', 'B', 'C', 'D', 'E', 'F'];
    if (type === 'sectionHeader') {
      cols.forEach((col) => {
        applyCellStyle(wsDiff, `${col}${row + 1}`, {
          font: { bold: true, sz: 12, color: { rgb: 'FFFFFF' } },
          fill: { fgColor: { rgb: color } },
          alignment: { horizontal: col === 'A' ? 'left' : 'center' },
          border: STYLES.borderThick,
        });
      });
    } else if (type === 'columnHeader') {
      cols.forEach((col) => {
        applyCellStyle(wsDiff, `${col}${row + 1}`, {
          font: STYLES.headerFont,
          fill: STYLES.headerFill,
          alignment: { horizontal: 'center' },
          border: STYLES.border,
        });
      });
    } else if (type === 'subtotal') {
      cols.forEach((col) => {
        applyCellStyle(wsDiff, `${col}${row + 1}`, {
          font: STYLES.subtotalFont,
          fill: STYLES.subtotalFill,
          border: STYLES.border,
          alignment: { horizontal: col === 'B' ? 'left' : 'right' },
        });
      });
    } else if (type === 'data') {
      cols.forEach((col) => {
        applyCellStyle(wsDiff, `${col}${row + 1}`, {
          font: { sz: 10 },
          border: STYLES.border,
          alignment: { horizontal: ['C', 'D', 'E'].includes(col) ? 'center' : 'left' },
        });
      });
    }
  });

  wsDiff['!merges'] = diffMerges;
  wsDiff['!cols'] = [{ wch: 20 }, { wch: 40 }, { wch: 18 }, { wch: 18 }, { wch: 14 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsDiff, 'Diferencias');

  return wb;
}

/**
 * Descarga un workbook como archivo Excel
 */
export function downloadWorkbook(workbook, filename = 'reporte.xlsx') {
  XLSX.writeFile(workbook, filename);
}

/**
 * Genera y descarga un Excel con los datos actuales del inventario.
 * Versión mejorada con diseño por secciones (categorías), estilos y resumen.
 */
export function exportInventoryToExcel(products, filename = 'inventario.xlsx') {
  const wb = XLSX.utils.book_new();

  // ==========================================
  // Agrupar productos por categoría
  // ==========================================
  const categoryGroups = {};
  let totalProducts = 0;
  let totalUnits = 0;

  products.forEach((p) => {
    const cat = (p.category || 'SIN CATEGORÍA').toUpperCase();
    if (!categoryGroups[cat]) categoryGroups[cat] = [];
    categoryGroups[cat].push(p);
    totalProducts++;
    totalUnits += p.quantity || 0;
  });

  const sortedCategories = Object.keys(categoryGroups).sort((a, b) => {
    if (a === 'SIN CATEGORÍA') return 1;
    if (b === 'SIN CATEGORÍA') return -1;
    return a.localeCompare(b);
  });

  // ==========================================
  // HOJA 1: RESUMEN GENERAL
  // ==========================================
  const now = new Date().toLocaleString('es-AR');
  const summaryRows = [
    ['INVENTARIO — RESUMEN POR SECCIONES'],
    [''],
    ['Fecha de exportación', now],
    ['Total de productos', totalProducts],
    ['Total de unidades en stock', totalUnits],
    ['Categorías', sortedCategories.length],
    [''],
    ['RESUMEN POR CATEGORÍA'],
    ['Categoría', 'Productos', 'Unidades Totales', '% del Stock'],
  ];

  sortedCategories.forEach((cat) => {
    const items = categoryGroups[cat];
    const catUnits = items.reduce((s, p) => s + (p.quantity || 0), 0);
    const pct = totalUnits > 0 ? ((catUnits / totalUnits) * 100).toFixed(1) + '%' : '0%';
    summaryRows.push([cat, items.length, catUnits, pct]);
  });

  // Fila de totales
  summaryRows.push(['']);
  summaryRows.push(['TOTAL', totalProducts, totalUnits, '100%']);

  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);

  // Estilos del resumen
  // Título principal
  applyCellStyle(wsSummary, 'A1', {
    font: { bold: true, sz: 16, color: { rgb: 'FFFFFF' } },
    fill: { fgColor: { rgb: '0D1B2A' } },
    alignment: { horizontal: 'center' },
    border: STYLES.borderThick,
  });
  wsSummary['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 3 } },
    { s: { r: 7, c: 0 }, e: { r: 7, c: 3 } },
  ];

  // Info rows
  for (let r = 2; r <= 5; r++) {
    applyCellStyle(wsSummary, `A${r + 1}`, {
      font: { sz: 11, color: { rgb: '555555' } },
      border: STYLES.border,
    });
    applyCellStyle(wsSummary, `B${r + 1}`, {
      font: { bold: true, sz: 11 },
      border: STYLES.border,
      alignment: { horizontal: 'right' },
    });
  }

  // Subtítulo "RESUMEN POR CATEGORÍA"
  applyCellStyle(wsSummary, 'A8', {
    font: { bold: true, sz: 13, color: { rgb: 'FFFFFF' } },
    fill: { fgColor: { rgb: '1B5E20' } },
    alignment: { horizontal: 'center' },
    border: STYLES.borderThick,
  });

  // Header de tabla
  const headerCols = ['A', 'B', 'C', 'D'];
  headerCols.forEach((col) => {
    applyCellStyle(wsSummary, `${col}9`, {
      font: STYLES.headerFont,
      fill: { fgColor: { rgb: '263238' } },
      alignment: { horizontal: col === 'A' ? 'left' : 'center' },
      border: STYLES.border,
    });
  });

  // Filas de categoría
  sortedCategories.forEach((cat, idx) => {
    const rowNum = 10 + idx;
    const catColor = getCategoryColor(cat);
    applyCellStyle(wsSummary, `A${rowNum}`, {
      font: { bold: true, sz: 11, color: { rgb: catColor } },
      border: STYLES.border,
    });
    ['B', 'C', 'D'].forEach((col) => {
      applyCellStyle(wsSummary, `${col}${rowNum}`, {
        font: { sz: 11 },
        border: STYLES.border,
        alignment: { horizontal: 'center' },
      });
    });
  });

  // Fila de total
  const totalRowNum = 10 + sortedCategories.length + 1;
  headerCols.forEach((col) => {
    applyCellStyle(wsSummary, `${col}${totalRowNum}`, {
      font: { bold: true, sz: 12, color: { rgb: '0D1B2A' } },
      fill: { fgColor: { rgb: 'E3F2FD' } },
      border: STYLES.borderThick,
      alignment: { horizontal: col === 'A' ? 'left' : 'center' },
    });
  });

  wsSummary['!cols'] = [{ wch: 30 }, { wch: 15 }, { wch: 20 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Resumen');

  // ==========================================
  // HOJA 2: INVENTARIO COMPLETO POR SECCIONES
  // ==========================================
  const allRows = [];
  const allMerges = [];
  const allStyleRows = [];

  // Título
  allRows.push(['INVENTARIO COMPLETO — ORGANIZADO POR SECCIONES', '', '', '', '']);
  allStyleRows.push({ row: 0, type: 'mainTitle' });
  allMerges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: 4 } });
  allRows.push(['Exportado: ' + now, '', '', '', '']);
  allStyleRows.push({ row: 1, type: 'subtitle' });
  allMerges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: 4 } });
  allRows.push(['', '', '', '', '']); // spacer

  sortedCategories.forEach((cat) => {
    const items = categoryGroups[cat];
    const catUnits = items.reduce((s, p) => s + (p.quantity || 0), 0);
    const catColor = getCategoryColor(cat);

    // Section header
    const secRow = allRows.length;
    allRows.push([`▶ ${cat}`, '', `${items.length} productos`, `${catUnits} unidades`, '']);
    allStyleRows.push({ row: secRow, type: 'sectionHeader', color: catColor });
    allMerges.push({ s: { r: secRow, c: 0 }, e: { r: secRow, c: 1 } });

    // Column headers
    allRows.push(['SKU', 'Nombre del Producto', 'Cantidad', 'Última Actualización', '']);
    allStyleRows.push({ row: allRows.length - 1, type: 'columnHeader' });

    // Sort items by name
    const sorted = [...items].sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    sorted.forEach((p) => {
      const lastUpd = p.lastUpdated?.toDate
        ? p.lastUpdated.toDate().toLocaleString('es-AR')
        : '';
      allRows.push([
        sanitizeCell(p.sku),
        sanitizeCell(p.name),
        p.quantity,
        lastUpd,
        '',
      ]);
      allStyleRows.push({
        row: allRows.length - 1,
        type: 'data',
        warning: p.quantity <= 5,
        negative: p.quantity < 0,
      });
    });

    // Subtotal
    allRows.push(['', `Subtotal ${cat}`, catUnits, `${items.length} productos`, '']);
    allStyleRows.push({ row: allRows.length - 1, type: 'subtotal' });

    // Spacer
    allRows.push(['', '', '', '', '']);
  });

  // Grand total row
  allRows.push(['TOTAL GENERAL', '', totalUnits, `${totalProducts} productos`, '']);
  allStyleRows.push({ row: allRows.length - 1, type: 'grandTotal' });
  allMerges.push({ s: { r: allRows.length - 1, c: 0 }, e: { r: allRows.length - 1, c: 1 } });

  const wsAll = XLSX.utils.aoa_to_sheet(allRows);

  // Apply styles
  allStyleRows.forEach(({ row, type, color, warning, negative }) => {
    const cols = ['A', 'B', 'C', 'D', 'E'];
    if (type === 'mainTitle') {
      cols.forEach((col) => {
        applyCellStyle(wsAll, `${col}${row + 1}`, {
          font: { bold: true, sz: 16, color: { rgb: 'FFFFFF' } },
          fill: { fgColor: { rgb: '0D1B2A' } },
          alignment: { horizontal: 'center', vertical: 'center' },
          border: STYLES.borderThick,
        });
      });
    } else if (type === 'subtitle') {
      cols.forEach((col) => {
        applyCellStyle(wsAll, `${col}${row + 1}`, {
          font: { sz: 10, color: { rgb: '888888' } },
          alignment: { horizontal: 'center' },
        });
      });
    } else if (type === 'sectionHeader') {
      cols.forEach((col, ci) => {
        applyCellStyle(wsAll, `${col}${row + 1}`, {
          font: { bold: true, sz: 12, color: { rgb: 'FFFFFF' } },
          fill: { fgColor: { rgb: color || '37474F' } },
          alignment: { horizontal: ci >= 2 ? 'center' : 'left', vertical: 'center' },
          border: STYLES.borderThick,
        });
      });
    } else if (type === 'columnHeader') {
      cols.forEach((col) => {
        applyCellStyle(wsAll, `${col}${row + 1}`, {
          font: { bold: true, sz: 10, color: { rgb: 'FFFFFF' } },
          fill: { fgColor: { rgb: '455A64' } },
          alignment: { horizontal: 'center' },
          border: STYLES.border,
        });
      });
    } else if (type === 'data') {
      cols.forEach((col) => {
        const isQty = col === 'C';
        const fontColor = negative ? 'C62828' : warning ? 'E65100' : '333333';
        applyCellStyle(wsAll, `${col}${row + 1}`, {
          font: { sz: 10, color: { rgb: fontColor }, bold: isQty },
          border: STYLES.border,
          alignment: { horizontal: isQty ? 'center' : 'left' },
          fill: negative
            ? { fgColor: { rgb: 'FFEBEE' } }
            : warning
              ? { fgColor: { rgb: 'FFF8E1' } }
              : undefined,
        });
      });
    } else if (type === 'subtotal') {
      cols.forEach((col) => {
        applyCellStyle(wsAll, `${col}${row + 1}`, {
          font: { bold: true, sz: 10, color: { rgb: '1B5E20' } },
          fill: { fgColor: { rgb: 'E8F5E9' } },
          border: STYLES.border,
          alignment: { horizontal: ['C', 'D'].includes(col) ? 'center' : 'right' },
        });
      });
    } else if (type === 'grandTotal') {
      cols.forEach((col) => {
        applyCellStyle(wsAll, `${col}${row + 1}`, {
          font: { bold: true, sz: 12, color: { rgb: 'FFFFFF' } },
          fill: { fgColor: { rgb: '0D1B2A' } },
          border: STYLES.borderThick,
          alignment: { horizontal: 'center' },
        });
      });
    }
  });

  wsAll['!merges'] = allMerges;
  wsAll['!cols'] = [{ wch: 22 }, { wch: 45 }, { wch: 14 }, { wch: 22 }, { wch: 5 }];
  XLSX.utils.book_append_sheet(wb, wsAll, 'Inventario Completo');

  // ==========================================
  // HOJAS INDIVIDUALES POR CATEGORÍA
  // ==========================================
  sortedCategories.forEach((cat) => {
    const items = categoryGroups[cat];
    const catUnits = items.reduce((s, p) => s + (p.quantity || 0), 0);
    const catColor = getCategoryColor(cat);

    const catRows = [
      [`SECCIÓN: ${cat}`],
      [`${items.length} productos • ${catUnits} unidades en stock`],
      [''],
      ['SKU', 'Nombre del Producto', 'Cantidad', 'Última Actualización'],
    ];

    const sorted = [...items].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    sorted.forEach((p) => {
      catRows.push([
        sanitizeCell(p.sku),
        sanitizeCell(p.name),
        p.quantity,
        p.lastUpdated?.toDate ? p.lastUpdated.toDate().toLocaleString('es-AR') : '',
      ]);
    });

    // Total row
    catRows.push(['']);
    catRows.push(['TOTAL', '', catUnits, `${items.length} productos`]);

    const wsCat = XLSX.utils.aoa_to_sheet(catRows);

    // Estilos
    // Título de sección
    applyCellStyle(wsCat, 'A1', {
      font: { bold: true, sz: 14, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: catColor } },
      alignment: { horizontal: 'center' },
      border: STYLES.borderThick,
    });
    wsCat['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 3 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 3 } },
    ];

    // Subtítulo
    applyCellStyle(wsCat, 'A2', {
      font: { sz: 10, color: { rgb: '666666' } },
      alignment: { horizontal: 'center' },
    });

    // Headers
    ['A', 'B', 'C', 'D'].forEach((col) => {
      applyCellStyle(wsCat, `${col}4`, {
        font: STYLES.headerFont,
        fill: { fgColor: { rgb: '37474F' } },
        alignment: { horizontal: 'center' },
        border: STYLES.border,
      });
    });

    // Data rows
    for (let i = 0; i < sorted.length; i++) {
      const rowNum = 5 + i;
      const p = sorted[i];
      ['A', 'B', 'C', 'D'].forEach((col) => {
        const isQty = col === 'C';
        const fontColor = p.quantity < 0 ? 'C62828' : p.quantity <= 5 ? 'E65100' : '333333';
        applyCellStyle(wsCat, `${col}${rowNum}`, {
          font: { sz: 10, color: { rgb: fontColor }, bold: isQty },
          border: STYLES.border,
          alignment: { horizontal: isQty ? 'center' : 'left' },
          fill: p.quantity < 0
            ? { fgColor: { rgb: 'FFEBEE' } }
            : p.quantity <= 5
              ? { fgColor: { rgb: 'FFF8E1' } }
              : undefined,
        });
      });
    }

    // Total row
    const totalRow = 5 + sorted.length + 1;
    ['A', 'B', 'C', 'D'].forEach((col) => {
      applyCellStyle(wsCat, `${col}${totalRow}`, {
        font: { bold: true, sz: 11, color: { rgb: 'FFFFFF' } },
        fill: { fgColor: { rgb: catColor } },
        border: STYLES.borderThick,
        alignment: { horizontal: 'center' },
      });
    });

    wsCat['!cols'] = [{ wch: 22 }, { wch: 45 }, { wch: 14 }, { wch: 22 }];

    // Nombre de hoja (máx 31 chars, sin caracteres especiales)
    const sheetName = cat.substring(0, 31).replace(/[\\/*?\[\]:]/g, '-');
    XLSX.utils.book_append_sheet(wb, wsCat, sheetName);
  });

  XLSX.writeFile(wb, filename);
}
