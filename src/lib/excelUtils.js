import * as XLSX from '@e965/xlsx';

/**
 * Lee un archivo Excel y retorna los datos como array de objetos JSON
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
        const json = XLSX.utils.sheet_to_json(worksheet);
        resolve(json);
      } catch (error) {
        reject(new Error('Error al leer el archivo Excel: ' + error.message));
      }
    };
    reader.onerror = () => reject(new Error('Error al cargar el archivo'));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Detecta automáticamente las columnas de SKU, Nombre y Cantidad en los datos
 * Soporta variaciones comunes de nombres de columna
 */
export function detectColumns(data) {
  if (!data || data.length === 0) return null;

  const headers = Object.keys(data[0]);

  const skuPatterns = /^(sku|codigo|código|cod|code|barcode|c[oó]digo.*(barra|producto)|id.*producto|item)/i;
  const namePatterns = /^(nombre|name|descripci[oó]n|description|producto|product|art[ií]culo|item.?name)/i;
  const qtyPatterns = /^(cantidad|qty|quantity|stock|existencia|unidades|units|cant)/i;

  const skuCol = headers.find((h) => skuPatterns.test(h));
  const nameCol = headers.find((h) => namePatterns.test(h));
  const qtyCol = headers.find((h) => qtyPatterns.test(h));

  return {
    sku: skuCol || null,
    name: nameCol || null,
    quantity: qtyCol || null,
    allHeaders: headers,
    detected: !!(skuCol && qtyCol),
  };
}

/**
 * Normaliza los datos del Excel a un formato estándar
 */
export function normalizeData(data, columnMapping) {
  return data.map((row) => ({
    sku: String(row[columnMapping.sku] || '').trim(),
    name: String(row[columnMapping.name] || '').trim(),
    quantity: parseInt(row[columnMapping.quantity]) || 0,
  }));
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

/**
 * Genera un archivo Excel con el reporte de diferencias
 */
export function generateDiffReport(comparisonResult, sessionName = 'Reporte') {
  const wb = XLSX.utils.book_new();

  // Hoja 1: Resumen
  const summaryData = [
    ['Reporte de Comparación de Inventarios'],
    [''],
    ['Fecha', new Date().toLocaleString('es-AR')],
    ['Sesión', sanitizeCell(sessionName)],
    [''],
    ['Resumen'],
    ['Total de productos', comparisonResult.summary.total],
    ['Productos nuevos', comparisonResult.summary.added],
    ['Productos eliminados', comparisonResult.summary.removed],
    ['Productos con cambios', comparisonResult.summary.changed],
    ['Productos sin cambios', comparisonResult.summary.unchanged],
    ['Total de diferencias', comparisonResult.summary.totalDifferences],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Resumen');

  // Hoja 2: Diferencias detalladas
  const diffHeaders = ['SKU', 'Nombre', 'Cantidad Anterior', 'Cantidad Actual', 'Diferencia', 'Estado'];
  const diffRows = comparisonResult.differences.map((d) => [
    sanitizeCell(d.sku),
    sanitizeCell(d.name),
    d.previousQty,
    d.currentQty,
    d.diff > 0 ? `+${d.diff}` : String(d.diff),
    d.status.charAt(0).toUpperCase() + d.status.slice(1),
  ]);
  const wsDiff = XLSX.utils.aoa_to_sheet([diffHeaders, ...diffRows]);
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
 * Genera y descarga un Excel con los datos actuales del inventario
 */
export function exportInventoryToExcel(products, filename = 'inventario.xlsx') {
  const wb = XLSX.utils.book_new();
  const headers = ['SKU', 'Nombre', 'Cantidad', 'Última Actualización'];
  const rows = products.map((p) => [
    sanitizeCell(p.sku),
    sanitizeCell(p.name),
    p.quantity,
    p.lastUpdated?.toDate ? p.lastUpdated.toDate().toLocaleString('es-AR') : '',
  ]);
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  XLSX.utils.book_append_sheet(wb, ws, 'Inventario');
  XLSX.writeFile(wb, filename);
}
