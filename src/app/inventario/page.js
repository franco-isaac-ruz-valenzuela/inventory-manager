'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { db } from '../../lib/firebase';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';
import { logAction } from '../../lib/auditLog';
import { sendNotification } from '../../lib/notifications';
import {
  exportInventoryToExcel,
  parseExcelFile,
  detectColumns,
  normalizeData,
  consolidateDuplicates,
} from '../../lib/excelUtils';
import { isLowStock, getLowStockThreshold, isProductIgnoredFromStock } from '../../lib/stockRules';

export default function InventarioPage() {
  const { currentUser, canEdit } = useAuth();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editProduct, setEditProduct] = useState(null);
  const [formData, setFormData] = useState({ sku: '', name: '', quantity: '', category: '' });
  const [stockEditMode, setStockEditMode] = useState('add'); // 'add' | 'set'
  const [quantityToAdd, setQuantityToAdd] = useState('');
  const [modalNotaPedido, setModalNotaPedido] = useState('');
  const [updatingProductIds, setUpdatingProductIds] = useState(new Set());

  // Estados para Familias, Categorías, Tono / Color y Filtro de Stock
  const [selectedMainType, setSelectedMainType] = useState('all'); // 'all' | 'planchas' | 'perfiles' | 'accesorios' | 'pinturas'
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedColor, setSelectedColor] = useState('all'); // 'all' | 'clear' | 'opal' | 'bronce'
  const [selectedStockStatus, setSelectedStockStatus] = useState('all'); // 'all' | 'bajo_stock' | 'ignorados'
  const [viewMode, setViewMode] = useState('flat'); // 'flat' | 'grouped'
  const [openSections, setOpenSections] = useState(new Set());

  // Estados para Descontar por Nota de Pedido
  const [showNotaPedidoModal, setShowNotaPedidoModal] = useState(false);
  const [npNumber, setNpNumber] = useState('');
  const [npCliente, setNpCliente] = useState('');
  const [npItems, setNpItems] = useState([]);
  const [npSearch, setNpSearch] = useState('');
  const [npSubmitting, setNpSubmitting] = useState(false);
  const [npError, setNpError] = useState('');
  const [npSuccess, setNpSuccess] = useState('');
  const [npPasteText, setNpPasteText] = useState('');
  const [npInputMode, setNpInputMode] = useState('list'); // 'list' | 'paste'

  // Estados para Importar Excel
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importRawData, setImportRawData] = useState([]);
  const [importCols, setImportCols] = useState(null);
  const [importMode, setImportMode] = useState('upsert'); // upsert | only_new | replace | add_stock
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const [importError, setImportError] = useState('');
  const [importSuccess, setImportSuccess] = useState('');
  const [consolidationInfo, setConsolidationInfo] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    const q = query(collection(db, 'products'), orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const prods = [];
      snapshot.forEach((doc) => {
        prods.push({ id: doc.id, ...doc.data() });
      });
      setProducts(prods);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Extraer categorías únicas con conteos
  const categoryCounts = products.reduce((acc, p) => {
    const cat = (p.category || 'SIN CATEGORÍA').toUpperCase();
    acc[cat] = (acc[cat] || 0) + 1;
    return acc;
  }, {});

  const categories = Object.keys(categoryCounts).sort((a, b) => {
    if (a === 'SIN CATEGORÍA') return 1;
    if (b === 'SIN CATEGORÍA') return -1;
    return a.localeCompare(b);
  });

  // Abrir todas las secciones por defecto cuando hay categorías
  useEffect(() => {
    if (categories.length > 0 && openSections.size === 0) {
      setOpenSections(new Set(categories));
    }
  }, [products]);

  // Colores asignados por categoría
  const CATEGORY_COLORS = {
    'ONDULADAS': { bg: 'rgba(0, 212, 255, 0.12)', color: '#00d4ff', icon: 'bi-water' },
    'ALVEOLAR': { bg: 'rgba(16, 185, 129, 0.12)', color: '#10b981', icon: 'bi-grid-3x3' },
    'PERFILES': { bg: 'rgba(245, 158, 11, 0.12)', color: '#f59e0b', icon: 'bi-rulers' },
    'INDUSTRIAL': { bg: 'rgba(239, 68, 68, 0.12)', color: '#ef4444', icon: 'bi-building' },
    'PACK': { bg: 'rgba(59, 130, 246, 0.12)', color: '#3b82f6', icon: 'bi-box2' },
    'COMPACTO': { bg: 'rgba(236, 72, 153, 0.12)', color: '#ec4899', icon: 'bi-square' },
    'ACCESORIOS': { bg: 'rgba(168, 85, 247, 0.12)', color: '#a855f7', icon: 'bi-wrench' },
    'ROLLO': { bg: 'rgba(20, 184, 166, 0.12)', color: '#14b8a6', icon: 'bi-arrow-repeat' },
    'MATERIAS PRIMAS': { bg: 'rgba(251, 146, 60, 0.12)', color: '#fb923c', icon: 'bi-moisture' },
    'OTROS': { bg: 'rgba(148, 163, 184, 0.12)', color: '#94a3b8', icon: 'bi-three-dots' },
    'PLANCHAS METALICAS': { bg: 'rgba(100, 116, 139, 0.12)', color: '#64748b', icon: 'bi-subtract' },
    'PINTURAS Y ADHESIVOS': { bg: 'rgba(217, 70, 239, 0.12)', color: '#d946ef', icon: 'bi-paint-bucket' },
    'CANALETAS Y ACCESORIOS': { bg: 'rgba(34, 197, 94, 0.12)', color: '#22c55e', icon: 'bi-funnel' },
    'SIN CATEGORÍA': { bg: 'rgba(255, 255, 255, 0.06)', color: '#94a3b8', icon: 'bi-question-circle' },
  };

  const getCategoryStyle = (cat) => {
    const upper = (cat || '').toUpperCase();
    return CATEGORY_COLORS[upper] || CATEGORY_COLORS['SIN CATEGORÍA'];
  };

  // Helper para clasificar por Familia / Tipo Principal
  const getProductMainType = (p) => {
    const cat = (p?.category || '').toUpperCase();
    const name = (p?.name || '').toUpperCase();
    if (cat.includes('PERFIL') || name.includes('PERFIL')) return 'perfiles';
    if (cat.includes('PINTUR') || cat.includes('ADHESIV') || name.includes('PINTUR') || name.includes('SILICON')) return 'pinturas';
    if (cat.includes('ACCESORIO') || cat.includes('CANALETA') || name.includes('TORNILL') || name.includes('GOLILLA') || name.includes('CINTA') || name.includes('GANCHO') || name.includes('SOPORTE')) return 'accesorios';
    if (['ALVEOLAR', 'ONDULAD', 'INDUSTRI', 'COMPACT', 'PACK', 'ROLLO', 'PLANCHA'].some((k) => cat.includes(k) || name.includes(k))) return 'planchas';
    return 'otros';
  };

  // Helper para detectar tono / color del producto (Clear, Opal, Bronce)
  const detectProductColor = (p) => {
    const text = `${p?.name || ''} ${p?.sku || ''}`.toUpperCase();
    if (/\bOPAL\b/.test(text)) return 'opal';
    if (/\bBRONCE\b/.test(text)) return 'bronce';
    if (/\bCLEAR\b/.test(text) || /\bTRANSPARENTE\b/.test(text)) return 'clear';
    return 'otro';
  };

  // Conteos calculados para la familia principal
  const mainTypeCounts = {
    all: products.length,
    planchas: products.filter((p) => getProductMainType(p) === 'planchas').length,
    perfiles: products.filter((p) => getProductMainType(p) === 'perfiles').length,
    accesorios: products.filter((p) => getProductMainType(p) === 'accesorios').length,
    pinturas: products.filter((p) => getProductMainType(p) === 'pinturas').length,
  };

  // Planchas y sus categorías específicas para el subfiltro
  const planchaProducts = products.filter((p) => getProductMainType(p) === 'planchas');
  const planchaCategories = Object.keys(
    planchaProducts.reduce((acc, p) => {
      const cat = (p.category || 'SIN CATEGORÍA').toUpperCase();
      acc[cat] = (acc[cat] || 0) + 1;
      return acc;
    }, {})
  ).sort();

  // Base para conteos de tono en Planchas (si hay una categoría específica seleccionada, se ajusta a ella)
  const activePlanchaBase = selectedCategory !== 'all'
    ? planchaProducts.filter((p) => (p.category || 'SIN CATEGORÍA').toUpperCase() === selectedCategory)
    : planchaProducts;

  const planchaColorCounts = {
    all: activePlanchaBase.length,
    clear: activePlanchaBase.filter((p) => detectProductColor(p) === 'clear').length,
    opal: activePlanchaBase.filter((p) => detectProductColor(p) === 'opal').length,
    bronce: activePlanchaBase.filter((p) => detectProductColor(p) === 'bronce').length,
  };

  // Conteos calculados para stock
  const stockCounts = {
    bajo_stock: products.filter((p) => isLowStock(p) && !isProductIgnoredFromStock(p)).length,
    ignorados: products.filter((p) => isProductIgnoredFromStock(p)).length,
  };

  const filteredProducts = products.filter((p) => {
    const s = search.toLowerCase();
    const cat = (p.category || 'SIN CATEGORÍA').toUpperCase();
    const name = (p.name || '').toUpperCase();
    const sku = (p.sku || '').toUpperCase();

    const matchesSearch =
      sku.toLowerCase().includes(s) ||
      name.toLowerCase().includes(s) ||
      cat.toLowerCase().includes(s);

    let matchesMainType = true;
    if (selectedMainType !== 'all') {
      matchesMainType = getProductMainType(p) === selectedMainType;
    }

    const matchesCategory =
      selectedCategory === 'all' || cat === selectedCategory;

    const pColor = detectProductColor(p);
    const matchesColor =
      selectedColor === 'all' || pColor === selectedColor;

    let matchesStock = true;
    if (selectedStockStatus === 'bajo_stock') {
      matchesStock = isLowStock(p) && !isProductIgnoredFromStock(p);
    } else if (selectedStockStatus === 'ignorados') {
      matchesStock = isProductIgnoredFromStock(p);
    }

    return matchesSearch && matchesMainType && matchesCategory && matchesColor && matchesStock;
  });

  // Agrupación por categoría para vista agrupada
  const groupedProducts = {};
  filteredProducts.forEach((p) => {
    const cat = (p.category || 'SIN CATEGORÍA').toUpperCase();
    if (!groupedProducts[cat]) groupedProducts[cat] = [];
    groupedProducts[cat].push(p);
  });

  const toggleSection = (cat) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const renderProductMobileCard = (product, showCategory = false) => {
    const style = getCategoryStyle(product.category);
    const qty = Number(product.quantity) || 0;
    const isNegative = qty < 0;
    const isZero = qty === 0;
    const isIgnored = isProductIgnoredFromStock(product);
    const isLow = !isIgnored && isLowStock(product);
    const threshold = isIgnored ? null : getLowStockThreshold(product.category, product);
    const isUpdating = updatingProductIds.has(product.id);

    return (
      <div key={product.id} className="card bg-dark border-secondary text-light h-100 shadow-sm" style={{ background: 'rgba(15, 15, 35, 0.95)' }}>
        <div className="card-body p-3">
          {/* Header: SKU + Categoría */}
          <div className="d-flex justify-content-between align-items-center mb-2 gap-2">
            <span
              className="badge font-monospace text-truncate"
              style={{
                background: 'rgba(0, 212, 255, 0.15)',
                color: '#00d4ff',
                fontSize: '12px',
                maxWidth: '65%',
                padding: '4px 8px',
              }}
            >
              {product.sku || 'SIN SKU'}
            </span>
            {showCategory && (
              <span
                className="badge text-truncate"
                style={{
                  background: style.bg,
                  color: style.color,
                  border: `1px solid ${style.color}44`,
                  fontSize: '11px',
                }}
              >
                <i className={`bi ${style.icon} me-1`}></i>
                {(product.category || 'SIN CATEGORÍA').toUpperCase()}
              </span>
            )}
          </div>

          {/* Nombre Producto */}
          <h6 className="card-title fw-bold text-light mb-3 d-flex align-items-center justify-content-between flex-wrap gap-1" style={{ fontSize: '15px', lineHeight: 1.35, wordBreak: 'break-word' }}>
            <span>{product.name}</span>
            {(() => {
              const col = detectProductColor(product);
              if (col === 'clear') {
                return <span className="badge" style={{ background: 'rgba(0, 212, 255, 0.15)', color: '#00d4ff', fontSize: '11px', border: '1px solid rgba(0, 212, 255, 0.3)' }}><i className="bi bi-droplet-half me-1"></i>Clear</span>;
              }
              if (col === 'opal') {
                return <span className="badge" style={{ background: 'rgba(255, 255, 255, 0.15)', color: '#f8fafc', fontSize: '11px', border: '1px solid rgba(255, 255, 255, 0.3)' }}><i className="bi bi-circle-fill me-1" style={{ fontSize: '8px' }}></i>Opal</span>;
              }
              if (col === 'bronce') {
                return <span className="badge" style={{ background: 'rgba(217, 119, 6, 0.2)', color: '#fbbf24', fontSize: '11px', border: '1px solid rgba(217, 119, 6, 0.4)' }}><i className="bi bi-sun-fill me-1"></i>Bronce</span>;
              }
              return null;
            })()}
          </h6>

          {/* Fila Stock Actual + Stepper Táctil */}
          <div
            className="p-2 rounded mb-3 d-flex justify-content-between align-items-center gap-2"
            style={{
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
            }}
          >
            <div className="min-w-0">
              <small className="text-secondary text-uppercase fw-bold d-block" style={{ fontSize: '10px', letterSpacing: '0.05em' }}>
                Stock actual
              </small>
              <div className="d-flex align-items-center gap-2 mt-1">
                <span
                  className="fw-bold fs-5 font-monospace"
                  style={{
                    color: isNegative
                      ? 'var(--danger, #ef4444)'
                      : isZero
                      ? (isIgnored ? 'var(--text-secondary, #94a3b8)' : 'var(--warning, #f59e0b)')
                      : isLow
                      ? 'var(--warning, #f59e0b)'
                      : 'var(--text-primary, #f0f0f5)',
                  }}
                >
                  {product.quantity} uds
                </span>
                {isNegative ? (
                  <span className="badge bg-danger text-light px-2 py-1" style={{ fontSize: '10px' }}>
                    Faltante
                  </span>
                ) : isLow ? (
                  <span className="badge bg-warning text-dark px-2 py-1 fw-bold" style={{ fontSize: '10px' }}>
                    <i className="bi bi-exclamation-triangle-fill me-1"></i>
                    Bajo stock (&lt;{threshold} uds)
                  </span>
                ) : isIgnored ? (
                  <span className="badge bg-secondary text-light px-2 py-1" style={{ fontSize: '10px', opacity: 0.8 }} title="Ignorado de alertas de stock">
                    Sin alerta
                  </span>
                ) : null}
              </div>
            </div>

            {/* Stepper Buttons (44x44px touch targets para tablet y móvil) */}
            <div className="btn-group" role="group" aria-label="Ajustar stock">
              <button
                type="button"
                className="btn btn-outline-secondary text-light fw-bold fs-5 px-3 py-2"
                onClick={() => handleQuantityChange(product, -1)}
                disabled={!canEdit || isUpdating}
                style={{ minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                aria-label="Restar 1"
                title={!canEdit ? 'Solo Franco y M.silva pueden editar' : 'Restar 1'}
              >
                {isUpdating ? '...' : '−'}
              </button>
              <span
                className="btn btn-dark text-light fw-bold disabled fs-6 px-2 py-2"
                style={{ minWidth: '42px', opacity: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                {product.quantity}
              </span>
              <button
                type="button"
                className="btn btn-outline-info text-info fw-bold fs-5 px-3 py-2"
                onClick={() => handleQuantityChange(product, 1)}
                disabled={!canEdit || isUpdating}
                style={{ minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                aria-label="Sumar 1"
                title={!canEdit ? 'Solo Franco y M.silva pueden editar' : 'Sumar 1'}
              >
                {isUpdating ? '...' : '+'}
              </button>
            </div>
          </div>

          {/* Acciones: Editar y Eliminar o Solo Lectura */}
          {canEdit ? (
            <div className="d-flex gap-2">
              <button
                type="button"
                className="btn btn-outline-secondary text-light btn-sm flex-grow-1 py-2 fw-semibold d-flex align-items-center justify-content-center gap-2"
                onClick={() => openEditModal(product)}
                style={{ minHeight: '42px' }}
              >
                <i className="bi bi-pencil-square"></i> Editar
              </button>
              <button
                type="button"
                className="btn btn-outline-danger btn-sm px-3 py-2 d-flex align-items-center justify-content-center"
                onClick={() => handleDelete(product)}
                title="Eliminar producto"
                aria-label="Eliminar producto"
                style={{ minWidth: '44px', minHeight: '42px' }}
              >
                <i className="bi bi-trash3"></i>
              </button>
            </div>
          ) : (
            <div className="text-secondary small text-center py-2 rounded" style={{ fontSize: '12px', background: 'rgba(255,255,255,0.03)' }}>
              <i className="bi bi-shield-lock me-1"></i> Modo consulta (solo lectura)
            </div>
          )}
        </div>
      </div>
    );
  };

  const evaluateMathInput = (val) => {
    if (typeof val === 'number') return isNaN(val) ? 0 : val;
    if (!val || typeof val !== 'string') return 0;
    const trimmed = val.trim();
    if (!trimmed) return 0;
    // Soporte para comas decimales ej: 27,5 -> 27.5
    const normalized = trimmed.replace(/,/g, '.').replace(/\s+/g, '');
    if (/^[+-]?\d+(\.\d+)?([+-]\d+(\.\d+)?)*$/.test(normalized)) {
      try {
        const tokens = normalized.match(/[+-]?[0-9]+(\.[0-9]+)?/g);
        if (tokens) {
          const sum = tokens.reduce((acc, t) => acc + parseFloat(t), 0);
          return Math.round(sum * 100) / 100;
        }
      } catch {
        return parseFloat(normalized) || 0;
      }
    }
    return parseFloat(normalized) || 0;
  };

  const currentBaseQty = editProduct ? (Number(editProduct.quantity) || 0) : 0;
  const parsedAddQty = evaluateMathInput(quantityToAdd);
  const calculatedQtyFromAdd = Math.round((currentBaseQty + parsedAddQty) * 100) / 100;
  const calculatedQtyFromSet = evaluateMathInput(formData.quantity);

  const openAddModal = () => {
    setEditProduct(null);
    setFormData({ sku: '', name: '', quantity: '', category: '' });
    setStockEditMode('set');
    setQuantityToAdd('');
    setModalNotaPedido('');
    setShowModal(true);
  };

  const openEditModal = (product) => {
    setEditProduct(product);
    setFormData({
      sku: product.sku,
      name: product.name,
      quantity: String(product.quantity ?? 0),
      category: product.category || '',
    });
    setStockEditMode('add');
    setQuantityToAdd('');
    setModalNotaPedido('');
    setShowModal(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!canEdit) {
      alert('Solo Franco y M.silva tienen permisos para editar productos.');
      return;
    }
    const cleanSku = formData.sku.trim().slice(0, 100);
    const cleanName = formData.name.trim().slice(0, 200);
    const cleanCategory = (formData.category || 'SIN CATEGORÍA').trim().toUpperCase();
    const qty = editProduct
      ? (stockEditMode === 'add' ? calculatedQtyFromAdd : calculatedQtyFromSet)
      : evaluateMathInput(formData.quantity);

    if (!cleanSku || !cleanName) return;

    try {
      if (editProduct) {
        // Editar
        const prevQty = Number(editProduct.quantity) || 0;
        await updateDoc(doc(db, 'products', editProduct.id), {
          sku: cleanSku,
          name: cleanName,
          category: cleanCategory,
          quantity: qty,
          lastUpdated: serverTimestamp(),
          updatedBy: currentUser?.uid || 'anon',
        });

        const isDeduction = qty < prevQty;
        const isAddition = qty > prevQty;
        const diff = Math.abs(qty - prevQty);
        const hasNota = modalNotaPedido.trim().length > 0;

        const action = hasNota && isDeduction
          ? 'descuento_nota_pedido'
          : (isAddition ? 'cantidad_agregada' : (isDeduction ? 'cantidad_descontada' : 'producto_editado'));

        await logAction(action, currentUser, {
          sku: cleanSku,
          productName: cleanName,
          category: cleanCategory,
          previousValue: prevQty,
          newValue: qty,
          notaPedido: modalNotaPedido.trim(),
          description: hasNota && isDeduction
            ? `Descuento por Nota de Pedido #${modalNotaPedido.trim()}: ${diff} uds de ${cleanSku}`
            : (qty !== prevQty ? `${isAddition ? 'Sumó' : 'Descontó'} ${diff} uds a ${cleanSku} (${cleanName})` : `Editó ${cleanSku} (${cleanName})`),
        });

        if (qty !== prevQty) {
          const msg = hasNota && isDeduction
            ? `${currentUser?.displayName || currentUser?.email || 'Usuario'} descontó ${diff} uds de ${cleanSku} por Nota de Pedido #${modalNotaPedido.trim()}`
            : (isAddition
              ? `${currentUser?.displayName || currentUser?.email || 'Usuario'} agregó ${diff} uds a ${cleanSku} (${cleanName})`
              : `${currentUser?.displayName || currentUser?.email || 'Usuario'} descontó ${diff} uds de ${cleanSku} (${cleanName})`);
          await sendNotification(isAddition ? 'agregado' : 'descuento', msg, currentUser);
        }
      } else {
        // Crear
        await addDoc(collection(db, 'products'), {
          sku: cleanSku,
          name: cleanName,
          category: cleanCategory,
          quantity: qty,
          createdAt: serverTimestamp(),
          lastUpdated: serverTimestamp(),
          updatedBy: currentUser?.uid || 'anon',
        });

        await logAction('producto_creado', currentUser, {
          sku: cleanSku,
          productName: cleanName,
          category: cleanCategory,
          newValue: qty,
          description: `Creó producto ${cleanSku} (${cleanName}) con stock ${qty}`,
        });

        await sendNotification(
          'creado',
          `${currentUser?.displayName || currentUser?.email || 'Usuario'} agregó nuevo producto ${cleanSku} (${cleanName})`,
          currentUser
        );
      }

      setShowModal(false);
      setModalNotaPedido('');
    } catch (error) {
      console.error('Error guardando producto:', error);
      alert('Error al guardar producto: ' + error.message);
    }
  };

  const handleDelete = async (product) => {
    if (!canEdit) {
      alert('Solo Franco y M.silva tienen permisos para eliminar productos.');
      return;
    }
    if (!confirm(`¿Estás seguro de eliminar "${product.name}" (${product.sku})?`)) {
      return;
    }

    try {
      await deleteDoc(doc(db, 'products', product.id));

      await logAction('producto_eliminado', currentUser, {
        sku: product.sku,
        productName: product.name,
        previousValue: product.quantity,
        description: `Eliminó ${product.sku} (${product.name})`,
      });

      await sendNotification(
        'eliminado',
        `${currentUser?.displayName || currentUser?.email || 'Usuario'} eliminó ${product.sku} (${product.name})`,
        currentUser
      );
    } catch (error) {
      console.error('Error eliminando producto:', error);
      alert('Error al eliminar producto: ' + error.message);
    }
  };

  const handleQuantityChange = async (product, delta) => {
    if (!canEdit) {
      alert('Solo Franco y M.silva tienen permisos para ajustar el stock.');
      return;
    }
    if (updatingProductIds.has(product.id)) return;
    setUpdatingProductIds((prev) => new Set(prev).add(product.id));

    const currentQty = Number(product.quantity) || 0;
    const newQty = Math.round((currentQty + delta) * 100) / 100;

    try {
      await updateDoc(doc(db, 'products', product.id), {
        quantity: newQty,
        lastUpdated: serverTimestamp(),
        updatedBy: currentUser?.uid || 'anon',
      });

      const action = delta > 0 ? 'cantidad_agregada' : 'cantidad_descontada';
      await logAction(action, currentUser, {
        sku: product.sku,
        productName: product.name,
        category: product.category,
        previousValue: currentQty,
        newValue: newQty,
        description: `${delta > 0 ? 'Sumó' : 'Descontó'} ${Math.abs(delta)} ud(s) a ${product.sku} (${product.name})`,
      });

      const msg = delta > 0
        ? `${currentUser?.displayName || currentUser?.email || 'Usuario'} agregó ${delta} uds a ${product.sku} (${product.name})`
        : `${currentUser?.displayName || currentUser?.email || 'Usuario'} descontó ${Math.abs(delta)} uds de ${product.sku} (${product.name})`;
      await sendNotification(delta > 0 ? 'agregado' : 'descuento', msg, currentUser);
    } catch (error) {
      console.error('Error actualizando cantidad:', error);
      alert('Error al modificar cantidad: ' + error.message);
    } finally {
      setUpdatingProductIds((prev) => {
        const next = new Set(prev);
        next.delete(product.id);
        return next;
      });
    }
  };

  // Funciones para Modal Descontar por Nota de Pedido
  const handleAddProductToNp = (p) => {
    if (npItems.some((it) => it.id === p.id)) return;
    setNpItems((prev) => [
      ...prev,
      {
        id: p.id,
        sku: p.sku,
        name: p.name,
        currentStock: Number(p.quantity) || 0,
        quantityToDiscount: 1,
      },
    ]);
    setNpSearch('');
  };

  const handleUpdateNpItemQty = (index, val) => {
    setNpItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], quantityToDiscount: val };
      return next;
    });
  };

  const handleRemoveNpItem = (index) => {
    setNpItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleParsePasteNp = () => {
    if (!npPasteText.trim()) return;
    const lines = npPasteText.split(/\r?\n/);
    const added = [];
    const notFoundSkus = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const match = trimmed.match(/^([A-Za-z0-9._-]+)[\s,;\t]+([0-9]+(?:[.,][0-9]+)?)/);
      if (match) {
        const skuCode = match[1].trim();
        const qty = parseFloat(match[2].replace(',', '.'));
        const matchedProd = products.find(
          (p) => String(p.sku || '').trim().toLowerCase() === skuCode.toLowerCase()
        );
        if (matchedProd) {
          if (!added.some((it) => it.id === matchedProd.id) && !npItems.some((it) => it.id === matchedProd.id)) {
            added.push({
              id: matchedProd.id,
              sku: matchedProd.sku,
              name: matchedProd.name,
              currentStock: Number(matchedProd.quantity) || 0,
              quantityToDiscount: qty || 1,
            });
          }
        } else {
          notFoundSkus.push(skuCode);
        }
      }
    }

    if (added.length > 0) {
      setNpItems((prev) => [...prev, ...added]);
      setNpPasteText('');
      setNpInputMode('list');
      if (notFoundSkus.length > 0) {
        setNpError(`Se agregaron ${added.length} productos, pero no se encontraron estos SKUs: ${notFoundSkus.join(', ')}`);
      } else {
        setNpError('');
      }
    } else {
      setNpError('No se reconocieron SKUs válidos en el texto pegado.');
    }
  };

  const handleApplyNotaPedido = async (e) => {
    if (e) e.preventDefault();
    if (!canEdit) {
      alert('Solo Franco y M.silva tienen permisos para descontar stock.');
      return;
    }
    const cleanNp = npNumber.trim();
    if (!cleanNp) {
      setNpError('Por favor ingresa el número o código de la Nota de Pedido.');
      return;
    }
    if (npItems.length === 0) {
      setNpError('Agrega al menos un producto a la lista para descontar.');
      return;
    }
    for (const item of npItems) {
      const q = Number(item.quantityToDiscount);
      if (isNaN(q) || q <= 0) {
        setNpError(`La cantidad a descontar para ${item.sku} debe ser mayor a 0.`);
        return;
      }
    }

    setNpSubmitting(true);
    setNpError('');
    setNpSuccess('');

    try {
      let totalUnits = 0;
      for (const item of npItems) {
        const qtyToDiscount = Number(item.quantityToDiscount);
        totalUnits += qtyToDiscount;
        const prevQty = Number(item.currentStock) || 0;
        const newQty = Math.round((prevQty - qtyToDiscount) * 100) / 100;

        await updateDoc(doc(db, 'products', item.id), {
          quantity: newQty,
          lastUpdated: serverTimestamp(),
          updatedBy: currentUser?.uid || 'anon',
        });

        await logAction('descuento_nota_pedido', currentUser, {
          sku: item.sku,
          productName: item.name,
          previousValue: prevQty,
          newValue: newQty,
          notaPedido: cleanNp,
          cliente: npCliente.trim(),
          description: `Descuento por Nota de Pedido #${cleanNp}: ${qtyToDiscount} uds de ${item.sku} (${item.name})`,
        });
      }

      await sendNotification(
        'descuento',
        `${currentUser?.displayName || currentUser?.email || 'Usuario'} descontó ${totalUnits} uds (${npItems.length} productos) por Nota de Pedido #${cleanNp}`,
        currentUser
      );

      setNpSuccess(`¡Éxito! Se descontaron ${totalUnits} unidades de ${npItems.length} productos por la Nota de Pedido #${cleanNp}.`);
      setNpItems([]);
      setNpNumber('');
      setNpCliente('');
      setNpPasteText('');
      setTimeout(() => {
        setShowNotaPedidoModal(false);
        setNpSuccess('');
      }, 1800);
    } catch (err) {
      console.error('Error aplicando nota de pedido:', err);
      setNpError('Error al descontar stock: ' + err.message);
    } finally {
      setNpSubmitting(false);
    }
  };

  const handleExport = () => {
    exportInventoryToExcel(products, `inventario_${new Date().toISOString().slice(0, 10)}.xlsx`);
    logAction('reporte_descargado', currentUser, {
      description: 'Exportó inventario completo a Excel',
    });
  };

  // Manejo de carga de archivo Excel para importar
  const handleFileChange = async (file) => {
    if (!file) return;
    setImportError('');
    setImportSuccess('');
    setImportFile(file);

    try {
      const data = await parseExcelFile(file);
      if (!data || data.length === 0) {
        setImportError('El archivo Excel está vacío o no tiene datos válidos.');
        return;
      }
      const detected = detectColumns(data);
      setImportRawData(data);
      setImportCols(detected);
    } catch (err) {
      setImportError(`Error al procesar el archivo: ${err.message}`);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleFileChange(file);
  };

  // Auto-consolidar duplicados cuando cambian los datos o columnas
  const getConsolidatedPreview = () => {
    if (!importRawData.length || !importCols?.sku || !importCols?.quantity) return null;
    try {
      const normalized = normalizeData(importRawData, importCols);
      const result = consolidateDuplicates(normalized);
      return result;
    } catch {
      return null;
    }
  };

  const handleExecuteImport = async () => {
    if (!canEdit) {
      setImportError('Solo los administradores autorizados (Franco y M.silva) pueden importar archivos Excel.');
      return;
    }
    if (!importCols?.sku || !importCols?.quantity) {
      setImportError('Debes seleccionar al menos las columnas de SKU y Cantidad.');
      return;
    }

    setImporting(true);
    setImportProgress('Normalizando datos...');
    setImportError('');
    setImportSuccess('');
    setConsolidationInfo(null);

    try {
      const rawNormalized = normalizeData(importRawData, importCols);

      // Consolidar duplicados del Excel (sumar SKUs repetidos)
      const { consolidated: normalized, duplicatesFound, duplicateDetails } = consolidateDuplicates(rawNormalized);

      if (duplicatesFound > 0) {
        setConsolidationInfo({
          count: duplicatesFound,
          originalRows: rawNormalized.length,
          consolidatedRows: normalized.length,
          details: duplicateDetails,
        });
      }

      if (importMode === 'replace') {
        setImportProgress('Eliminando inventario anterior...');
        const BATCH_SIZE = 450;
        for (let i = 0; i < products.length; i += BATCH_SIZE) {
          const chunk = products.slice(i, i + BATCH_SIZE);
          const batch = writeBatch(db);
          chunk.forEach((p) => batch.delete(doc(db, 'products', p.id)));
          await batch.commit();
        }
      }

      const existingMap = new Map();
      if (importMode !== 'replace') {
        products.forEach((p) => existingMap.set(p.sku.toLowerCase(), p));
      }

      const BATCH_SIZE = 450;
      let inserted = 0;
      let updated = 0;
      let skipped = 0;
      let summed = 0;

      for (let i = 0; i < normalized.length; i += BATCH_SIZE) {
        const chunk = normalized.slice(i, i + BATCH_SIZE);
        const batch = writeBatch(db);

        for (const item of chunk) {
          const key = item.sku.toLowerCase();
          const existing = existingMap.get(key);

          if (importMode === 'only_new') {
            if (existing) {
              skipped++;
              continue;
            }
            const newRef = doc(collection(db, 'products'));
            batch.set(newRef, {
              sku: item.sku,
              name: item.name || item.sku,
              category: item.category || 'SIN CATEGORÍA',
              quantity: item.quantity,
              createdAt: serverTimestamp(),
              lastUpdated: serverTimestamp(),
              updatedBy: currentUser.uid,
            });
            inserted++;
          } else if (importMode === 'replace') {
            const newRef = doc(collection(db, 'products'));
            batch.set(newRef, {
              sku: item.sku,
              name: item.name || item.sku,
              category: item.category || 'SIN CATEGORÍA',
              quantity: item.quantity,
              createdAt: serverTimestamp(),
              lastUpdated: serverTimestamp(),
              updatedBy: currentUser.uid,
            });
            inserted++;
          } else if (importMode === 'add_stock') {
            // Sumar cantidades a lo existente
            if (existing) {
              const newQty = (existing.quantity || 0) + item.quantity;
              const updatePayload = {
                quantity: newQty,
                lastUpdated: serverTimestamp(),
                updatedBy: currentUser.uid,
              };
              if (item.name && item.name.length > (existing.name || '').length) {
                updatePayload.name = item.name;
              }
              if (item.category) updatePayload.category = item.category;
              batch.update(doc(db, 'products', existing.id), updatePayload);
              summed++;
            } else {
              const newRef = doc(collection(db, 'products'));
              batch.set(newRef, {
                sku: item.sku,
                name: item.name || item.sku,
                category: item.category || 'SIN CATEGORÍA',
                quantity: item.quantity,
                createdAt: serverTimestamp(),
                lastUpdated: serverTimestamp(),
                updatedBy: currentUser.uid,
              });
              inserted++;
            }
          } else {
            // upsert (actualizar o crear)
            if (existing) {
              const updatePayload = {
                name: item.name || existing.name,
                quantity: item.quantity,
                lastUpdated: serverTimestamp(),
                updatedBy: currentUser.uid,
              };
              if (item.category) updatePayload.category = item.category;
              batch.update(doc(db, 'products', existing.id), updatePayload);
              updated++;
            } else {
              const newRef = doc(collection(db, 'products'));
              batch.set(newRef, {
                sku: item.sku,
                name: item.name || item.sku,
                category: item.category || 'SIN CATEGORÍA',
                quantity: item.quantity,
                createdAt: serverTimestamp(),
                lastUpdated: serverTimestamp(),
                updatedBy: currentUser.uid,
              });
              inserted++;
            }
          }
        }

        setImportProgress(`Guardando lote ${Math.min(i + BATCH_SIZE, normalized.length)} de ${normalized.length}...`);
        await batch.commit();
      }

      // Registro en auditoría y notificación
      const dupMsg = duplicatesFound > 0 ? ` (${duplicatesFound} duplicados consolidados)` : '';
      const sumMsg = summed > 0 ? `, ${summed} sumados` : '';
      await logAction('excel_subido', currentUser, {
        fileName: importFile.name,
        mode: importMode,
        totalRows: normalized.length,
        inserted,
        updated,
        skipped,
        summed,
        duplicatesConsolidated: duplicatesFound,
        description: `Importó Excel "${importFile.name}": ${inserted} creados, ${updated} actualizados${sumMsg}${skipped ? `, ${skipped} omitidos` : ''}${dupMsg}.`,
      });

      await sendNotification(
        'info',
        `${currentUser.displayName || currentUser.email} importó ${normalized.length} productos desde Excel (${inserted} creados, ${updated} actualizados${sumMsg})`,
        currentUser
      );

      setImportSuccess(`¡Importación completada! ${inserted} creados, ${updated} actualizados${sumMsg}${skipped ? `, ${skipped} omitidos` : ''}${dupMsg}.`);
      setTimeout(() => {
        setShowImportModal(false);
        setImportFile(null);
        setImportRawData([]);
        setImportCols(null);
        setImportSuccess('');
        setImportProgress('');
        setConsolidationInfo(null);
      }, 2500);
    } catch (err) {
      console.error('Error importando:', err);
      setImportError(`Error al importar: ${err.message}`);
    }

    setImporting(false);
  };

  if (loading) {
    return (
      <div className="page-container">
        <div style={{ display: 'flex', justifyContent: 'center', padding: '60px' }}>
          <div className="spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Inventario</h1>
        <p className="page-description">
          {products.length} productos registrados en {categories.length} categorías
        </p>
      </div>

      {/* Bootstrap 5 Responsive Toolbar */}
      <div className="row g-2 mb-3 align-items-center">
        {/* Search Bar */}
        <div className="col-12 col-md-6 col-xl-5">
          <div className="input-group">
            <span className="input-group-text bg-dark border-secondary text-secondary">
              <i className="bi bi-search"></i>
            </span>
            <input
              type="text"
              className="form-control bg-dark border-secondary text-light"
              placeholder="Buscar por SKU, nombre o categoría..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ fontSize: '15px', minHeight: '42px' }}
            />
            {search && (
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={() => setSearch('')}
                aria-label="Limpiar búsqueda"
              >
                <i className="bi bi-x-lg"></i>
              </button>
            )}
          </div>
        </div>

        {/* View Toggle */}
        <div className="col-12 col-sm-auto">
          <div className="btn-group w-100" role="group">
            <button
              type="button"
              className={`btn btn-sm ${viewMode === 'grouped' ? 'btn-primary' : 'btn-outline-secondary text-light'}`}
              onClick={() => {
                setViewMode('grouped');
                if (openSections.size === 0) {
                  setOpenSections(new Set(categories));
                }
              }}
              style={{ minHeight: '42px' }}
            >
              <i className="bi bi-collection me-1"></i> Secciones
            </button>
            <button
              type="button"
              className={`btn btn-sm ${viewMode === 'flat' ? 'btn-primary' : 'btn-outline-secondary text-light'}`}
              onClick={() => setViewMode('flat')}
              style={{ minHeight: '42px' }}
            >
              <i className="bi bi-list-ul me-1"></i> Lista
            </button>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="col-12 col-xl d-flex justify-content-xl-end gap-2 flex-wrap">
          {/* Botón Descontar por Nota de Pedido */}
          <button
            type="button"
            className="btn btn-sm btn-outline-warning text-warning flex-fill flex-xl-grow-0 d-flex align-items-center justify-content-center gap-1 fw-bold"
            onClick={() => {
              if (!canEdit) {
                alert('Solo Franco y M.silva tienen permisos para descontar stock por Nota de Pedido.');
                return;
              }
              setShowNotaPedidoModal(true);
            }}
            style={{ minHeight: '42px', borderColor: '#f59e0b' }}
            title={!canEdit ? 'Solo Franco y M.silva pueden descontar stock' : 'Descontar stock asociado a una Nota de Pedido'}
          >
            <i className="bi bi-receipt"></i>
            <span>X Nota de Pedido</span>
          </button>

          <button
            type="button"
            className="btn btn-sm btn-outline-secondary text-light flex-fill flex-xl-grow-0 d-flex align-items-center justify-content-center gap-1"
            onClick={() => {
              if (!canEdit) {
                alert('Solo Franco y M.silva tienen permisos para importar archivos Excel.');
                return;
              }
              setShowImportModal(true);
            }}
            disabled={!canEdit}
            style={{ minHeight: '42px' }}
            title={!canEdit ? 'Solo Franco y M.silva pueden importar Excel' : 'Importar Excel'}
          >
            <i className="bi bi-file-earmark-arrow-up"></i>
            <span>Importar Excel</span>
          </button>

          <Link
            href="/conteo"
            className="btn btn-sm btn-outline-info text-info flex-fill flex-xl-grow-0 d-flex align-items-center justify-content-center gap-1"
            style={{ minHeight: '42px', textDecoration: 'none' }}
            title="Ir al modo de Conteo Físico independiente (Auditoría de Bodega)"
          >
            <i className="bi bi-clipboard2-check"></i>
            <span>Conteo Físico</span>
          </Link>

          <button
            type="button"
            className="btn btn-sm btn-outline-secondary text-light flex-fill flex-xl-grow-0 d-flex align-items-center justify-content-center gap-1"
            onClick={handleExport}
            style={{ minHeight: '42px' }}
          >
            <i className="bi bi-file-earmark-excel"></i>
            <span>Exportar Excel</span>
          </button>

          {canEdit && (
            <button
              type="button"
              className="btn btn-sm btn-primary flex-fill flex-xl-grow-0 order-first order-xl-last d-flex align-items-center justify-content-center gap-1 fw-bold"
              onClick={openAddModal}
              style={{ minHeight: '42px' }}
            >
              <i className="bi bi-plus-lg"></i>
              <span>Agregar Producto</span>
            </button>
          )}
        </div>
      </div>

      {/* Barra de Filtro Principal: Familia de Productos y Stock */}
      <div className="card mb-3 p-2 border-secondary" style={{ background: 'rgba(255, 255, 255, 0.03)' }}>
        <div className="d-flex flex-wrap align-items-center justify-content-between gap-2">
          {/* Selector de Familia */}
          <div className="d-flex align-items-center gap-1 flex-wrap">
            <span className="text-secondary small fw-bold text-uppercase d-flex align-items-center gap-1 me-1" style={{ fontSize: '11px', whiteSpace: 'nowrap' }}>
              <i className="bi bi-funnel-fill text-info"></i> Familia:
            </span>

            {/* Todos */}
            <button
              type="button"
              className={`btn btn-sm ${selectedMainType === 'all' ? 'btn-info text-dark fw-bold' : 'btn-outline-secondary text-light'}`}
              onClick={() => {
                setSelectedMainType('all');
                setSelectedCategory('all');
                setSelectedColor('all');
              }}
              style={{ minHeight: '34px', fontSize: '12px', padding: '4px 10px' }}
            >
              <i className="bi bi-grid me-1"></i>
              Todos ({mainTypeCounts.all})
            </button>

            {/* Planchas */}
            <button
              type="button"
              className={`btn btn-sm ${selectedMainType === 'planchas' ? 'btn-primary text-white fw-bold shadow' : 'btn-outline-primary text-light'}`}
              onClick={() => {
                setSelectedMainType('planchas');
                setSelectedCategory('all');
                setSelectedColor('all');
              }}
              style={{ minHeight: '34px', fontSize: '12px', padding: '4px 12px', borderColor: selectedMainType === 'planchas' ? '#3b82f6' : 'rgba(59, 130, 246, 0.5)' }}
            >
              <i className="bi bi-layers me-1"></i>
              Planchas ({mainTypeCounts.planchas})
            </button>

            {/* Perfiles */}
            <button
              type="button"
              className={`btn btn-sm ${selectedMainType === 'perfiles' ? 'btn-warning text-dark fw-bold shadow' : 'btn-outline-secondary text-light'}`}
              onClick={() => {
                setSelectedMainType('perfiles');
                setSelectedCategory('all');
                setSelectedColor('all');
              }}
              style={{ minHeight: '34px', fontSize: '12px', padding: '4px 10px' }}
            >
              <i className="bi bi-rulers me-1"></i>
              Perfiles ({mainTypeCounts.perfiles})
            </button>

            {/* Accesorios */}
            <button
              type="button"
              className={`btn btn-sm ${selectedMainType === 'accesorios' ? 'btn-light text-dark fw-bold shadow' : 'btn-outline-secondary text-light'}`}
              onClick={() => {
                setSelectedMainType('accesorios');
                setSelectedCategory('all');
                setSelectedColor('all');
              }}
              style={{ minHeight: '34px', fontSize: '12px', padding: '4px 10px' }}
            >
              <i className="bi bi-wrench me-1"></i>
              Accesorios ({mainTypeCounts.accesorios})
            </button>

            {/* Pinturas y Adhesivos */}
            <button
              type="button"
              className={`btn btn-sm ${selectedMainType === 'pinturas' ? 'text-light fw-bold shadow' : 'btn-outline-secondary text-light'}`}
              onClick={() => {
                setSelectedMainType('pinturas');
                setSelectedCategory('all');
                setSelectedColor('all');
              }}
              style={{
                minHeight: '34px',
                fontSize: '12px',
                padding: '4px 10px',
                background: selectedMainType === 'pinturas' ? '#d946ef' : 'transparent',
                borderColor: selectedMainType === 'pinturas' ? '#d946ef' : '',
              }}
            >
              <i className="bi bi-paint-bucket me-1"></i>
              Pinturas ({mainTypeCounts.pinturas})
            </button>
          </div>

          {/* Filtro por Estado de Stock y Limpiar */}
          <div className="d-flex align-items-center gap-1 flex-wrap">
            <span className="text-secondary small fw-bold text-uppercase d-flex align-items-center gap-1 me-1" style={{ fontSize: '11px', whiteSpace: 'nowrap' }}>
              <i className="bi bi-speedometer2 text-secondary"></i> Stock:
            </span>

            <button
              type="button"
              className={`btn btn-sm ${selectedStockStatus === 'bajo_stock' ? 'btn-warning text-dark fw-bold' : 'btn-outline-secondary text-light'}`}
              onClick={() => setSelectedStockStatus(selectedStockStatus === 'bajo_stock' ? 'all' : 'bajo_stock')}
              style={{ minHeight: '34px', fontSize: '12px', padding: '4px 10px' }}
              title="Filtrar solo productos con stock bajo"
            >
              <i className="bi bi-exclamation-triangle-fill me-1 text-warning"></i>
              Bajo ({stockCounts.bajo_stock})
            </button>

            <button
              type="button"
              className={`btn btn-sm ${selectedStockStatus === 'ignorados' ? 'btn-secondary text-light fw-bold' : 'btn-outline-secondary text-light'}`}
              onClick={() => setSelectedStockStatus(selectedStockStatus === 'ignorados' ? 'all' : 'ignorados')}
              style={{ minHeight: '34px', fontSize: '12px', padding: '4px 10px' }}
              title="Filtrar solo productos ignorados de alertas de stock"
            >
              <i className="bi bi-eye-slash me-1"></i>
              Ignorados ({stockCounts.ignorados})
            </button>

            {(selectedMainType !== 'all' || selectedColor !== 'all' || selectedStockStatus !== 'all' || selectedCategory !== 'all') && (
              <button
                type="button"
                className="btn btn-sm btn-link text-info text-decoration-none fw-semibold d-inline-flex align-items-center gap-1"
                onClick={() => {
                  setSelectedMainType('all');
                  setSelectedColor('all');
                  setSelectedStockStatus('all');
                  setSelectedCategory('all');
                }}
                style={{ fontSize: '12px', padding: '4px 8px' }}
              >
                <i className="bi bi-x-circle"></i> Limpiar filtros
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Sub-barra de Planchas: Tono (Clear, Opal, Bronce) y Modelos */}
      {selectedMainType === 'planchas' && (
        <div className="card mb-3 p-3 border-info shadow-sm" style={{ background: 'rgba(0, 212, 255, 0.04)', borderColor: 'rgba(0, 212, 255, 0.3)' }}>
          <div className="d-flex flex-column gap-2">
            {/* Fila 1: Tono de Plancha (Clear, Opal, Bronce) */}
            <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 pb-2 border-bottom border-secondary border-opacity-25">
              <div className="d-flex align-items-center gap-2 flex-wrap">
                <span className="text-info small fw-bold text-uppercase d-flex align-items-center gap-1" style={{ fontSize: '11px', whiteSpace: 'nowrap' }}>
                  <i className="bi bi-palette2"></i> Tono de Plancha:
                </span>

                {/* Todas las Planchas */}
                <button
                  type="button"
                  className={`btn btn-sm ${selectedColor === 'all' ? 'btn-info text-dark fw-bold' : 'btn-outline-secondary text-light'}`}
                  onClick={() => setSelectedColor('all')}
                  style={{ minHeight: '32px', fontSize: '12px', padding: '3px 12px' }}
                >
                  <i className="bi bi-grid me-1"></i>
                  Todas ({planchaColorCounts.all})
                </button>

                {/* Solo Clear */}
                <button
                  type="button"
                  className="btn btn-sm fw-bold"
                  onClick={() => setSelectedColor(selectedColor === 'clear' ? 'all' : 'clear')}
                  style={{
                    minHeight: '32px',
                    fontSize: '12px',
                    padding: '3px 12px',
                    background: selectedColor === 'clear' ? '#00d4ff' : 'rgba(0, 212, 255, 0.08)',
                    color: selectedColor === 'clear' ? '#0a0e17' : '#00d4ff',
                    borderColor: '#00d4ff',
                    borderWidth: '1px',
                    borderStyle: 'solid',
                    boxShadow: selectedColor === 'clear' ? '0 0 10px rgba(0, 212, 255, 0.4)' : 'none',
                  }}
                  title="Filtrar solo planchas Clear (Transparentes)"
                >
                  <i className="bi bi-droplet-half me-1"></i>
                  Solo Clear ({planchaColorCounts.clear})
                </button>

                {/* Solo Opal */}
                <button
                  type="button"
                  className="btn btn-sm fw-bold"
                  onClick={() => setSelectedColor(selectedColor === 'opal' ? 'all' : 'opal')}
                  style={{
                    minHeight: '32px',
                    fontSize: '12px',
                    padding: '3px 12px',
                    background: selectedColor === 'opal' ? '#f8fafc' : 'rgba(255, 255, 255, 0.08)',
                    color: selectedColor === 'opal' ? '#0f172a' : '#f8fafc',
                    borderColor: 'rgba(255, 255, 255, 0.6)',
                    borderWidth: '1px',
                    borderStyle: 'solid',
                    boxShadow: selectedColor === 'opal' ? '0 0 10px rgba(255, 255, 255, 0.3)' : 'none',
                  }}
                  title="Filtrar solo planchas Opal"
                >
                  <i className="bi bi-circle-fill me-1" style={{ fontSize: '9px' }}></i>
                  Solo Opal ({planchaColorCounts.opal})
                </button>

                {/* Solo Bronce */}
                <button
                  type="button"
                  className="btn btn-sm fw-bold"
                  onClick={() => setSelectedColor(selectedColor === 'bronce' ? 'all' : 'bronce')}
                  style={{
                    minHeight: '32px',
                    fontSize: '12px',
                    padding: '3px 12px',
                    background: selectedColor === 'bronce' ? '#d97706' : 'rgba(217, 119, 6, 0.12)',
                    color: selectedColor === 'bronce' ? '#ffffff' : '#fbbf24',
                    borderColor: '#d97706',
                    borderWidth: '1px',
                    borderStyle: 'solid',
                    boxShadow: selectedColor === 'bronce' ? '0 0 10px rgba(217, 119, 6, 0.4)' : 'none',
                  }}
                  title="Filtrar solo planchas Bronce"
                >
                  <i className="bi bi-sun-fill me-1"></i>
                  Solo Bronce ({planchaColorCounts.bronce})
                </button>
              </div>

              {selectedColor !== 'all' && (
                <button
                  type="button"
                  className="btn btn-sm btn-link text-info text-decoration-none small p-0 d-inline-flex align-items-center gap-1"
                  onClick={() => setSelectedColor('all')}
                  style={{ fontSize: '11px' }}
                >
                  <i className="bi bi-x-circle"></i> Ver todos los tonos
                </button>
              )}
            </div>

            {/* Fila 2: Sub-categorías / Modelos de Planchas */}
            <div className="d-flex align-items-center gap-1 flex-wrap pt-1">
              <span className="text-secondary small fw-bold text-uppercase d-flex align-items-center gap-1 me-1" style={{ fontSize: '11px', whiteSpace: 'nowrap' }}>
                <i className="bi bi-tag text-secondary"></i> Modelo:
              </span>
              <button
                type="button"
                className={`btn btn-sm ${selectedCategory === 'all' ? 'btn-outline-info text-info fw-bold' : 'btn-outline-secondary text-secondary'}`}
                onClick={() => setSelectedCategory('all')}
                style={{ minHeight: '28px', fontSize: '11px', padding: '2px 8px' }}
              >
                Todos los modelos ({planchaProducts.length})
              </button>
              {planchaCategories.map((cat) => {
                const count = planchaProducts.filter((p) => (p.category || 'SIN CATEGORÍA').toUpperCase() === cat).length;
                const isActive = selectedCategory === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    className={`btn btn-sm ${isActive ? 'btn-info text-dark fw-bold' : 'btn-outline-secondary text-light'}`}
                    onClick={() => setSelectedCategory(isActive ? 'all' : cat)}
                    style={{ minHeight: '28px', fontSize: '11px', padding: '2px 8px' }}
                  >
                    {cat} ({count})
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Selector / Chips de Categorías (solo cuando se está en 'Todos') */}
      {selectedMainType === 'all' && categories.length > 0 && (
        <div className="category-chips-wrapper">
          <div className="category-chips">
            <button
              className={`category-chip ${selectedCategory === 'all' ? 'active' : ''}`}
              onClick={() => setSelectedCategory('all')}
            >
              <i className="bi bi-grid"></i>
              Todas las categorías
              <span className="chip-count">{products.length}</span>
            </button>
            {categories.map((cat) => {
              const style = getCategoryStyle(cat);
              const isActive = selectedCategory === cat;
              return (
                <button
                  key={cat}
                  className={`category-chip ${isActive ? 'active' : ''}`}
                  onClick={() => setSelectedCategory(cat)}
                  style={isActive ? { borderColor: style.color, color: style.color } : {}}
                >
                  <i className={`bi ${style.icon}`} style={{ color: style.color }}></i>
                  {cat}
                  <span
                    className="chip-count"
                    style={isActive ? { background: style.bg, color: style.color } : {}}
                  >
                    {categoryCounts[cat] || 0}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Contenido: Estado Vacío, Vista Agrupada o Tabla Plana */}
      {filteredProducts.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <i className="bi bi-box-seam"></i>
            </div>
            <div className="empty-state-title">
              {search || selectedMainType !== 'all' || selectedCategory !== 'all' || selectedColor !== 'all' || selectedStockStatus !== 'all' ? 'Sin resultados' : 'Inventario vacío'}
            </div>
            <div className="empty-state-text">
              {search || selectedMainType !== 'all' || selectedCategory !== 'all' || selectedColor !== 'all' || selectedStockStatus !== 'all'
                ? 'No se encontraron productos con los filtros aplicados'
                : 'Agrega productos manualmente o importa tu archivo Excel con un clic'
              }
            </div>
            {(search || selectedMainType !== 'all' || selectedCategory !== 'all' || selectedColor !== 'all' || selectedStockStatus !== 'all') && (
              <button
                type="button"
                className="btn btn-sm btn-outline-info mt-2"
                onClick={() => {
                  setSearch('');
                  setSelectedMainType('all');
                  setSelectedCategory('all');
                  setSelectedColor('all');
                  setSelectedStockStatus('all');
                }}
              >
                Limpiar todos los filtros
              </button>
            )}
            {!search && selectedCategory === 'all' && (
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginTop: '16px' }}>
                <button className="btn btn-primary" onClick={openAddModal} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <i className="bi bi-plus-lg"></i> Agregar producto
                </button>
                <button className="btn btn-secondary" onClick={() => setShowImportModal(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <i className="bi bi-file-earmark-arrow-up"></i> Importar desde Excel
                </button>
              </div>
            )}
          </div>
        </div>
      ) : viewMode === 'grouped' ? (
        /* ================= VISTA AGRUPADA POR SECCIONES ================= */
        <div>
          {Object.entries(groupedProducts).map(([cat, prods]) => {
            const isOpen = openSections.has(cat);
            const style = getCategoryStyle(cat);
            const totalUnits = prods.reduce((sum, p) => sum + (p.quantity || 0), 0);

            return (
              <div key={cat} className="category-section">
                <div className="category-section-header" onClick={() => toggleSection(cat)}>
                  <div className="category-section-left">
                    <div className="category-section-icon" style={{ background: style.bg, color: style.color }}>
                      <i className={`bi ${style.icon}`}></i>
                    </div>
                    <div className="category-section-info">
                      <div className="category-section-name">{cat}</div>
                      <div className="category-section-sub">
                        {prods.length} {prods.length === 1 ? 'producto' : 'productos'} • {totalUnits} {totalUnits === 1 ? 'unidad' : 'unidades'}
                      </div>
                    </div>
                  </div>
                  <i className={`bi bi-chevron-down category-section-chevron ${isOpen ? 'open' : ''}`}></i>
                </div>

                <div className={`category-section-body ${isOpen ? 'open' : ''}`}>
                  {/* Desktop Table View (>= 992px) */}
                  <div className="table-responsive d-none d-lg-block responsive-table-view">
                    <table className="table table-dark table-hover align-middle mb-0" style={{ minWidth: '650px' }}>
                      <thead>
                        <tr>
                          <th>SKU</th>
                          <th>Nombre</th>
                          <th>Cantidad</th>
                          <th>Ajuste Rápido</th>
                          <th>Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {prods.map((product) => (
                          <tr key={product.id}>
                            <td>
                              <code style={{
                                background: 'rgba(0, 212, 255, 0.1)',
                                padding: '2px 8px',
                                borderRadius: '4px',
                                color: 'var(--accent-primary)',
                                fontSize: 'var(--font-size-sm)',
                              }}>
                                {product.sku}
                              </code>
                            </td>
                            <td>
                              <span>{product.name}</span>
                              {(() => {
                                const col = detectProductColor(product);
                                if (col === 'clear') {
                                  return <span className="badge ms-2" style={{ background: 'rgba(0, 212, 255, 0.15)', color: '#00d4ff', fontSize: '11px', border: '1px solid rgba(0, 212, 255, 0.3)' }}><i className="bi bi-droplet-half me-1"></i>Clear</span>;
                                }
                                if (col === 'opal') {
                                  return <span className="badge ms-2" style={{ background: 'rgba(255, 255, 255, 0.15)', color: '#f8fafc', fontSize: '11px', border: '1px solid rgba(255, 255, 255, 0.3)' }}><i className="bi bi-circle-fill me-1" style={{ fontSize: '8px' }}></i>Opal</span>;
                                }
                                if (col === 'bronce') {
                                  return <span className="badge ms-2" style={{ background: 'rgba(217, 119, 6, 0.2)', color: '#fbbf24', fontSize: '11px', border: '1px solid rgba(217, 119, 6, 0.4)' }}><i className="bi bi-sun-fill me-1"></i>Bronce</span>;
                                }
                                return null;
                              })()}
                            </td>
                            <td>
                              {(() => {
                                const qty = Number(product.quantity) || 0;
                                const isIgnored = isProductIgnoredFromStock(product);
                                const isLow = !isIgnored && isLowStock(product);
                                const threshold = isIgnored ? null : getLowStockThreshold(product.category, product);
                                return (
                                  <span style={{
                                    fontWeight: 700,
                                    fontSize: 'var(--font-size-md)',
                                    color: qty < 0 ? 'var(--danger)' : qty === 0 ? (isIgnored ? 'var(--text-secondary)' : 'var(--warning)') : isLow ? 'var(--warning)' : 'var(--text-primary)',
                                  }}>
                                    {product.quantity}
                                    {qty < 0 ? (
                                      <span style={{
                                        display: 'inline-block',
                                        marginLeft: '8px',
                                        padding: '2px 8px',
                                        borderRadius: '4px',
                                        background: 'var(--danger-bg)',
                                        color: 'var(--danger)',
                                        fontSize: '11px',
                                        fontWeight: 600,
                                      }}>
                                        Faltante
                                      </span>
                                    ) : isLow ? (
                                      <span style={{
                                        display: 'inline-block',
                                        marginLeft: '8px',
                                        padding: '2px 8px',
                                        borderRadius: '4px',
                                        background: 'var(--warning-bg)',
                                        color: 'var(--warning)',
                                        fontSize: '11px',
                                        fontWeight: 600,
                                      }}>
                                        Bajo (&lt;{threshold})
                                      </span>
                                    ) : isIgnored ? (
                                      <span style={{
                                        display: 'inline-block',
                                        marginLeft: '8px',
                                        padding: '2px 8px',
                                        borderRadius: '4px',
                                        background: 'rgba(255,255,255,0.06)',
                                        color: 'var(--text-secondary)',
                                        fontSize: '11px',
                                        fontWeight: 500,
                                      }} title="Ignorado de alertas de stock">
                                        Sin alerta
                                      </span>
                                    ) : null}
                                  </span>
                                );
                              })()}
                            </td>
                            <td>
                              <div className="quantity-control">
                                <button
                                  className="quantity-btn minus"
                                  onClick={() => handleQuantityChange(product, -1)}
                                  disabled={!canEdit || updatingProductIds.has(product.id)}
                                  title={!canEdit ? 'Solo Franco y M.silva pueden editar' : 'Restar 1'}
                                >
                                  −
                                </button>
                                <div className="quantity-display font-monospace">
                                  {product.quantity}
                                </div>
                                <button
                                  className="quantity-btn plus"
                                  onClick={() => handleQuantityChange(product, 1)}
                                  disabled={!canEdit || updatingProductIds.has(product.id)}
                                  title={!canEdit ? 'Solo Franco y M.silva pueden editar' : 'Sumar 1'}
                                >
                                  +
                                </button>
                              </div>
                            </td>
                            <td>
                              {canEdit ? (
                                <div style={{ display: 'flex', gap: '8px' }}>
                                  <button
                                    className="btn btn-secondary btn-sm d-inline-flex align-items-center gap-1"
                                    onClick={() => openEditModal(product)}
                                  >
                                    <i className="bi bi-pencil-square"></i> Editar
                                  </button>
                                  <button
                                    className="btn btn-danger btn-sm d-inline-flex align-items-center justify-content-center"
                                    onClick={() => handleDelete(product)}
                                    title="Eliminar producto"
                                  >
                                    <i className="bi bi-trash3"></i>
                                  </button>
                                </div>
                              ) : (
                                <span className="badge bg-secondary opacity-75 small">Solo lectura</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile & Tablet Cards View (< 992px) */}
                  <div className="d-block d-lg-none responsive-cards-view p-2">
                    <div className="row g-2">
                      {prods.map((product) => (
                        <div key={product.id} className="col-12 col-md-6">
                          {renderProductMobileCard(product, false)}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* ================= VISTA TABLA PLANA ================= */
        <div>
          {/* Desktop Table View (>= 992px) */}
          <div className="table-responsive d-none d-lg-block responsive-table-view">
            <table className="table table-dark table-hover align-middle mb-0" style={{ minWidth: '720px' }}>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Nombre</th>
                  <th>Categoría</th>
                  <th>Cantidad</th>
                  <th>Ajuste Rápido</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((product) => {
                  const style = getCategoryStyle(product.category);
                  return (
                    <tr key={product.id}>
                      <td>
                        <code style={{
                          background: 'rgba(0, 212, 255, 0.1)',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          color: 'var(--accent-primary)',
                          fontSize: 'var(--font-size-sm)',
                        }}>
                          {product.sku}
                        </code>
                      </td>
                      <td>
                        <span>{product.name}</span>
                        {(() => {
                          const col = detectProductColor(product);
                          if (col === 'clear') {
                            return <span className="badge ms-2" style={{ background: 'rgba(0, 212, 255, 0.15)', color: '#00d4ff', fontSize: '11px', border: '1px solid rgba(0, 212, 255, 0.3)' }}><i className="bi bi-droplet-half me-1"></i>Clear</span>;
                          }
                          if (col === 'opal') {
                            return <span className="badge ms-2" style={{ background: 'rgba(255, 255, 255, 0.15)', color: '#f8fafc', fontSize: '11px', border: '1px solid rgba(255, 255, 255, 0.3)' }}><i className="bi bi-circle-fill me-1" style={{ fontSize: '8px' }}></i>Opal</span>;
                          }
                          if (col === 'bronce') {
                            return <span className="badge ms-2" style={{ background: 'rgba(217, 119, 6, 0.2)', color: '#fbbf24', fontSize: '11px', border: '1px solid rgba(217, 119, 6, 0.4)' }}><i className="bi bi-sun-fill me-1"></i>Bronce</span>;
                          }
                          return null;
                        })()}
                      </td>
                      <td>
                        <span
                          className="category-badge"
                          style={{
                            background: style.bg,
                            color: style.color,
                            border: `1px solid ${style.color}33`,
                          }}
                        >
                          <i className={`bi ${style.icon}`} style={{ fontSize: '10px' }}></i>
                          {(product.category || 'SIN CATEGORÍA').toUpperCase()}
                        </span>
                      </td>
                      <td>
                        {(() => {
                          const qty = Number(product.quantity) || 0;
                          const isIgnored = isProductIgnoredFromStock(product);
                          const isLow = !isIgnored && isLowStock(product);
                          const threshold = isIgnored ? null : getLowStockThreshold(product.category, product);
                          return (
                            <span style={{
                              fontWeight: 700,
                              fontSize: 'var(--font-size-md)',
                              color: qty < 0 ? 'var(--danger)' : qty === 0 ? (isIgnored ? 'var(--text-secondary)' : 'var(--warning)') : isLow ? 'var(--warning)' : 'var(--text-primary)',
                            }}>
                              {product.quantity}
                              {qty < 0 ? (
                                <span style={{
                                  display: 'inline-block',
                                  marginLeft: '8px',
                                  padding: '2px 8px',
                                  borderRadius: '4px',
                                  background: 'var(--danger-bg)',
                                  color: 'var(--danger)',
                                  fontSize: '11px',
                                  fontWeight: 600,
                                }}>
                                  Faltante
                                </span>
                              ) : isLow ? (
                                <span style={{
                                  display: 'inline-block',
                                  marginLeft: '8px',
                                  padding: '2px 8px',
                                  borderRadius: '4px',
                                  background: 'var(--warning-bg)',
                                  color: 'var(--warning)',
                                  fontSize: '11px',
                                  fontWeight: 600,
                                }}>
                                  Bajo (&lt;{threshold})
                                </span>
                              ) : isIgnored ? (
                                <span style={{
                                  display: 'inline-block',
                                  marginLeft: '8px',
                                  padding: '2px 8px',
                                  borderRadius: '4px',
                                  background: 'rgba(255,255,255,0.06)',
                                  color: 'var(--text-secondary)',
                                  fontSize: '11px',
                                  fontWeight: 500,
                                }} title="Ignorado de alertas de stock">
                                  Sin alerta
                                </span>
                              ) : null}
                            </span>
                          );
                        })()}
                      </td>
                      <td>
                        <div className="quantity-control">
                          <button
                            className="quantity-btn minus"
                            onClick={() => handleQuantityChange(product, -1)}
                            disabled={!canEdit || updatingProductIds.has(product.id)}
                            title={!canEdit ? 'Solo Franco y M.silva pueden editar' : 'Restar 1'}
                          >
                            −
                          </button>
                          <div className="quantity-display font-monospace">
                            {product.quantity}
                          </div>
                          <button
                            className="quantity-btn plus"
                            onClick={() => handleQuantityChange(product, 1)}
                            disabled={!canEdit || updatingProductIds.has(product.id)}
                            title={!canEdit ? 'Solo Franco y M.silva pueden editar' : 'Sumar 1'}
                          >
                            +
                          </button>
                        </div>
                      </td>
                      <td>
                        {canEdit ? (
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                              className="btn btn-secondary btn-sm d-inline-flex align-items-center gap-1"
                              onClick={() => openEditModal(product)}
                            >
                              <i className="bi bi-pencil-square"></i> Editar
                            </button>
                            <button
                              className="btn btn-danger btn-sm d-inline-flex align-items-center justify-content-center"
                              onClick={() => handleDelete(product)}
                              title="Eliminar producto"
                            >
                              <i className="bi bi-trash3"></i>
                            </button>
                          </div>
                        ) : (
                          <span className="badge bg-secondary opacity-75 small">Solo lectura</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile & Tablet Cards View (< 992px) */}
          <div className="d-block d-lg-none responsive-cards-view py-2">
            <div className="row g-2">
              {filteredProducts.map((product) => (
                <div key={product.id} className="col-12 col-md-6 col-xl-4">
                  {renderProductMobileCard(product, true)}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Modal Agregar / Editar Manual */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="modal-header">
              <h2 className="modal-title">
                {editProduct ? 'Editar Producto' : 'Nuevo Producto'}
              </h2>
              <button className="modal-close" onClick={() => setShowModal(false)}>
                <i className="bi bi-x-lg"></i>
              </button>
            </div>
            <form onSubmit={handleSave}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">SKU / Código</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Ej: SKU-001"
                    value={formData.sku}
                    onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Nombre del Producto</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Ej: PLANCHA ONDULADA TRANSPARENTE 2.0M"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Categoría / Sección</label>
                  <input
                    type="text"
                    list="categories-list"
                    className="form-input"
                    placeholder="Seleccionar o escribir categoría..."
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  />
                  <datalist id="categories-list">
                    {categories.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </div>
                {/* Gestión de Cantidad / Stock */}
                {editProduct ? (
                  <div className="mb-3 p-3 rounded" style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                    {/* Encabezado: Stock actual */}
                    <div className="d-flex justify-content-between align-items-center mb-3">
                      <div>
                        <span className="text-secondary small text-uppercase fw-bold d-block" style={{ fontSize: '11px', letterSpacing: '0.05em' }}>
                          Stock actual en bodega
                        </span>
                        <span className="fs-5 fw-bold text-light">
                          {currentBaseQty} {currentBaseQty === 1 ? 'unidad' : 'unidades'}
                        </span>
                      </div>
                      <span
                        className="badge px-3 py-2 fs-6 font-monospace"
                        style={{
                          background: currentBaseQty < 0 ? 'rgba(239, 68, 68, 0.2)' : currentBaseQty === 0 ? 'rgba(245, 158, 11, 0.2)' : 'rgba(0, 212, 255, 0.15)',
                          color: currentBaseQty < 0 ? '#ef4444' : currentBaseQty === 0 ? '#f59e0b' : '#00d4ff',
                          border: `1px solid ${currentBaseQty < 0 ? '#ef444455' : currentBaseQty === 0 ? '#f59e0b55' : '#00d4ff55'}`,
                        }}
                      >
                        {currentBaseQty} uds
                      </span>
                    </div>

                    {/* Selector de modo */}
                    <div className="btn-group w-100 mb-3" role="group">
                      <button
                        type="button"
                        className={`btn btn-sm ${stockEditMode === 'add' ? 'btn-primary fw-bold' : 'btn-outline-secondary text-light'}`}
                        onClick={() => setStockEditMode('add')}
                        style={{ minHeight: '38px' }}
                      >
                        <i className="bi bi-plus-slash-minus me-1"></i> Sumar / Ajustar
                      </button>
                      <button
                        type="button"
                        className={`btn btn-sm ${stockEditMode === 'set' ? 'btn-primary fw-bold' : 'btn-outline-secondary text-light'}`}
                        onClick={() => {
                          setStockEditMode('set');
                          if (!formData.quantity) setFormData(prev => ({ ...prev, quantity: String(currentBaseQty) }));
                        }}
                        style={{ minHeight: '38px' }}
                      >
                        <i className="bi bi-pencil me-1"></i> Total Manual
                      </button>
                    </div>

                    {/* Contenido según el modo */}
                    {stockEditMode === 'add' ? (
                      <div>
                        <div className="d-flex justify-content-between align-items-center mb-1">
                          <label className="form-label mb-0" style={{ fontSize: '13px' }}>
                            ¿Cuánto deseas sumar? <small className="text-secondary">(o restar con -)</small>
                          </label>
                          {quantityToAdd && (
                            <button
                              type="button"
                              className="btn btn-link btn-sm text-secondary p-0 text-decoration-none d-inline-flex align-items-center gap-1"
                              onClick={() => setQuantityToAdd('')}
                              style={{ fontSize: '12px' }}
                            >
                              <i className="bi bi-x-circle"></i> Limpiar
                            </button>
                          )}
                        </div>

                        {/* Input de cantidad a sumar */}
                        <div className="input-group mb-2">
                          <span className="input-group-text bg-dark border-secondary text-info fw-bold fs-5 px-3">
                            +
                          </span>
                          <input
                            type="text"
                            className="form-control bg-dark border-secondary text-light fs-5 fw-bold"
                            placeholder="0 (ej: 6 para sumar seis)"
                            value={quantityToAdd}
                            onChange={(e) => setQuantityToAdd(e.target.value)}
                            autoFocus
                            style={{ minHeight: '44px' }}
                          />
                        </div>

                        {/* Botones de suma rápida */}
                        <div className="mb-3">
                          <div className="text-secondary mb-1" style={{ fontSize: '11px' }}>
                            Sumar rápido con un toque:
                          </div>
                          <div className="d-flex flex-wrap gap-1">
                            {[1, 2, 5, 10, 20, 50, 100].map((inc) => (
                              <button
                                key={inc}
                                type="button"
                                className="btn btn-sm btn-outline-info flex-fill"
                                onClick={() => {
                                  const current = evaluateMathInput(quantityToAdd);
                                  setQuantityToAdd(String(current + inc));
                                }}
                                style={{ minHeight: '34px', fontSize: '12px', padding: '4px 8px' }}
                              >
                                +{inc}
                              </button>
                            ))}
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-warning"
                              onClick={() => {
                                const current = evaluateMathInput(quantityToAdd);
                                setQuantityToAdd(String(current - 1));
                              }}
                              style={{ minHeight: '34px', fontSize: '12px', padding: '4px 8px' }}
                              title="Restar 1"
                            >
                              -1
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-warning"
                              onClick={() => {
                                const current = evaluateMathInput(quantityToAdd);
                                setQuantityToAdd(String(current - 5));
                              }}
                              style={{ minHeight: '34px', fontSize: '12px', padding: '4px 8px' }}
                              title="Restar 5"
                            >
                              -5
                            </button>
                          </div>
                        </div>

                        {/* Tarjeta de Cálculo en Vivo (Resultado Final) */}
                        <div
                          className="p-3 rounded d-flex align-items-center justify-content-between"
                          style={{
                            background: 'rgba(0, 212, 255, 0.08)',
                            border: '1px solid rgba(0, 212, 255, 0.25)',
                          }}
                        >
                          <div>
                            <div className="text-secondary small" style={{ fontSize: '11px' }}>
                              Cálculo: {currentBaseQty} {parsedAddQty >= 0 ? `+ ${parsedAddQty}` : `- ${Math.abs(parsedAddQty)}`}
                            </div>
                            <div className="fw-semibold text-light" style={{ fontSize: '13px' }}>
                              Resultado final en stock:
                            </div>
                          </div>
                          <div className="text-end">
                            <span className="fs-4 fw-bold text-info">
                              {calculatedQtyFromAdd} uds
                            </span>
                            {parsedAddQty !== 0 && (
                              <small className={`d-block fw-bold ${parsedAddQty > 0 ? 'text-success' : 'text-danger'}`} style={{ fontSize: '11px' }}>
                                {parsedAddQty > 0 ? `(+${parsedAddQty} agregadas)` : `(${parsedAddQty} descontadas)`}
                              </small>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <label className="form-label" style={{ fontSize: '13px' }}>
                          Stock Total Directo <small className="text-secondary">(puedes escribir números o sumas ej: 4+6)</small>
                        </label>
                        <input
                          type="text"
                          className="form-control bg-dark border-secondary text-light fs-5"
                          placeholder="Ej: 10 o 4+6"
                          value={formData.quantity}
                          onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                          required
                          style={{ minHeight: '44px' }}
                        />
                        {formData.quantity && (formData.quantity.includes('+') || formData.quantity.includes('-')) && (
                          <div className="text-info small mt-1">
                            = <strong>{calculatedQtyFromSet} unidades</strong>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Campo Opcional: N° Nota de Pedido cuando se edita o descuenta */}
                    <div className="mt-3 p-2 rounded" style={{ background: 'rgba(255, 193, 7, 0.08)', border: '1px solid rgba(255, 193, 7, 0.25)' }}>
                      <label className="form-label text-warning small fw-bold mb-1 d-flex align-items-center gap-1" style={{ fontSize: '12px' }}>
                        <i className="bi bi-receipt"></i> N° Nota de Pedido / Documento (Opcional):
                      </label>
                      <input
                        type="text"
                        className="form-control form-control-sm bg-dark border-secondary text-light"
                        placeholder="Ej: NP-10452 o Factura 451"
                        value={modalNotaPedido}
                        onChange={(e) => setModalNotaPedido(e.target.value)}
                        style={{ minHeight: '36px' }}
                      />
                      <div className="text-secondary small mt-1" style={{ fontSize: '11px' }}>
                        Si ingresas un N° de Nota de Pedido, quedará registrado formalmente en el historial de movimientos de auditoría.
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="form-group mb-3">
                    <label className="form-label">Cantidad Inicial (permite números negativos para faltantes/déficit)</label>
                    <input
                      type="number"
                      className="form-input"
                      placeholder="0 (ej: -3 si hay faltante)"
                      value={formData.quantity}
                      onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                      required
                      style={{ minHeight: '44px' }}
                    />
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)} style={{ minHeight: '42px' }}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary fw-bold" style={{ minHeight: '42px' }}>
                  {editProduct ? (
                    stockEditMode === 'add'
                      ? (parsedAddQty !== 0 ? `Guardar (${currentBaseQty} → ${calculatedQtyFromAdd} uds)` : 'Guardar Cambios')
                      : `Guardar (${calculatedQtyFromSet} uds)`
                  ) : (
                    'Agregar'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Importar Excel */}
      {showImportModal && (
        <div className="modal-overlay" onClick={() => !importing && setShowImportModal(false)}>
          <div className="modal modal-lg" onClick={(e) => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="modal-header">
              <div>
                <h2 className="modal-title d-flex align-items-center gap-2">
                  <i className="bi bi-file-earmark-arrow-up text-primary"></i>
                  <span>Importar Inventario desde Excel</span>
                </h2>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  Carga masiva de productos mediante archivo .xlsx, .xls o .csv con detección de categorías
                </p>
              </div>
              <button
                className="modal-close"
                onClick={() => !importing && setShowImportModal(false)}
                disabled={importing}
              >
                <i className="bi bi-x-lg"></i>
              </button>
            </div>

            <div className="modal-body">
              {importError && (
                <div style={{
                  background: 'var(--danger-bg)',
                  border: '1px solid var(--danger)',
                  color: 'var(--danger)',
                  padding: '12px',
                  borderRadius: 'var(--radius-md)',
                  fontSize: '13px',
                  marginBottom: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}>
                  <i className="bi bi-exclamation-octagon-fill"></i>
                  <span>{importError}</span>
                </div>
              )}

              {importSuccess && (
                <div style={{
                  background: 'var(--success-bg)',
                  border: '1px solid var(--success)',
                  color: 'var(--success)',
                  padding: '12px',
                  borderRadius: 'var(--radius-md)',
                  fontSize: '13px',
                  marginBottom: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}>
                  <i className="bi bi-check-circle-fill"></i>
                  <span>{importSuccess}</span>
                </div>
              )}

              {/* Dropzone */}
              {!importRawData.length ? (
                <div
                  className="upload-dropzone"
                  onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }}
                  onDragLeave={(e) => e.currentTarget.classList.remove('drag-over')}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    border: '2px dashed var(--border-color-hover)',
                    borderRadius: 'var(--radius-lg)',
                    padding: '40px 20px',
                    textAlign: 'center',
                    cursor: 'pointer',
                    background: 'var(--bg-glass)',
                    transition: 'all var(--transition-fast)',
                  }}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx, .xls, .csv"
                    style={{ display: 'none' }}
                    onChange={(e) => handleFileChange(e.target.files[0])}
                  />
                  <div style={{ fontSize: '2.5rem', marginBottom: '12px', color: 'var(--accent-primary)' }}>
                    <i className="bi bi-file-earmark-spreadsheet"></i>
                  </div>
                  <div style={{ fontWeight: 600, fontSize: '16px', marginBottom: '6px' }}>
                    Arrastra tu archivo Excel aquí o haz clic para seleccionarlo
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                    Compatible con archivos .xlsx, .xls y .csv (incluyendo formatos ERP)
                  </div>
                </div>
              ) : (
                <div>
                  {/* File Info */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 16px',
                    background: 'var(--bg-glass)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-md)',
                    marginBottom: '16px',
                  }}>
                    <div>
                      <span style={{ fontWeight: 600 }}>
                        <i className="bi bi-file-earmark-excel text-success me-1"></i>
                        {importFile?.name}
                      </span>
                      <span style={{ color: 'var(--text-muted)', fontSize: '13px', marginLeft: '12px' }}>
                        ({importRawData.length} filas detectadas)
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setImportRawData([]);
                        setImportFile(null);
                        setImportCols(null);
                      }}
                      disabled={importing}
                    >
                      Cambiar archivo
                    </button>
                  </div>

                  {/* Column Mapping */}
                  <div style={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-md)',
                    padding: '16px',
                    marginBottom: '16px',
                  }}>
                    <div style={{ fontWeight: 600, marginBottom: '12px', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <i className="bi bi-gear-fill text-secondary"></i>
                      <span>Asignación de Columnas del Excel:</span>
                    </div>
                    <div className="row g-2">
                      <div className="col-12 col-sm-6 col-lg-3">
                        <label className="form-label" style={{ fontSize: '12px' }}>Columna SKU / Código *</label>
                        <select
                          className="form-input"
                          value={importCols?.sku || ''}
                          onChange={(e) => setImportCols({ ...importCols, sku: e.target.value })}
                        >
                          <option value="">Seleccionar columna...</option>
                          {importCols?.allHeaders.map((h) => (
                            <option key={h} value={h}>{h}</option>
                          ))}
                        </select>
                      </div>

                      <div className="col-12 col-sm-6 col-lg-3">
                        <label className="form-label" style={{ fontSize: '12px' }}>Columna Nombre / Descripción</label>
                        <select
                          className="form-input"
                          value={importCols?.name || ''}
                          onChange={(e) => setImportCols({ ...importCols, name: e.target.value })}
                        >
                          <option value="">(Opcional) Usar SKU como nombre</option>
                          {importCols?.allHeaders.map((h) => (
                            <option key={h} value={h}>{h}</option>
                          ))}
                        </select>
                      </div>

                      <div className="col-12 col-sm-6 col-lg-3">
                        <label className="form-label" style={{ fontSize: '12px' }}>Columna Categoría / Grupo</label>
                        <select
                          className="form-input"
                          value={importCols?.category || ''}
                          onChange={(e) => setImportCols({ ...importCols, category: e.target.value })}
                        >
                          <option value="">(Opcional) Sin categoría</option>
                          {importCols?.allHeaders.map((h) => (
                            <option key={h} value={h}>{h}</option>
                          ))}
                        </select>
                      </div>

                      <div className="col-12 col-sm-6 col-lg-3">
                        <label className="form-label" style={{ fontSize: '12px' }}>Columna Cantidad / Stock *</label>
                        <select
                          className="form-input"
                          value={importCols?.quantity || ''}
                          onChange={(e) => setImportCols({ ...importCols, quantity: e.target.value })}
                        >
                          <option value="">Seleccionar columna...</option>
                          {importCols?.allHeaders.map((h) => (
                            <option key={h} value={h}>{h}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Consolidation Info Banner */}
                  {(() => {
                    const preview = getConsolidatedPreview();
                    if (preview && preview.duplicatesFound > 0) {
                      return (
                        <div style={{
                          background: 'rgba(124, 58, 237, 0.08)',
                          border: '1px solid rgba(124, 58, 237, 0.3)',
                          borderRadius: 'var(--radius-md)',
                          padding: '12px 16px',
                          marginBottom: '16px',
                          fontSize: '13px',
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                            <i className="bi bi-arrow-repeat text-warning fs-5"></i>
                            <strong style={{ color: '#a78bfa' }}>
                              {preview.duplicatesFound} SKU(s) duplicados detectados — se consolidarán automáticamente
                            </strong>
                          </div>
                          <div style={{ color: 'var(--text-secondary)', marginBottom: '6px' }}>
                            {preview.originalRows} filas del Excel → {preview.consolidatedRows} productos únicos (cantidades sumadas)
                          </div>
                          {preview.duplicateDetails.length > 0 && (
                            <details style={{ marginTop: '6px' }}>
                              <summary style={{ cursor: 'pointer', color: '#a78bfa', fontWeight: 500 }}>
                                Ver detalle de duplicados
                              </summary>
                              <div style={{ marginTop: '8px', maxHeight: '120px', overflowY: 'auto' }}>
                                {preview.duplicateDetails.map((d, idx) => (
                                  <div key={idx} style={{
                                    padding: '4px 0',
                                    borderBottom: '1px solid var(--border-color)',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    fontSize: '12px',
                                  }}>
                                    <span><code>{d.sku}</code> — {d.name}</span>
                                    <span style={{ color: 'var(--success)', fontWeight: 600 }}>+{d.addedQty} → Total: {d.totalQty}</span>
                                  </div>
                                ))}
                              </div>
                            </details>
                          )}
                        </div>
                      );
                    }
                    return null;
                  })()}

                  {/* Import Mode Options */}
                  <div style={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-md)',
                    padding: '16px',
                    marginBottom: '16px',
                  }}>
                    <div style={{ fontWeight: 600, marginBottom: '10px', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <i className="bi bi-card-checklist text-info"></i>
                      <span>Modo de Importación:</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', fontSize: '13px' }}>
                        <input
                          type="radio"
                          name="importMode"
                          value="upsert"
                          checked={importMode === 'upsert'}
                          onChange={(e) => setImportMode(e.target.value)}
                          style={{ marginTop: '3px' }}
                        />
                        <span>
                          <strong>Actualizar y agregar nuevos (Recomendado)</strong>: Si el SKU ya existe, actualiza su stock y categoría; si no existe, lo crea.
                        </span>
                      </label>

                      <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', fontSize: '13px' }}>
                        <input
                          type="radio"
                          name="importMode"
                          value="add_stock"
                          checked={importMode === 'add_stock'}
                          onChange={(e) => setImportMode(e.target.value)}
                          style={{ marginTop: '3px' }}
                        />
                        <span>
                          <strong style={{ color: 'var(--success)' }}>
                            <i className="bi bi-plus-circle text-success me-1"></i>
                            Sumar cantidades al stock existente
                          </strong>: Si el SKU ya existe, <u>suma</u> la cantidad del Excel al stock actual (ej: tenés 3 + importás 5 = 8). Si no existe, lo crea.
                        </span>
                      </label>

                      <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', fontSize: '13px' }}>
                        <input
                          type="radio"
                          name="importMode"
                          value="only_new"
                          checked={importMode === 'only_new'}
                          onChange={(e) => setImportMode(e.target.value)}
                          style={{ marginTop: '3px' }}
                        />
                        <span>
                          <strong>Solo agregar nuevos</strong>: Solo crea productos nuevos; no modifica los que ya estén registrados.
                        </span>
                      </label>

                      <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', fontSize: '13px' }}>
                        <input
                          type="radio"
                          name="importMode"
                          value="replace"
                          checked={importMode === 'replace'}
                          onChange={(e) => setImportMode(e.target.value)}
                          style={{ marginTop: '3px' }}
                        />
                        <span style={{ color: 'var(--warning)' }}>
                          <strong>Reemplazar todo el inventario</strong>: Elimina los productos actuales e inserta los del Excel.
                        </span>
                      </label>
                    </div>
                  </div>

                  {/* Preview Table */}
                  <div style={{ marginBottom: '16px' }}>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                      Vista previa (primeras 5 filas):
                    </div>
                    <div className="table-responsive" style={{ maxHeight: '180px', overflowY: 'auto' }}>
                      <table className="table table-dark table-hover table-sm mb-0" style={{ fontSize: '12px', minWidth: '400px' }}>
                        <thead>
                          <tr>
                            <th>SKU</th>
                            <th>Nombre</th>
                            <th>Categoría</th>
                            <th>Cantidad</th>
                          </tr>
                        </thead>
                        <tbody>
                          {importRawData.slice(0, 5).map((row, idx) => {
                            const catName = (row[importCols?.category] || 'SIN CATEGORÍA').toUpperCase();
                            const catStyle = getCategoryStyle(catName);
                            return (
                              <tr key={idx}>
                                <td><code>{String(row[importCols?.sku] || '—')}</code></td>
                                <td>{String(row[importCols?.name] || row[importCols?.sku] || '—')}</td>
                                <td>
                                  <span
                                    className="category-badge"
                                    style={{
                                      background: catStyle.bg,
                                      color: catStyle.color,
                                    }}
                                  >
                                    <i className={`bi ${catStyle.icon}`} style={{ fontSize: '10px' }}></i>
                                    {catName}
                                  </span>
                                </td>
                                <td><strong>{row[importCols?.quantity] ?? 0}</strong></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {importProgress && (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '12px',
                      background: 'rgba(0, 212, 255, 0.08)',
                      border: '1px solid var(--border-accent)',
                      borderRadius: 'var(--radius-md)',
                      fontSize: '13px',
                      color: 'var(--accent-primary)',
                      marginBottom: '16px',
                    }}>
                      <div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
                      <span>{importProgress}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowImportModal(false)}
                disabled={importing}
              >
                Cancelar
              </button>
              {importRawData.length > 0 && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleExecuteImport}
                  disabled={importing || !importCols?.sku || !importCols?.quantity}
                >
                  {importing ? 'Importando...' : `Confirmar e Importar (${importRawData.length} productos)`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal Descontar por Nota de Pedido */}
      {showNotaPedidoModal && (
        <div className="modal-overlay" onClick={() => !npSubmitting && setShowNotaPedidoModal(false)}>
          <div
            className="modal modal-lg"
            onClick={(e) => e.stopPropagation()}
            style={{ display: 'flex', flexDirection: 'column', maxWidth: '850px', width: '100%' }}
          >
            <div className="modal-header">
              <div>
                <h2 className="modal-title d-flex align-items-center gap-2">
                  <i className="bi bi-receipt-cutoff text-info"></i>
                  <span>Descontar por Nota de Pedido</span>
                </h2>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px', marginBottom: 0 }}>
                  Descuenta materiales del inventario asociándolos formalmente a una Nota de Pedido para control y auditoría.
                </p>
              </div>
              <button
                className="modal-close"
                onClick={() => !npSubmitting && setShowNotaPedidoModal(false)}
                disabled={npSubmitting}
                aria-label="Cerrar modal"
              >
                <i className="bi bi-x-lg"></i>
              </button>
            </div>

            <div className="modal-body" style={{ maxHeight: 'calc(85vh - 140px)', overflowY: 'auto' }}>
              {npError && (
                <div
                  className="alert alert-danger d-flex align-items-center gap-2 mb-3"
                  style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger)', color: 'var(--danger)', fontSize: '13px' }}
                >
                  <i className="bi bi-exclamation-triangle-fill"></i>
                  <div>{npError}</div>
                </div>
              )}

              {npSuccess && (
                <div
                  className="alert alert-success d-flex align-items-center gap-2 mb-3"
                  style={{ background: 'var(--success-bg)', border: '1px solid var(--success)', color: 'var(--success)', fontSize: '13px' }}
                >
                  <i className="bi bi-check-circle-fill"></i>
                  <div>{npSuccess}</div>
                </div>
              )}

              {/* Datos de la Nota de Pedido */}
              <div className="card mb-3 p-3 border-secondary" style={{ background: 'rgba(255, 255, 255, 0.03)' }}>
                <div className="row g-3">
                  <div className="col-12 col-md-6">
                    <label className="form-label small fw-bold text-light mb-1">
                      N° Nota de Pedido / Documento <span className="text-danger">*</span>
                    </label>
                    <div className="input-group">
                      <span className="input-group-text bg-dark border-secondary text-info fw-bold">#</span>
                      <input
                        type="text"
                        className="form-control bg-dark border-secondary text-light fw-bold"
                        placeholder="Ej: NP-10452 o 10452"
                        value={npNumber}
                        onChange={(e) => setNpNumber(e.target.value)}
                        autoFocus
                        style={{ minHeight: '40px' }}
                      />
                    </div>
                  </div>
                  <div className="col-12 col-md-6">
                    <label className="form-label small fw-bold text-light mb-1">
                      Cliente / Obra / Destino <small className="text-secondary">(Opcional)</small>
                    </label>
                    <input
                      type="text"
                      className="form-control bg-dark border-secondary text-light"
                      placeholder="Ej: Constructora San Juan o Sucursal Norte"
                      value={npCliente}
                      onChange={(e) => setNpCliente(e.target.value)}
                      style={{ minHeight: '40px' }}
                    />
                  </div>
                </div>
              </div>

              {/* Selector de Método de Carga */}
              <div className="d-flex align-items-center justify-content-between mb-3 flex-wrap gap-2">
                <div className="btn-group btn-group-sm" role="group">
                  <button
                    type="button"
                    className={`btn ${npInputMode === 'list' ? 'btn-info text-dark fw-bold' : 'btn-outline-secondary text-light'}`}
                    onClick={() => setNpInputMode('list')}
                    style={{ minHeight: '34px' }}
                  >
                    <i className="bi bi-search me-1"></i> Buscar en Catálogo
                  </button>
                  <button
                    type="button"
                    className={`btn ${npInputMode === 'paste' ? 'btn-info text-dark fw-bold' : 'btn-outline-secondary text-light'}`}
                    onClick={() => setNpInputMode('paste')}
                    style={{ minHeight: '34px' }}
                  >
                    <i className="bi bi-clipboard-plus me-1"></i> Pegar Lista de SKUs
                  </button>
                </div>

                <span className="badge bg-secondary" style={{ fontSize: '12px' }}>
                  {npItems.length} {npItems.length === 1 ? 'producto en la lista' : 'productos en la lista'}
                </span>
              </div>

              {/* Método 1: Buscador de Productos */}
              {npInputMode === 'list' && (
                <div className="mb-3">
                  <div className="position-relative">
                    <div className="input-group">
                      <span className="input-group-text bg-dark border-secondary text-secondary">
                        <i className="bi bi-search"></i>
                      </span>
                      <input
                        type="text"
                        className="form-control bg-dark border-secondary text-light"
                        placeholder="Escribe el SKU o nombre del producto para agregarlo..."
                        value={npSearch}
                        onChange={(e) => setNpSearch(e.target.value)}
                        style={{ minHeight: '42px' }}
                      />
                      {npSearch && (
                        <button
                          type="button"
                          className="btn btn-outline-secondary text-light"
                          onClick={() => setNpSearch('')}
                        >
                          <i className="bi bi-x-lg"></i>
                        </button>
                      )}
                    </div>

                    {/* Resultados de búsqueda flotantes */}
                    {npSearch.trim() && (
                      <div
                        className="position-absolute w-100 mt-1 shadow-lg rounded border border-secondary"
                        style={{
                          background: '#1a1f2e',
                          zIndex: 1050,
                          maxHeight: '260px',
                          overflowY: 'auto',
                        }}
                      >
                        {(() => {
                          const matches = products.filter((p) => {
                            const term = npSearch.toLowerCase();
                            return (
                              (p.sku || '').toLowerCase().includes(term) ||
                              (p.name || '').toLowerCase().includes(term) ||
                              (p.category || '').toLowerCase().includes(term)
                            );
                          }).slice(0, 10);

                          if (matches.length === 0) {
                            return (
                              <div className="p-3 text-secondary text-center small">
                                No se encontraron productos coincidentes con &quot;{npSearch}&quot;
                              </div>
                            );
                          }

                          return matches.map((p) => {
                            const alreadyAdded = npItems.some((it) => it.id === p.id);
                            const style = getCategoryStyle(p.category);
                            return (
                              <div
                                key={p.id}
                                className="p-2 border-bottom border-secondary d-flex align-items-center justify-content-between gap-2 hover-bg"
                                style={{ background: alreadyAdded ? 'rgba(0, 212, 255, 0.05)' : 'transparent' }}
                              >
                                <div className="text-truncate" style={{ flex: 1 }}>
                                  <div className="d-flex align-items-center gap-2 mb-1">
                                    <code className="text-info fw-bold" style={{ fontSize: '13px' }}>{p.sku}</code>
                                    <span
                                      className="badge"
                                      style={{ background: style.bg, color: style.color, fontSize: '10px' }}
                                    >
                                      {p.category || 'SIN CATEGORÍA'}
                                    </span>
                                  </div>
                                  <div className="small text-light text-truncate">{p.name}</div>
                                  <div className="text-secondary" style={{ fontSize: '11px' }}>
                                    Stock disponible actual: <strong className="text-light">{p.quantity ?? 0} uds</strong>
                                  </div>
                                </div>
                                <div>
                                  {alreadyAdded ? (
                                    <span className="badge bg-secondary text-light px-2 py-1 d-inline-flex align-items-center gap-1" style={{ fontSize: '11px' }}>
                                      <i className="bi bi-check2"></i> En lista
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      className="btn btn-sm btn-info text-dark fw-bold px-3"
                                      onClick={() => handleAddProductToNp(p)}
                                      style={{ minHeight: '32px', fontSize: '12px' }}
                                    >
                                      <i className="bi bi-plus me-1"></i> Agregar
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          });
                        })()}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Método 2: Pegar texto con SKUs y Cantidades */}
              {npInputMode === 'paste' && (
                <div className="card mb-3 p-3 border-secondary" style={{ background: 'rgba(255, 255, 255, 0.02)' }}>
                  <label className="form-label small fw-bold text-light mb-1">
                    Pega aquí líneas copiadas (Formato: SKU y Cantidad separados por espacio o tabulador):
                  </label>
                  <textarea
                    className="form-control bg-dark border-secondary text-light font-monospace mb-2"
                    rows={4}
                    placeholder={`Ejemplo:\nSKU-001 5\nSKU-002 12\nSKU-003 3`}
                    value={npPasteText}
                    onChange={(e) => setNpPasteText(e.target.value)}
                    style={{ fontSize: '13px' }}
                  ></textarea>
                  <div className="d-flex justify-content-between align-items-center">
                    <small className="text-secondary" style={{ fontSize: '11px' }}>
                      Reconoce automáticamente los códigos SKU existentes en tu inventario.
                    </small>
                    <button
                      type="button"
                      className="btn btn-sm btn-info text-dark fw-bold"
                      onClick={handleParsePasteNp}
                      disabled={!npPasteText.trim()}
                      style={{ minHeight: '34px' }}
                    >
                      <i className="bi bi-box-arrow-in-down me-1"></i> Cargar a la Lista
                    </button>
                  </div>
                </div>
              )}

              {/* Lista / Tabla de Productos a Descontar */}
              <div className="card border-secondary" style={{ background: 'rgba(0, 0, 0, 0.2)' }}>
                <div className="card-header bg-dark border-secondary d-flex justify-content-between align-items-center py-2">
                  <span className="small fw-bold text-light text-uppercase">
                    <i className="bi bi-list-check text-info me-1"></i> Productos Seleccionados ({npItems.length})
                  </span>
                  {npItems.length > 0 && (
                    <button
                      type="button"
                      className="btn btn-link btn-sm text-danger text-decoration-none p-0"
                      onClick={() => setNpItems([])}
                      style={{ fontSize: '12px' }}
                    >
                      <i className="bi bi-trash me-1"></i> Vaciar lista
                    </button>
                  )}
                </div>

                <div className="card-body p-0">
                  {npItems.length === 0 ? (
                    <div className="p-4 text-center text-secondary">
                      <i className="bi bi-cart-x fs-1 d-block mb-2 opacity-50"></i>
                      <p className="mb-1 fw-semibold">No has agregado productos a esta Nota de Pedido</p>
                      <small className="d-block">Usa el buscador o pega la lista de SKUs arriba para agregarlos.</small>
                    </div>
                  ) : (
                    <div className="table-responsive">
                      <table className="table table-dark table-hover align-middle mb-0" style={{ fontSize: '13px', minWidth: '600px' }}>
                        <thead>
                          <tr className="border-secondary text-secondary" style={{ fontSize: '11px', textTransform: 'uppercase' }}>
                            <th style={{ width: '15%' }}>SKU</th>
                            <th style={{ width: '35%' }}>Producto</th>
                            <th className="text-center" style={{ width: '15%' }}>Stock Actual</th>
                            <th className="text-center" style={{ width: '20%' }}>A Descontar</th>
                            <th className="text-center" style={{ width: '15%' }}>Quedará</th>
                            <th style={{ width: '5%' }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {npItems.map((item, idx) => {
                            const curStock = Number(item.currentStock) || 0;
                            const discountVal = Number(item.quantityToDiscount) || 0;
                            const finalStock = Math.round((curStock - discountVal) * 100) / 100;
                            const isDeficit = finalStock < 0;

                            return (
                              <tr key={item.id} className="border-secondary">
                                <td>
                                  <code className="text-info fw-bold">{item.sku}</code>
                                </td>
                                <td>
                                  <div className="fw-semibold text-light text-truncate" style={{ maxWidth: '240px' }} title={item.name}>
                                    {item.name}
                                  </div>
                                </td>
                                <td className="text-center">
                                  <span className="badge bg-secondary text-light px-2 py-1">
                                    {curStock} uds
                                  </span>
                                </td>
                                <td className="text-center">
                                  <div className="d-flex align-items-center justify-content-center gap-1">
                                    <button
                                      type="button"
                                      className="btn btn-sm btn-outline-secondary text-light"
                                      onClick={() => {
                                        const next = Math.max(1, (Number(item.quantityToDiscount) || 1) - 1);
                                        handleUpdateNpItemQty(idx, next);
                                      }}
                                      style={{ width: '28px', height: '28px', padding: 0 }}
                                      title="Restar 1"
                                    >
                                      −
                                    </button>
                                    <input
                                      type="number"
                                      className="form-control form-control-sm bg-dark border-secondary text-light text-center fw-bold"
                                      style={{ width: '65px', minHeight: '30px' }}
                                      min="0.01"
                                      step="any"
                                      value={item.quantityToDiscount}
                                      onChange={(e) => handleUpdateNpItemQty(idx, e.target.value)}
                                    />
                                    <button
                                      type="button"
                                      className="btn btn-sm btn-outline-info text-info"
                                      onClick={() => {
                                        const next = (Number(item.quantityToDiscount) || 0) + 1;
                                        handleUpdateNpItemQty(idx, next);
                                      }}
                                      style={{ width: '28px', height: '28px', padding: 0 }}
                                      title="Sumar 1"
                                    >
                                      +
                                    </button>
                                  </div>
                                </td>
                                <td className="text-center">
                                  <span className={`fw-bold ${isDeficit ? 'text-danger' : 'text-success'}`}>
                                    {finalStock} uds
                                  </span>
                                  {isDeficit && (
                                    <small className="d-block text-danger" style={{ fontSize: '10px' }}>
                                      (Déficit)
                                    </small>
                                  )}
                                </td>
                                <td className="text-end">
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-outline-danger p-1"
                                    onClick={() => handleRemoveNpItem(idx)}
                                    title="Quitar producto de la lista"
                                    style={{ width: '30px', height: '30px' }}
                                  >
                                    <i className="bi bi-trash"></i>
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {npItems.length > 0 && (
                  <div className="card-footer bg-dark border-secondary p-3 d-flex justify-content-between align-items-center flex-wrap gap-2">
                    <div className="text-secondary small">
                      Total a Descontar: <strong className="text-info fs-6">{npItems.reduce((acc, it) => acc + (Number(it.quantityToDiscount) || 0), 0)} unidades</strong> en <strong className="text-light">{npItems.length} producto(s)</strong>
                    </div>
                    <div className="small text-secondary">
                      Referencia: <code>#{npNumber.trim() || 'Sin número'}</code>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowNotaPedidoModal(false)}
                disabled={npSubmitting}
                style={{ minHeight: '40px' }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary fw-bold d-flex align-items-center gap-2"
                onClick={handleApplyNotaPedido}
                disabled={npSubmitting || npItems.length === 0 || !npNumber.trim()}
                style={{ minHeight: '40px' }}
              >
                {npSubmitting ? (
                  <>
                    <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
                    <span>Procesando Descuento...</span>
                  </>
                ) : (
                  <>
                    <i className="bi bi-check2-circle"></i>
                    <span>Confirmar Descuento ({npItems.reduce((acc, it) => acc + (Number(it.quantityToDiscount) || 0), 0)} uds)</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
