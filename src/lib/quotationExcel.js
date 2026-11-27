import * as XLSX from 'xlsx-js-style';
import { quotationLineTotals } from './quotation';

export function exportQuotationToExcel({
  quoteNumber,
  quoteDate,
  sellerName,
  companyRut,
  validityDays,
  rut,
  customer,
  activities,
  city,
  phone,
  email,
  notes,
  contactPhone,
  contactAddress,
  contactEmail,
  contactWeb,
  items,
  totals,
}) {
  const rows = [
    ['TODO TECHO / LEKER POLICARBONATO', '', '', '', '', 'N°', quoteNumber],
    [`RUT: ${companyRut}`, '', '', 'Especialistas en Policarbonato', '', 'Fecha:', quoteDate],
    ['', '', '', '', '', 'Vendedor:', sellerName],
    [],
    ['RUT:', rut, '', '', 'OBSERVACIONES:', notes || ''],
    ['CLIENTE:', customer, '', '', 'Validez:', `Presupuesto valido por ${validityDays} dias`],
    ['GIRO:', activities],
    ['CIUDAD:', city],
    ['FONO:', phone],
    ['E-MAIL:', email],
    [],
    ['CODIGO', 'VALOR', 'CANT', 'DESCRIPCIÓN', '$ TOTAL', '% DCTO.', '$ DCTO.', 'NETO'],
  ];

  for (const item of items) {
    const sku = String(item?.sku ?? '').trim();
    const name = String(item?.name ?? '').trim();
    const priceText = String(item?.price ?? '').trim();
    if (!sku && !name && (priceText === '' || Number(priceText) === 0)) continue;

    let calc = { gross: 0, discountPct: 0, discountAmount: 0, net: 0 };
    try {
      calc = quotationLineTotals(item);
    } catch {
      const q = Number(String(item.quantity ?? '').replace(',', '.')) || 0;
      const p = Number(item.price) || 0;
      const d = Number(String(item.discount ?? '').replace(',', '.')) || 0;
      calc.gross = Math.round(q * p);
      calc.discountPct = d;
      calc.discountAmount = Math.round(calc.gross * (d / 100));
      calc.net = calc.gross - calc.discountAmount;
    }

    rows.push([
      sku,
      Number(item.price) || 0,
      Number(String(item.quantity ?? '').replace(',', '.')) || 0,
      name,
      calc.gross,
      calc.discountPct / 100,
      calc.discountAmount,
      calc.net,
    ]);
  }

  rows.push([]);
  rows.push([contactPhone, '', '', contactAddress, '', '', 'NETO', totals.net]);
  rows.push([contactEmail, '', '', contactWeb, '', '', 'IVA', totals.tax]);
  rows.push(['', '', '', '', '', '', 'TOTAL', totals.total]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    { wch: 14 },
    { wch: 12 },
    { wch: 8 },
    { wch: 42 },
    { wch: 13 },
    { wch: 10 },
    { wch: 13 },
    { wch: 14 },
  ];

  const headerRowIdx = 11;
  for (let c = 0; c < 8; c += 1) {
    const ref = XLSX.utils.encode_cell({ r: headerRowIdx, c });
    if (ws[ref]) {
      ws[ref].s = {
        font: { bold: true, color: { rgb: 'FFFFFF' } },
        fill: { fgColor: { rgb: '1E3A8A' } },
        alignment: { horizontal: 'center' },
      };
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `Cotizacion_${quoteNumber || 'Borrador'}`);
  XLSX.writeFile(wb, `Cotizacion_${String(quoteNumber || 'borrador').replace(/[^a-zA-Z0-9_-]/g, '_')}.xlsx`);
}
