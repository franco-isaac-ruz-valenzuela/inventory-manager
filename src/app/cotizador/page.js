'use client';

import { useEffect, useRef, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { classifyActivities, normalizeRut, quotationTotals } from '../../lib/quotation';
import './quotation.css';

const money = value => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(value);

export default function CotizadorPage() {
  const { currentUser } = useAuth();
  const lookup = useRef(null);
  const [siiData, setSiiData] = useState(null);
  const [siiLoading, setSiiLoading] = useState(false);
  const [siiError, setSiiError] = useState('');
  const [rut, setRut] = useState('');
  const [customer, setCustomer] = useState('');
  const [activities, setActivities] = useState('');
  const [products, setProducts] = useState([]);
  const [productSearch, setProductSearch] = useState('');
  const [inventoryError, setInventoryError] = useState('');
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [notes, setNotes] = useState('');
  const validRut = normalizeRut(rut);
  useEffect(() => () => lookup.current?.abort(), []);
  const changeRut = value => {
    lookup.current?.abort();
    lookup.current = null;
    setSiiLoading(false); setSiiError(''); setSiiData(null);
    setRut(value); setCustomer(''); setActivities('');
  };
  const lookupRut = async () => {
    if (!validRut || !currentUser || siiLoading) return;
    lookup.current?.abort();
    const controller = new AbortController();
    lookup.current = controller;
    setSiiLoading(true); setSiiError(''); setSiiData(null); setCustomer(''); setActivities('');
    try {
      const token = await currentUser.getIdToken();
      if (controller.signal.aborted) return;
      const response = await fetch('/api/sii', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ rut: validRut }), signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo consultar el SII.');
      if (lookup.current !== controller) return;
      setCustomer(data.name); setActivities(data.activities.map(activity => activity.description).join('\n')); setSiiData(data);
    } catch (failure) {
      if (!controller.signal.aborted && lookup.current === controller) setSiiError(failure.message || 'No se pudo consultar el SII.');
    } finally {
      if (lookup.current === controller) { setSiiLoading(false); lookup.current = null; }
    }
  };
  let totals = null;
  try { totals = quotationTotals(items); } catch { /* Incomplete draft. */ }

  useEffect(() => onSnapshot(query(collection(db, 'products'), orderBy('sku', 'asc')), snapshot => {
    const loaded = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
    loaded.sort((a, b) => (a.sku || '').localeCompare(b.sku || '', 'es', { numeric: true }) || (a.name || '').localeCompare(b.name || '', 'es'));
    setProducts(loaded);
    setInventoryError('');
  }, () => setInventoryError('No se pudo cargar el inventario. Puedes agregar productos manualmente.')), []);

  const searchTerm = productSearch.trim().toLowerCase();
  const filteredProducts = searchTerm
    ? products.filter(product => {
        const sku = (product.sku || '').toLowerCase();
        const name = (product.name || '').toLowerCase();
        return searchTerm.split(/\s+/).every(kw => sku.includes(kw) || name.includes(kw));
      })
    : products;

  const addItem = product => {
    setItems(previous => [...previous, {
      id: crypto.randomUUID(), sku: product?.sku || '', name: product?.name || '', quantity: '1', price: '',
    }]);
    setProductSearch('');
  };
  const updateItem = (id, field, value) => setItems(previous => previous.map(item => item.id === id ? { ...item, [field]: value } : item));
  const printQuote = () => {
    setError('');
    if (!validRut || !customer.trim()) return setError('Ingresa un RUT válido y la razón social del cliente.');
    try {
      if (items.some(item => item.price === '')) throw new Error('Ingresa el precio neto de cada producto.');
      quotationTotals(items);
      window.print();
    } catch (failure) { setError(failure.message); }
  };

  return (
    <div className="quotation-page">
      <div className="page-header"><div><h1>Cotizador</h1><p>Prepara una cotización en pesos chilenos.</p></div>
        <button className="btn btn-primary quotation-controls" onClick={printQuote}>Imprimir / guardar PDF</button>
      </div>
      <section className="card quotation-card">
        <h2>Cliente</h2>
        <div className="quotation-grid">
          <label className="form-group">RUT<input className="form-input" value={rut} maxLength={12} placeholder="76.123.456-0" onChange={event => changeRut(event.target.value)} onBlur={() => { if (validRut) setRut(validRut); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); lookupRut(); } }} aria-invalid={!!rut && !validRut} /></label>
          <label className="form-group">Razón social<input className="form-input" value={customer} maxLength={200} disabled={siiLoading} onChange={event => { setCustomer(event.target.value); setSiiData(null); }} /></label>
        </div>
        {rut && !validRut && <p role="status">Revisa el RUT y su dígito verificador.</p>}
        <div className="quotation-controls">
          <button className="btn btn-primary" disabled={!validRut || !currentUser || siiLoading} onClick={lookupRut}>{siiLoading ? 'Consultando SII…' : 'Consultar RUT en SII'}</button>{' '}
          {validRut ? <a className="btn btn-secondary" href="https://www2.sii.cl/stc/noauthz" target="_blank" rel="noopener noreferrer">Abrir consulta del SII ↗</a> : <button className="btn btn-secondary" disabled>Abrir consulta del SII ↗</button>}
          <p className="quotation-hint">Ingresa el RUT y presiona Consultar o Enter para obtener la razón social y las actividades económicas vigentes.</p>
          {siiError && <p role="alert">{siiError}</p>}
        </div>
        {siiData && <div role="status"><p>Datos obtenidos del SII · Consulta: {siiData.consultedAt || 'realizada ahora'}</p><p>Inicio de actividades: {siiData.startedActivities === null ? 'Sin información' : siiData.startedActivities ? 'Sí' : 'No'}{siiData.startDate && ` · ${siiData.startDate}`}</p>
          <details><summary>Ver actividades económicas vigentes ({siiData.activities.length})</summary>{siiData.activities.length ? <ul>{siiData.activities.map((activity, index) => <li key={`${activity.code}-${index}`}><strong>{activity.code}</strong> — {activity.description}{activity.startDate && ` · Desde ${activity.startDate}`}</li>)}</ul> : <p>El SII no informa actividades económicas vigentes.</p>}</details>
        </div>}
        <label className="form-group">Actividades económicas consultadas en el SII<textarea className="form-input" value={activities} disabled={siiLoading} maxLength={5000} rows={3} onChange={event => { setActivities(event.target.value); setSiiData(null); }} placeholder="Se completan al consultar. También puedes ingresarlas manualmente." /></label>
        <p aria-live="polite"><strong>Tipo sugerido: {classifyActivities(siiData?.activities || activities)}</strong></p>
        <p className="quotation-hint">{siiData ? 'Clasificación sugerida por la aplicación según los giros obtenidos del SII.' : 'Clasificación sugerida según el texto ingresado, sin verificación del SII.'} El giro no modifica los precios.</p>
      </section>
      <section className="card quotation-card">
        <h2>Detalle de cotización</h2>
        <div className="quotation-controls quotation-actions">
          <div className="quotation-search-wrap">
            <input
              type="text"
              className="form-input"
              aria-label="Buscar producto por código o nombre"
              placeholder="Buscar por código (SKU) o nombre…"
              value={productSearch}
              onChange={event => setProductSearch(event.target.value)}
              onKeyDown={event => {
                if (event.key !== 'Enter' || !searchTerm) return;
                event.preventDefault();
                const exactSku = filteredProducts.find(p => (p.sku || '').trim().toLowerCase() === searchTerm);
                if (exactSku) addItem(exactSku);
                else if (filteredProducts.length === 1) addItem(filteredProducts[0]);
              }}
            />
            {searchTerm && (
              <div className="quotation-search-results" role="listbox" aria-label="Resultados de productos">
                {filteredProducts.length ? filteredProducts.slice(0, 10).map(product => (
                  <button
                    key={product.id}
                    type="button"
                    className="quotation-search-option"
                    onClick={() => addItem(product)}
                  >
                    <strong>{product.sku || 'SIN CÓDIGO'}</strong>
                    <small>{product.name}</small>
                  </button>
                )) : (
                  <div className="quotation-search-option" style={{ cursor: 'default', opacity: 0.7 }}>
                    Sin coincidencias para &quot;{productSearch}&quot;
                  </div>
                )}
              </div>
            )}
          </div>
          <select className="form-input" aria-label="Agregar producto del inventario por código" value="" onChange={event => { const product = products.find(item => item.id === event.target.value); if (product) addItem(product); }}>
            <option value="">Seleccionar por código (SKU)…</option>
            {products.map(product => <option key={product.id} value={product.id}>{product.sku} — {product.name}</option>)}
          </select>
          <button className="btn btn-secondary" onClick={() => addItem()}>Agregar producto manual</button>
        </div>
        {inventoryError && <p role="status">{inventoryError}</p>}
        <p className="quotation-hint">Ingresa los precios netos en CLP. El inventario no incluye una lista de precios para cotización.</p>
        <div className="table-container"><table><thead><tr><th>Código (SKU)</th><th>Cantidad</th><th>Precio neto (CLP)</th><th className="quotation-controls">Acción</th></tr></thead><tbody>
          {!items.length && <tr><td colSpan={4}>Agrega productos para comenzar.</td></tr>}
          {items.map((item, index) => <tr key={item.id}>
            <td>
              <input className="form-input quotation-code-input" aria-label={`Código ${index + 1}`} placeholder="Código (SKU)" value={item.sku} maxLength={100} onChange={event => updateItem(item.id, 'sku', event.target.value)} />
              <input className="form-input quotation-subinput" aria-label={`Descripción ${index + 1}`} placeholder="Nombre / descripción (opcional)" value={item.name} maxLength={200} onChange={event => updateItem(item.id, 'name', event.target.value)} />
            </td>
            <td><input className="form-input" aria-label={`Cantidad ${index + 1}`} type="number" min="0.01" step="0.01" max="1000000000" value={item.quantity} onChange={event => updateItem(item.id, 'quantity', event.target.value)} /></td>
            <td><input className="form-input" aria-label={`Precio neto ${index + 1}`} type="number" min="0" step="1" max="1000000000" value={item.price} onChange={event => updateItem(item.id, 'price', event.target.value)} /></td>
            <td className="quotation-controls"><button className="btn btn-secondary" aria-label={`Quitar producto ${index + 1}`} onClick={() => setItems(previous => previous.filter(row => row.id !== item.id))}>Quitar</button></td>
          </tr>)}
        </tbody></table></div>
        {totals && !items.some(item => item.price === '') && <div className="quotation-totals" aria-live="polite"><p>Neto: {money(totals.net)}</p><p>IVA (19%): {money(totals.tax)}</p><h2>Total: {money(totals.total)}</h2></div>}
        <label className="form-group">Observaciones y condiciones<textarea className="form-input" rows={3} maxLength={2000} value={notes} onChange={event => setNotes(event.target.value)} /></label>
        <p className="quotation-hint quotation-controls">Borrador de esta sesión: no se guarda al salir de este apartado. Guarda un PDF para conservarlo.</p>
        {error && <p role="alert">{error}</p>}
      </section>
    </div>
  );
}
