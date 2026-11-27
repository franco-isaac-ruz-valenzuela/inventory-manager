'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, orderBy, query, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { buildPurchaseChanges, buildWhatsAppQuoteText, classifyActivities, incrementQuoteNumber, normalizeRut, quotationLineTotals, quotationTotals } from '../../lib/quotation';
import { commitInventoryChanges } from '../../lib/inventoryOperations';
import { lookupProductPrice, PRODUCT_PRICE_LIST } from '../../lib/priceList';
import { exportQuotationToExcel } from '../../lib/quotationExcel';
import './quotation.css';

const QUOTES_STORAGE_KEY = 'leker_saved_quotations_v1';

function readLocalQuotes() {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(QUOTES_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeLocalQuote(quote) {
  if (typeof window === 'undefined') return;
  try {
    const all = readLocalQuotes();
    all[quote.quoteNumber] = quote;
    window.localStorage.setItem(QUOTES_STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Ignore storage quota errors
  }
}

function deleteLocalQuote(quoteNumber) {
  if (typeof window === 'undefined') return;
  try {
    const all = readLocalQuotes();
    delete all[quoteNumber];
    window.localStorage.setItem(QUOTES_STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Ignore storage errors
  }
}

const formatNumber = value => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(value || 0));
const formatCurrency = value => `$ ${formatNumber(value)}`;
const formatCompactCurrency = value => `$${formatNumber(value)}`;

const todayFormatted = () => {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
};

const createEmptyItem = (product = null) => {
  const sku = product?.sku || '';
  const priceEntry = lookupProductPrice(sku, product?.name || '');
  return {
    id: crypto.randomUUID(),
    sku,
    name: product?.name || priceEntry?.name || '',
    quantity: product ? '1' : '0',
    price: priceEntry ? String(priceEntry.listPrice) : '',
    discount: '0',
  };
};

const isRowBlank = item =>
  !String(item.sku ?? '').trim() &&
  !String(item.name ?? '').trim() &&
  (String(item.price ?? '').trim() === '' || Number(item.price) === 0);

/* ─── Toast Notification System ─── */
function ToastContainer({ toasts, onDismiss }) {
  return (
    <div className="toast-container" aria-live="polite">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.type}`} role="status">
          <i className={`bi ${t.type === 'success' ? 'bi-check-circle-fill' : t.type === 'error' ? 'bi-exclamation-triangle-fill' : 'bi-info-circle-fill'}`} />
          <span className="toast-text">{t.message}</span>
          <button type="button" className="toast-close" onClick={() => onDismiss(t.id)} aria-label="Cerrar">×</button>
        </div>
      ))}
    </div>
  );
}

function useToasts() {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);
  const show = useCallback((message, type = 'success', duration = 4000) => {
    const id = ++idRef.current;
    setToasts(prev => [...prev.slice(-4), { id, message, type }]);
    if (duration > 0) setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration);
    return id;
  }, []);
  const dismiss = useCallback(id => setToasts(prev => prev.filter(t => t.id !== id)), []);
  return { toasts, show, dismiss };
}

/* ─── SVG Brand Logos ─── */
function TodoTechoLogo() {
  return (
    <div className="quote-brand-todotecho">
      <svg viewBox="0 0 180 58" className="quote-todotecho-svg" aria-hidden="true">
        <polyline points="12,34 62,10 105,28" fill="none" stroke="#9ca3af" strokeWidth="2.2" />
        <polyline points="62,10 112,28 112,42" fill="none" stroke="#b91c1c" strokeWidth="2.2" />
        <polyline points="105,28 134,12 162,28 162,42" fill="none" stroke="#b91c1c" strokeWidth="2.2" />
        <rect x="86" y="25" width="14" height="15" fill="none" stroke="#374151" strokeWidth="1.6" />
      </svg>
      <div className="quote-todotecho-text">TODO TECHO</div>
    </div>
  );
}

function LekerLogo() {
  return (
    <div className="quote-brand-leker">
      <div className="quote-leker-rep">Representante Exclusivo</div>
      <div className="quote-leker-main">
        <svg viewBox="0 0 46 38" className="quote-leker-dots" aria-hidden="true">
          <circle cx="10" cy="18" r="2.2" fill="#facc15" />
          <circle cx="17" cy="14" r="2.5" fill="#eab308" />
          <circle cx="24" cy="11" r="2.6" fill="#38bdf8" />
          <circle cx="31" cy="8" r="2.2" fill="#1d4ed8" />
          <circle cx="14" cy="24" r="2.4" fill="#eab308" />
          <circle cx="22" cy="21" r="2.8" fill="#0284c7" />
          <circle cx="30" cy="17" r="2.6" fill="#1e3a8a" />
          <circle cx="20" cy="30" r="2.5" fill="#0284c7" />
          <circle cx="28" cy="26" r="2.7" fill="#1e3a8a" />
          <circle cx="36" cy="22" r="2.4" fill="#1e3a8a" />
          <circle cx="27" cy="33" r="2.2" fill="#1e3a8a" />
          <circle cx="35" cy="30" r="2.3" fill="#1e3a8a" />
        </svg>
        <div className="quote-leker-wordmark">
          <span className="quote-leker-title">LEKER</span>
          <span className="quote-leker-sub">POLICARBONATO</span>
        </div>
      </div>
      <div className="quote-leker-tagline">Especialistas en Policarbonato</div>
    </div>
  );
}

export default function CotizadorPage() {
  const { currentUser } = useAuth();
  const lookup = useRef(null);
  const { toasts, show: showToast, dismiss: dismissToast } = useToasts();
  const autoSaveTimer = useRef(null);
  const isDirty = useRef(false);

  const [siiData, setSiiData] = useState(null);
  const [siiLoading, setSiiLoading] = useState(false);
  const [siiError, setSiiError] = useState('');

  // Document header & metadata
  const [quoteNumber, setQuoteNumber] = useState('10262');
  const [quoteDate, setQuoteDate] = useState(todayFormatted);
  const [sellerName, setSellerName] = useState('Marcial Silva V');
  const [companyRut, setCompanyRut] = useState('76.324.634-5');
  const [validityDays, setValidityDays] = useState('03');

  // Client details
  const [rut, setRut] = useState('');
  const [customer, setCustomer] = useState('');
  const [activities, setActivities] = useState('');
  const [city, setCity] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');

  // Footer contact details
  const [contactPhone, setContactPhone] = useState(':+56934006305');
  const [contactAddress, setContactAddress] = useState('Pasaje 2  N°404  Parque Industrial - Puerto Montt');
  const [contactEmail, setContactEmail] = useState('msilva@leker.cl');
  const [contactWeb, setContactWeb] = useState('https://www.lekerchile.cl');

  // Inventory & quotation items
  const [products, setProducts] = useState([]);
  const [productSearch, setProductSearch] = useState('');
  const [inventoryError, setInventoryError] = useState('');
  const [items, setItems] = useState(() => [createEmptyItem()]);
  const [error, setError] = useState('');
  const [quoteSearch, setQuoteSearch] = useState('');
  const [savedQuotes, setSavedQuotes] = useState([]);
  const [buying, setBuying] = useState(false);
  const [globalDiscount, setGlobalDiscount] = useState('42');
  const [showClientSuggestions, setShowClientSuggestions] = useState(false);

  const validRut = normalizeRut(rut);
  useEffect(() => () => lookup.current?.abort(), []);

  const changeRut = value => {
    lookup.current?.abort();
    lookup.current = null;
    setSiiLoading(false);
    setSiiError('');
    setSiiData(null);
    setRut(value);
    isDirty.current = true;
  };

  const lookupRut = async () => {
    if (!validRut || !currentUser || siiLoading) return;
    lookup.current?.abort();
    const controller = new AbortController();
    lookup.current = controller;
    setSiiLoading(true);
    setSiiError('');
    setSiiData(null);
    setCustomer('');
    setActivities('');
    try {
      const token = await currentUser.getIdToken();
      if (controller.signal.aborted) return;
      const response = await fetch('/api/sii', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ rut: validRut }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo consultar el SII.');
      if (lookup.current !== controller) return;
      setCustomer(data.name);
      setActivities(data.activities.map(activity => activity.description).join(' / '));
      setSiiData(data);
      showToast('Datos del SII cargados correctamente.', 'success');
    } catch (failure) {
      if (!controller.signal.aborted && lookup.current === controller) {
        setSiiError(failure.message || 'No se pudo consultar el SII.');
        showToast(failure.message || 'Error al consultar el SII.', 'error');
      }
    } finally {
      if (lookup.current === controller) {
        setSiiLoading(false);
        lookup.current = null;
      }
    }
  };

  useEffect(() => onSnapshot(query(collection(db, 'products'), orderBy('sku', 'asc')), snapshot => {
    const loaded = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
    loaded.sort((a, b) => (a.sku || '').localeCompare(b.sku || '', 'es', { numeric: true }) || (a.name || '').localeCompare(b.name || '', 'es'));
    setProducts(loaded);
    setInventoryError('');
  }, () => setInventoryError('No se pudo cargar el inventario. Puedes agregar productos manualmente.')), []);

  const catalogProducts = (() => {
    const seen = new Set(products.map(p => String(p.sku || '').trim().toUpperCase()).filter(Boolean));
    const extras = Object.entries(PRODUCT_PRICE_LIST)
      .filter(([sku]) => !seen.has(sku.toUpperCase()))
      .map(([sku, entry]) => ({ id: `price-${sku}`, sku, name: entry.name }));
    return [...products, ...extras];
  })();

  const searchTerm = productSearch.trim().toLowerCase();
  const filteredProducts = searchTerm
    ? catalogProducts.filter(product => {
      const sku = (product.sku || '').toLowerCase();
      const name = (product.name || '').toLowerCase();
      return searchTerm.split(/\s+/).every(kw => sku.includes(kw) || name.includes(kw));
    })
    : catalogProducts;

  const addItem = (product = null) => {
    setItems(previous => {
      const newItem = createEmptyItem(product);
      if (product && previous.length === 1 && isRowBlank(previous[0])) {
        return [newItem];
      }
      return [...previous, newItem];
    });
    setProductSearch('');
    isDirty.current = true;
  };

  const updateItem = (id, field, value) => {
    setItems(previous => previous.map(item => {
      if (item.id !== id) return item;
      const updated = { ...item, [field]: value };
      if (field === 'sku' || field === 'name') {
        const priceEntry = lookupProductPrice(
          field === 'sku' ? value : updated.sku,
          field === 'name' ? value : updated.name
        );
        if (priceEntry) {
          if (field === 'sku') updated.name = priceEntry.name;
          updated.price = String(priceEntry.listPrice);
          if (String(updated.quantity ?? '').trim() === '' || updated.quantity === '0') updated.quantity = '1';
        }
      }
      return updated;
    }));
    isDirty.current = true;
  };

  const removeItem = id => {
    setItems(previous => (previous.length > 1 ? previous.filter(row => row.id !== id) : [createEmptyItem()]));
    isDirty.current = true;
  };

  const moveItem = (index, direction) => {
    setItems(prev => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const clearQuotedItems = () => {
    setItems([createEmptyItem()]);
    setProductSearch('');
    setError('');
    showToast('Productos cotizados borrados.', 'info');
  };

  const clearDraft = () => {
    setRut('');
    setCustomer('');
    setActivities('');
    setCity('');
    setPhone('');
    setEmail('');
    setNotes('');
    setSiiData(null);
    setSiiError('');
    setError('');
    setItems([createEmptyItem()]);
    isDirty.current = false;
    showToast('Cotización limpiada.', 'info');
  };

  const activeItems = items.filter(item => !isRowBlank(item));
  let totals = { net: 0, tax: 0, total: 0 };
  if (activeItems.length > 0) {
    try {
      totals = quotationTotals(activeItems);
    } catch {
      totals = activeItems.reduce(
        (acc, item) => {
          try {
            const line = quotationLineTotals(item);
            acc.net += line.net;
          } catch {
            // Incomplete row while typing
          }
          return acc;
        },
        { net: 0, tax: 0, total: 0 }
      );
      totals.tax = Math.round(totals.net * 0.19);
      totals.total = totals.net + totals.tax;
    }
  }

  useEffect(() => {
    const syncNextNumber = list => {
      if (!list.length) return;
      const highest = list[0]?.quoteNumber;
      if (highest) setQuoteNumber(prev => (prev === '10262' ? incrementQuoteNumber(highest) : prev));
    };
    const localMap = readLocalQuotes();
    const localList = Object.values(localMap).sort((a, b) =>
      String(b.quoteNumber || '').localeCompare(String(a.quoteNumber || ''), 'es', { numeric: true })
    );
    setSavedQuotes(localList);
    syncNextNumber(localList);

    if (!currentUser) return;
    getDocs(collection(db, 'quotations'))
      .then(snapshot => {
        if (snapshot.empty) return;
        const merged = { ...localMap };
        snapshot.docs.forEach(d => {
          const data = d.data();
          if (data?.quoteNumber) merged[data.quoteNumber] = data;
        });
        const mergedList = Object.values(merged).sort((a, b) =>
          String(b.quoteNumber || '').localeCompare(String(a.quoteNumber || ''), 'es', { numeric: true })
        );
        setSavedQuotes(mergedList);
        syncNextNumber(mergedList);
      })
      .catch(() => {
        // Firestore quotations rules may not be deployed yet; localStorage remains active.
      });
  }, [currentUser]);

  const buildQuotePayload = () => {
    const num = String(quoteNumber ?? '').trim();
    if (!num) throw new Error('Ingresa un N° de cotización para guardar.');
    return {
      quoteNumber: num,
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
      updatedAtIso: new Date().toISOString(),
    };
  };

  const applyLoadedQuote = data => {
    setQuoteNumber(data.quoteNumber || '');
    setQuoteDate(data.quoteDate || todayFormatted());
    setSellerName(data.sellerName || 'Marcial Silva V');
    setCompanyRut(data.companyRut || '76.324.634-5');
    setValidityDays(data.validityDays || '03');
    setRut(data.rut || '');
    setCustomer(data.customer || '');
    setActivities(data.activities || '');
    setCity(data.city || '');
    setPhone(data.phone || '');
    setEmail(data.email || '');
    setNotes(data.notes || '');
    setContactPhone(data.contactPhone || ':+56934006305');
    setContactAddress(data.contactAddress || 'Pasaje 2  N°404  Parque Industrial - Puerto Montt');
    setContactEmail(data.contactEmail || 'msilva@leker.cl');
    setContactWeb(data.contactWeb || 'https://www.lekerchile.cl');
    setItems(Array.isArray(data.items) && data.items.length ? data.items : [createEmptyItem()]);
    setSiiData(null);
    setSiiError('');
    setError('');
    isDirty.current = false;
    showToast(`Cotización N° ${data.quoteNumber} cargada.`, 'success');
  };

  const saveQuote = useCallback(async ({ silent = false } = {}) => {
    setError('');
    try {
      const payload = buildQuotePayload();
      writeLocalQuote(payload);
      setSavedQuotes(prev => {
        const filtered = prev.filter(q => q.quoteNumber !== payload.quoteNumber);
        return [payload, ...filtered].sort((a, b) =>
          String(b.quoteNumber || '').localeCompare(String(a.quoteNumber || ''), 'es', { numeric: true })
        );
      });
      if (currentUser) {
        try {
          await setDoc(doc(db, 'quotations', payload.quoteNumber), {
            ...payload,
            updatedBy: currentUser.uid,
            updatedAt: serverTimestamp(),
          });
        } catch {
          // Local copy is already saved if Firestore rules aren't deployed yet.
        }
      }
      isDirty.current = false;
      if (!silent) showToast(`Cotización N° ${payload.quoteNumber} guardada.`, 'success');
    } catch (failure) {
      if (!silent) {
        setError(failure.message);
        showToast(failure.message, 'error');
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteNumber, quoteDate, sellerName, companyRut, validityDays, rut, customer, activities, city, phone, email, notes, contactPhone, contactAddress, contactEmail, contactWeb, items, currentUser]);

  /* Auto-save every 30s when dirty */
  useEffect(() => {
    autoSaveTimer.current = setInterval(() => {
      if (isDirty.current && String(quoteNumber ?? '').trim()) {
        saveQuote({ silent: true });
      }
    }, 30000);
    return () => clearInterval(autoSaveTimer.current);
  }, [saveQuote, quoteNumber]);

  const loadQuoteByNumber = async targetNumber => {
    const key = String(targetNumber ?? quoteSearch).trim();
    if (!key) return;
    setError('');

    const localMap = readLocalQuotes();
    if (localMap[key]) {
      applyLoadedQuote(localMap[key]);
      setQuoteSearch('');
      return;
    }

    if (currentUser) {
      try {
        const snap = await getDoc(doc(db, 'quotations', key));
        if (snap.exists()) {
          const data = snap.data();
          writeLocalQuote(data);
          applyLoadedQuote(data);
          setQuoteSearch('');
          return;
        }
      } catch {
        // Fallback already checked localStorage
      }
    }

    showToast(`No se encontró cotización N° ${key}.`, 'error');
  };

  const isCurrentQuoteSaved = savedQuotes.some(q => q.quoteNumber === String(quoteNumber ?? '').trim());

  const deleteSavedQuote = async targetNumber => {
    const key = String(targetNumber ?? quoteNumber).trim();
    if (!key) return;
    if (typeof window !== 'undefined' && !window.confirm(`¿Borrar la cotización guardada N° ${key}?`)) return;
    setError('');
    deleteLocalQuote(key);
    setSavedQuotes(prev => prev.filter(q => q.quoteNumber !== key));
    if (currentUser) {
      try {
        await deleteDoc(doc(db, 'quotations', key));
      } catch {
        // Local copy already removed if Firestore rules aren't deployed yet.
      }
    }
    showToast(`Cotización N° ${key} eliminada.`, 'info');
  };

  const duplicateQuote = () => {
    const nextNum = incrementQuoteNumber(String(quoteNumber ?? '').trim() || '10262');
    setQuoteNumber(nextNum);
    setQuoteDate(todayFormatted());
    isDirty.current = true;
    showToast(`Cotización duplicada → N° ${nextNum}. Guardala cuando estés listo.`, 'success');
  };

  const confirmPurchase = async () => {
    if (buying) return;
    setError('');
    try {
      if (!currentUser) throw new Error('Debes iniciar sesión para descontar del inventario.');
      if (!activeItems.length) throw new Error('Agrega al menos un producto para comprar.');
      const { changes, unmatchedSkus } = buildPurchaseChanges(items, products);
      if (!changes.length) {
        throw new Error('Ninguno de los productos cotizados coincide con un código (SKU) del inventario.');
      }
      const skipNote = unmatchedSkus.length
        ? `\n(Se omitirán por no estar en inventario: ${unmatchedSkus.join(', ')})`
        : '';
      const confirmed = window.confirm(
        `¿Confirmar compra de la cotización N° ${quoteNumber} y descontar ${changes.length} producto(s) del inventario?${skipNote}`
      );
      if (!confirmed) return;

      setBuying(true);
      await commitInventoryChanges(changes, currentUser, {
        action: 'cantidad_descontada',
        customer: customer.trim(),
        description: `Compra desde cotización N° ${quoteNumber}${customer.trim() ? ` (${customer.trim()})` : ''}`,
      });
      await saveQuote({ silent: true });
      showToast(
        `✅ Compra aplicada: ${changes.length} producto(s) descontados del inventario.`,
        'success',
        6000
      );
    } catch (failure) {
      const msg = failure?.code === 'permission-denied'
        ? 'No tienes permisos para descontar del inventario.'
        : failure?.message || 'No se pudo descontar del inventario.';
      setError(msg);
      showToast(msg, 'error', 6000);
    } finally {
      setBuying(false);
    }
  };

  const applyDiscountAll = pctValue => {
    const clean = Math.min(100, Math.max(0, Number(String(pctValue).replace(',', '.')) || 0));
    setGlobalDiscount(String(clean));
    setItems(prev => prev.map(item => (isRowBlank(item) ? item : { ...item, discount: String(clean) })));
    isDirty.current = true;
  };

  const copyWhatsApp = async () => {
    setError('');
    try {
      const text = buildWhatsAppQuoteText({
        quoteNumber,
        quoteDate,
        customer,
        validityDays,
        items,
        totals,
      });
      await navigator.clipboard.writeText(text);
      showToast('Resumen copiado para WhatsApp.', 'success');
    } catch {
      showToast('No se pudo copiar al portapapeles.', 'error');
    }
  };

  const handleExportExcel = () => {
    setError('');
    try {
      if (!activeItems.length) throw new Error('Agrega al menos un producto para exportar.');
      exportQuotationToExcel({
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
      });
      showToast(`Excel N° ${quoteNumber} descargado.`, 'success');
    } catch (failure) {
      showToast(failure.message || 'No se pudo exportar a Excel.', 'error');
    }
  };

  const printQuote = () => {
    setError('');
    if (!validRut || !customer.trim()) {
      showToast('Ingresa un RUT válido y razón social antes de imprimir.', 'error');
      return;
    }
    try {
      if (!activeItems.length) throw new Error('Agrega al menos un producto para cotizar.');
      if (activeItems.some(item => String(item.price ?? '').trim() === '')) {
        throw new Error('Ingresa el valor neto de cada producto.');
      }
      quotationTotals(activeItems);
      const printedNumber = String(quoteNumber ?? '').trim();
      saveQuote({ silent: true });

      const advanceNumber = () => {
        const nextNumber = incrementQuoteNumber(printedNumber);
        setQuoteNumber(nextNumber);
        showToast(`N° ${printedNumber} guardada. Siguiente: ${nextNumber}.`, 'success');
      };

      let handled = false;
      const onAfterPrint = () => {
        if (handled) return;
        handled = true;
        window.removeEventListener('afterprint', onAfterPrint);
        advanceNumber();
      };
      window.addEventListener('afterprint', onAfterPrint);
      window.print();
      setTimeout(() => {
        if (!handled) onAfterPrint();
      }, 300);
    } catch (failure) {
      showToast(failure.message, 'error');
    }
  };

  /* Keyboard shortcuts */
  useEffect(() => {
    const handler = e => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === 's') { e.preventDefault(); saveQuote(); }
      else if (ctrl && e.key === 'p') { e.preventDefault(); printQuote(); }
      else if (ctrl && e.key === 'n') { e.preventDefault(); clearDraft(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveQuote]);

  /* Client autocomplete from past quotations */
  const clientSuggestions = (() => {
    const rutVal = String(rut ?? '').trim().toLowerCase();
    if (!rutVal || rutVal.length < 3) return [];
    return savedQuotes
      .filter(q => q.rut && String(q.rut).toLowerCase().includes(rutVal) && q.customer)
      .slice(0, 5);
  })();

  return (
    <div className="quotation-page">
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* ───── TOOLBAR ───── */}
      <div className="quote-unified-shell">
        <div className="quote-unified-bar quotation-controls">
          {/* Row 1: Title + Quote search + Saved dropdown + Action buttons */}
          <div className="quote-toolbar-row">
            <div className="quote-toolbar-left">
              <h1 className="quote-page-title">Cotizador</h1>
              <div className="quote-lookup-group">
                <input
                  type="text"
                  className="form-input quote-lookup-input"
                  aria-label="Buscar cotización por número"
                  placeholder="N° cotización…"
                  value={quoteSearch}
                  onChange={e => setQuoteSearch(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); loadQuoteByNumber(); } }}
                />
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => loadQuoteByNumber()}>
                  <i className="bi bi-search" /> Buscar
                </button>
                {savedQuotes.length > 0 && (
                  <select
                    className="form-input quote-saved-select"
                    aria-label="Cotizaciones guardadas"
                    value=""
                    onChange={e => { if (e.target.value) loadQuoteByNumber(e.target.value); }}
                  >
                    <option value="">Guardadas ({savedQuotes.length})…</option>
                    {savedQuotes.map(q => (
                      <option key={q.quoteNumber} value={q.quoteNumber}>
                        N° {q.quoteNumber} — {q.customer || q.rut || q.quoteDate}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
            <div className="quote-toolbar-right">
              <div className="quote-btn-group">
                <button type="button" className="btn btn-ghost" onClick={() => saveQuote()} title="Ctrl+S">
                  <i className="bi bi-floppy" /> Guardar
                </button>
                {isCurrentQuoteSaved && (
                  <button type="button" className="btn btn-ghost btn-danger-ghost" onClick={() => deleteSavedQuote()}>
                    <i className="bi bi-trash3" /> Borrar
                  </button>
                )}
                <button type="button" className="btn btn-ghost" onClick={duplicateQuote} title="Duplicar cotización">
                  <i className="bi bi-copy" /> Duplicar
                </button>
                <button type="button" className="btn btn-ghost" onClick={clearDraft} title="Ctrl+N">
                  <i className="bi bi-eraser" /> Limpiar
                </button>
              </div>
              <div className="quote-btn-divider" />
              <div className="quote-btn-group">
                <button type="button" className="btn btn-ghost" onClick={copyWhatsApp} disabled={!activeItems.length}>
                  <i className="bi bi-whatsapp" /> WhatsApp
                </button>
                <button type="button" className="btn btn-ghost" onClick={handleExportExcel} disabled={!activeItems.length}>
                  <i className="bi bi-file-earmark-spreadsheet" /> Excel
                </button>
              </div>
              <div className="quote-btn-divider" />
              <div className="quote-btn-group">
                <button type="button" className="btn btn-accent" onClick={confirmPurchase} disabled={buying || !activeItems.length}>
                  <i className="bi bi-cart-check" /> {buying ? 'Descontando…' : 'Comprar'}
                </button>
                <button type="button" className="btn btn-primary" onClick={printQuote} title="Ctrl+P">
                  <i className="bi bi-printer" /> Imprimir
                </button>
              </div>
            </div>
          </div>

          {/* Row 2: SII + Product search + Add row */}
          <div className="quote-toolbar-row quote-toolbar-secondary">
            <div className="quotation-sii-bar">
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={!validRut || !currentUser || siiLoading}
                onClick={lookupRut}
              >
                {siiLoading ? 'Consultando…' : 'Consultar SII'}
              </button>
              {validRut ? (
                <a className="btn btn-sm btn-secondary" href="https://www2.sii.cl/stc/noauthz" target="_blank" rel="noopener noreferrer">
                  SII ↗
                </a>
              ) : (
                <button type="button" className="btn btn-sm btn-secondary" disabled>SII ↗</button>
              )}
              <span className="quotation-sector-badge" aria-live="polite">
                <strong>{classifyActivities(siiData?.activities || activities)}</strong>
              </span>
            </div>

            <div className="quotation-actions">
              <div className="quotation-search-wrap">
                <input
                  type="text"
                  className="form-input"
                  aria-label="Buscar producto por código o nombre"
                  placeholder="Buscar producto (SKU o nombre)…"
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
                    {filteredProducts.length ? filteredProducts.slice(0, 12).map(product => {
                      const priceEntry = lookupProductPrice(product.sku, product.name);
                      const hasStock = typeof product.quantity === 'number';
                      return (
                        <button
                          key={product.id}
                          type="button"
                          className="quotation-search-option"
                          onClick={() => addItem(product)}
                        >
                          <div className="quotation-search-main">
                            <strong>{product.sku || 'SIN CÓDIGO'}</strong>
                            <small>{product.name}</small>
                          </div>
                          <div className="quotation-search-meta">
                            {hasStock && (
                              <span className={`quotation-stock-pill ${product.quantity <= 0 ? 'empty' : ''}`}>
                                {product.quantity}
                              </span>
                            )}
                            {priceEntry && (
                              <span className="quotation-price-pill">{formatCompactCurrency(priceEntry.listPrice)}</span>
                            )}
                          </div>
                        </button>
                      );
                    }) : (
                      <div className="quotation-search-option quotation-search-empty">
                        Sin coincidencias para &quot;{productSearch}&quot;
                      </div>
                    )}
                  </div>
                )}
              </div>

              <select
                className="form-input quote-select-sku"
                aria-label="Agregar producto del inventario por código"
                value=""
                onChange={event => {
                  const product = catalogProducts.find(item => item.id === event.target.value);
                  if (product) addItem(product);
                }}
              >
                <option value="">Código (SKU)…</option>
                {catalogProducts.map(product => (
                  <option key={product.id} value={product.id}>
                    {product.sku} — {product.name}
                  </option>
                ))}
              </select>

              <button type="button" className="btn btn-sm btn-secondary" onClick={() => addItem()}>
                <i className="bi bi-plus-lg" /> Fila
              </button>
            </div>
          </div>

          {/* Row 3: Global discount + live totals */}
          <div className="quote-toolbar-row quote-toolbar-footer">
            <div className="quote-discount-strip">
              <span className="quote-discount-label">Dcto:</span>
              {['0', '40', '42', '45'].map(pct => (
                <button
                  key={pct}
                  type="button"
                  className={`quote-discount-chip ${globalDiscount === pct ? 'active' : ''}`}
                  onClick={() => applyDiscountAll(pct)}
                >
                  {pct}%
                </button>
              ))}
              <input
                type="number"
                className="form-input quote-discount-custom"
                aria-label="Descuento global personalizado"
                min="0"
                max="100"
                value={globalDiscount}
                onChange={e => setGlobalDiscount(e.target.value)}
              />
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => applyDiscountAll(globalDiscount)}>
                Aplicar
              </button>
            </div>
            <div className="quote-live-totals">
              <span className="quote-live-pill">
                <span className="quote-live-label">Ítems</span>
                <strong>{activeItems.length}</strong>
              </span>
              <span className="quote-live-pill">
                <span className="quote-live-label">Neto</span>
                <strong>{formatCompactCurrency(totals.net)}</strong>
              </span>
              <span className="quote-live-pill">
                <span className="quote-live-label">IVA</span>
                <strong>{formatCompactCurrency(totals.tax)}</strong>
              </span>
              <span className="quote-live-pill quote-live-total">
                <span className="quote-live-label">Total</span>
                <strong>{formatCompactCurrency(totals.total)}</strong>
              </span>
            </div>
          </div>

          {inventoryError && <p className="quotation-status-msg" role="status">{inventoryError}</p>}
          {error && <p className="quotation-error-msg" role="alert">{error}</p>}
          {siiData && (
            <details className="quotation-sii-details">
              <summary>
                Datos SII · {siiData.consultedAt || 'ahora'} · Actividades ({siiData.activities.length})
              </summary>
              {siiData.activities.length ? (
                <ul>
                  {siiData.activities.map((activity, index) => (
                    <li key={`${activity.code}-${index}`}>
                      <strong>{activity.code}</strong> — {activity.description}
                      {activity.startDate && ` · Desde ${activity.startDate}`}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>El SII no informa actividades económicas vigentes.</p>
              )}
            </details>
          )}
        </div>

        {/* ───── OFFICIAL QUOTATION SHEET ───── */}
        <div className="quote-sheet-wrapper">
          <div className="quote-sheet">
            {/* TOP HEADER */}
            <div className="quote-header">
              <div className="quote-header-left">
                <TodoTechoLogo />
                <div className="quote-company-rut">
                  <span>RUT:</span>
                  <input
                    type="text"
                    aria-label="RUT empresa"
                    value={companyRut}
                    onChange={e => setCompanyRut(e.target.value)}
                  />
                </div>
              </div>

              <div className="quote-header-center">
                <LekerLogo />
              </div>

              <div className="quote-header-right">
                <div className="quote-number-box">
                  <span>N°</span>
                  <input
                    type="text"
                    aria-label="Número de presupuesto"
                    value={quoteNumber}
                    onChange={e => setQuoteNumber(e.target.value)}
                  />
                </div>
                <div className="quote-date-box">
                  <input
                    type="text"
                    aria-label="Fecha del presupuesto"
                    value={quoteDate}
                    onChange={e => setQuoteDate(e.target.value)}
                  />
                </div>
                <div className="quote-seller-box">
                  <input
                    type="text"
                    aria-label="Nombre del vendedor"
                    value={sellerName}
                    onChange={e => setSellerName(e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* CLIENT & OBSERVATIONS */}
            <div className="quote-meta-grid">
              <div className="quote-client-box">
                <div className="quote-client-row">
                  <label htmlFor="quote-rut">RUT:</label>
                  <div className="quote-client-input-wrap">
                    <input
                      id="quote-rut"
                      type="text"
                      value={rut}
                      maxLength={12}
                      placeholder="76.123.456-0"
                      onChange={e => { changeRut(e.target.value); setShowClientSuggestions(true); }}
                      onBlur={() => { if (validRut) setRut(validRut); setTimeout(() => setShowClientSuggestions(false), 200); }}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); lookupRut(); } }}
                    />
                    {showClientSuggestions && clientSuggestions.length > 0 && (
                      <div className="quote-client-suggestions">
                        {clientSuggestions.map(q => (
                          <button
                            key={q.quoteNumber}
                            type="button"
                            className="quote-client-suggestion-item"
                            onMouseDown={e => {
                              e.preventDefault();
                              setRut(q.rut || '');
                              setCustomer(q.customer || '');
                              setActivities(q.activities || '');
                              setCity(q.city || '');
                              setPhone(q.phone || '');
                              setEmail(q.email || '');
                              setShowClientSuggestions(false);
                              showToast(`Cliente "${q.customer}" cargado.`, 'info');
                            }}
                          >
                            <strong>{q.rut}</strong> — {q.customer}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="quote-client-row">
                  <label htmlFor="quote-cliente">CLIENTE:</label>
                  <input
                    id="quote-cliente"
                    type="text"
                    value={customer}
                    maxLength={200}
                    disabled={siiLoading}
                    onChange={e => { setCustomer(e.target.value); setSiiData(null); isDirty.current = true; }}
                  />
                </div>
                <div className="quote-client-row">
                  <label htmlFor="quote-giro">GIRO:</label>
                  <input
                    id="quote-giro"
                    type="text"
                    value={activities}
                    maxLength={500}
                    disabled={siiLoading}
                    onChange={e => { setActivities(e.target.value); setSiiData(null); isDirty.current = true; }}
                  />
                </div>
                <div className="quote-client-row">
                  <label htmlFor="quote-ciudad">CIUDAD:</label>
                  <input
                    id="quote-ciudad"
                    type="text"
                    value={city}
                    maxLength={100}
                    onChange={e => { setCity(e.target.value); isDirty.current = true; }}
                  />
                </div>
                <div className="quote-client-row">
                  <label htmlFor="quote-fono">FONO:</label>
                  <input
                    id="quote-fono"
                    type="text"
                    value={phone}
                    maxLength={50}
                    onChange={e => { setPhone(e.target.value); isDirty.current = true; }}
                  />
                </div>
                <div className="quote-client-row">
                  <label htmlFor="quote-email">E-MAIL:</label>
                  <input
                    id="quote-email"
                    type="email"
                    value={email}
                    maxLength={120}
                    onChange={e => { setEmail(e.target.value); isDirty.current = true; }}
                  />
                </div>
              </div>

              <div className="quote-obs-box">
                <div className="quote-obs-header">OBSERVACIONES:</div>
                <textarea
                  aria-label="Observaciones"
                  className="quote-obs-textarea"
                  value={notes}
                  maxLength={2000}
                  onChange={e => { setNotes(e.target.value); isDirty.current = true; }}
                />
                <div className="quote-validity-bar">
                  <span>Presupuesto valido por</span>
                  <input
                    type="text"
                    aria-label="Días de validez"
                    className="quote-validity-input"
                    value={validityDays}
                    maxLength={4}
                    onChange={e => setValidityDays(e.target.value)}
                  />
                  <span>dias</span>
                </div>
              </div>
            </div>

            {/* ITEMS TABLE */}
            <div className="quote-table-wrap">
              <table className="quote-table">
                <thead>
                  <tr>
                    <th className="col-num quotation-controls">#</th>
                    <th className="col-codigo">CODIGO</th>
                    <th className="col-valor">VALOR</th>
                    <th className="col-cant">CANT</th>
                    <th className="col-desc">DESCRIPCIÓN</th>
                    <th className="col-total">$ TOTAL</th>
                    <th className="col-pct">% DCTO.</th>
                    <th className="col-dcto">$ DCTO.</th>
                    <th className="col-neto">NETO</th>
                    <th className="col-action quotation-controls" aria-label="Acción" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, index) => {
                    let line = { gross: 0, discountPct: 0, discountAmount: 0, net: 0 };
                    if (!isRowBlank(item)) {
                      try {
                        line = quotationLineTotals(item);
                      } catch {
                        const q = Number(String(item.quantity ?? '').replace(',', '.')) || 0;
                        const p = Number(item.price) || 0;
                        const d = Number(String(item.discount ?? '').replace(',', '.')) || 0;
                        line.gross = Math.round(q * p);
                        line.discountAmount = Math.round(line.gross * (Math.min(100, Math.max(0, d)) / 100));
                        line.net = line.gross - line.discountAmount;
                      }
                    }
                    const hasData = !isRowBlank(item);
                    const invMatch = item.sku
                      ? products.find(p => String(p.sku || '').trim().toUpperCase() === String(item.sku).trim().toUpperCase())
                      : null;
                    const requestedQty = Number(String(item.quantity ?? '').replace(',', '.')) || 0;
                    const overStock = invMatch && requestedQty > Number(invMatch.quantity ?? 0);

                    return (
                      <tr key={item.id} className={index % 2 === 0 && hasData ? 'quote-row-highlight' : ''}>
                        <td className="col-num quotation-controls">
                          <div className="quote-row-num-wrap">
                            <span className="quote-row-num">{index + 1}</span>
                            <div className="quote-row-arrows">
                              <button type="button" className="quote-arrow-btn" disabled={index === 0} onClick={() => moveItem(index, -1)} aria-label="Subir">▲</button>
                              <button type="button" className="quote-arrow-btn" disabled={index === items.length - 1} onClick={() => moveItem(index, 1)} aria-label="Bajar">▼</button>
                            </div>
                          </div>
                        </td>
                        <td className="col-codigo">
                          <input
                            type="text"
                            aria-label={`Código ${index + 1}`}
                            value={item.sku}
                            placeholder="SKU"
                            maxLength={100}
                            onChange={e => updateItem(item.id, 'sku', e.target.value)}
                          />
                        </td>
                        <td className="col-valor">
                          <input
                            type="number"
                            aria-label={`Valor unitario ${index + 1}`}
                            min="0"
                            step="1"
                            placeholder="0"
                            value={item.price}
                            onChange={e => updateItem(item.id, 'price', e.target.value)}
                          />
                          {Number(item.price) > 0 && (
                            <span className="quote-price-formatted quotation-controls">{formatCompactCurrency(item.price)}</span>
                          )}
                        </td>
                        <td className="col-cant">
                          <input
                            type="number"
                            aria-label={`Cantidad ${index + 1}`}
                            min="0"
                            step="0.01"
                            value={item.quantity}
                            onChange={e => updateItem(item.id, 'quantity', e.target.value)}
                          />
                          {overStock && (
                            <span className="quote-stock-warn quotation-controls" title={`Stock disponible: ${invMatch.quantity}`}>
                              ⚠ {invMatch.quantity}
                            </span>
                          )}
                        </td>
                        <td className="col-desc">
                          <input
                            type="text"
                            aria-label={`Descripción ${index + 1}`}
                            value={item.name}
                            placeholder="Descripción del producto"
                            maxLength={200}
                            onChange={e => updateItem(item.id, 'name', e.target.value)}
                          />
                        </td>
                        <td className="col-total">{formatCurrency(line.gross)}</td>
                        <td className="col-pct">
                          <div className="quote-pct-wrap">
                            <input
                              type="number"
                              aria-label={`Porcentaje descuento ${index + 1}`}
                              min="0"
                              max="100"
                              step="1"
                              value={item.discount}
                              onChange={e => updateItem(item.id, 'discount', e.target.value)}
                            />
                            <span>%</span>
                          </div>
                        </td>
                        <td className="col-dcto">{formatCurrency(line.discountAmount)}</td>
                        <td className="col-neto">{formatCurrency(line.net)}</td>
                        <td className="col-action quotation-controls">
                          <button
                            type="button"
                            className="quote-row-remove"
                            title="Quitar fila"
                            aria-label={`Quitar fila ${index + 1}`}
                            onClick={() => removeItem(item.id)}
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* FOOTER: CONTACT & TOTALS */}
            <div className="quote-footer">
              <div className="quote-contact-box">
                <div className="quote-contact-phone">
                  <i className="bi bi-whatsapp quote-icon-whatsapp" aria-hidden="true" />
                  <input
                    type="text"
                    aria-label="Teléfono de contacto"
                    value={contactPhone}
                    onChange={e => setContactPhone(e.target.value)}
                  />
                </div>
                <div className="quote-contact-address">
                  <i className="bi bi-geo-alt-fill quote-icon-pin" aria-hidden="true" />
                  <input
                    type="text"
                    aria-label="Dirección de la empresa"
                    value={contactAddress}
                    onChange={e => setContactAddress(e.target.value)}
                  />
                </div>
                <div className="quote-contact-links">
                  <span className="quote-contact-link-item">
                    <i className="bi bi-envelope-fill quote-icon-mail" aria-hidden="true" />
                    <input
                      type="text"
                      aria-label="Correo de contacto"
                      value={contactEmail}
                      onChange={e => setContactEmail(e.target.value)}
                    />
                  </span>
                  <span className="quote-contact-link-item">
                    <i className="bi bi-globe quote-icon-web" aria-hidden="true" />
                    <input
                      type="text"
                      aria-label="Sitio web"
                      value={contactWeb}
                      onChange={e => setContactWeb(e.target.value)}
                    />
                  </span>
                </div>
              </div>

              <div className="quote-totals-box" aria-live="polite">
                <div className="quote-total-row">
                  <span className="quote-total-label">NETO</span>
                  <span className="quote-total-value">{formatCompactCurrency(totals.net)}</span>
                </div>
                <div className="quote-total-row">
                  <span className="quote-total-label">IVA</span>
                  <span className="quote-total-value">{formatCompactCurrency(totals.tax)}</span>
                </div>
                <div className="quote-total-row quote-total-final">
                  <span className="quote-total-label">TOTAL</span>
                  <span className="quote-total-value">{formatCompactCurrency(totals.total)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
