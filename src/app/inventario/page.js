'use client';

import { useState, useEffect, useRef } from 'react';
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

export default function InventarioPage() {
  const { currentUser } = useAuth();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editProduct, setEditProduct] = useState(null);
  const [formData, setFormData] = useState({ sku: '', name: '', quantity: '', category: '' });

  // Estados para Categorías
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [viewMode, setViewMode] = useState('flat'); // 'flat' | 'grouped'
  const [openSections, setOpenSections] = useState(new Set());

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
    'GRECA': { bg: 'rgba(124, 58, 237, 0.12)', color: '#8b5cf6', icon: 'bi-layers' },
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

  const filteredProducts = products.filter((p) => {
    const s = search.toLowerCase();
    const cat = (p.category || 'SIN CATEGORÍA').toUpperCase();
    const matchesSearch =
      p.sku?.toLowerCase().includes(s) ||
      p.name?.toLowerCase().includes(s) ||
      cat.toLowerCase().includes(s);
    const matchesCategory =
      selectedCategory === 'all' || cat === selectedCategory;
    return matchesSearch && matchesCategory;
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
    const isNegative = (product.quantity || 0) < 0;
    const isZero = (product.quantity || 0) === 0;
    const isLow = (product.quantity || 0) > 0 && (product.quantity || 0) < 10;

    return (
      <div key={product.id} className="card bg-dark border-secondary text-light mb-2 shadow-sm" style={{ background: 'rgba(15, 15, 35, 0.95)' }}>
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
          <h6 className="card-title fw-bold text-light mb-3" style={{ fontSize: '15px', lineHeight: 1.35, wordBreak: 'break-word' }}>
            {product.name}
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
                  className="fw-bold fs-5"
                  style={{
                    color: isNegative ? 'var(--danger, #ef4444)' : isZero || isLow ? 'var(--warning, #f59e0b)' : 'var(--text-primary, #f0f0f5)',
                  }}
                >
                  {product.quantity} uds
                </span>
                {isNegative && (
                  <span className="badge bg-danger text-light px-2 py-1" style={{ fontSize: '10px' }}>
                    Faltante
                  </span>
                )}
              </div>
            </div>

            {/* Stepper Buttons (44x44px touch targets) */}
            <div className="btn-group" role="group" aria-label="Ajustar stock">
              <button
                type="button"
                className="btn btn-outline-secondary text-light fw-bold fs-5 px-3 py-2"
                onClick={() => handleQuantityChange(product, -1)}
                style={{ minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                aria-label="Restar 1"
              >
                −
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
                style={{ minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                aria-label="Sumar 1"
              >
                +
              </button>
            </div>
          </div>

          {/* Acciones: Editar y Eliminar */}
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
        </div>
      </div>
    );
  };

  const openAddModal = () => {
    setEditProduct(null);
    setFormData({ sku: '', name: '', quantity: '', category: '' });
    setShowModal(true);
  };

  const openEditModal = (product) => {
    setEditProduct(product);
    setFormData({
      sku: product.sku,
      name: product.name,
      quantity: String(product.quantity),
      category: product.category || '',
    });
    setShowModal(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    const cleanSku = formData.sku.trim().slice(0, 100);
    const cleanName = formData.name.trim().slice(0, 200);
    const cleanCategory = (formData.category || 'SIN CATEGORÍA').trim().toUpperCase();
    const qty = parseInt(formData.quantity) || 0;

    if (!cleanSku || !cleanName) return;

    try {
      if (editProduct) {
        // Editar
        const prevQty = editProduct.quantity;
        await updateDoc(doc(db, 'products', editProduct.id), {
          sku: cleanSku,
          name: cleanName,
          category: cleanCategory,
          quantity: qty,
          lastUpdated: serverTimestamp(),
          updatedBy: currentUser.uid,
        });

        const action = qty !== prevQty
          ? (qty > prevQty ? 'cantidad_agregada' : 'cantidad_descontada')
          : 'producto_editado';

        await logAction(action, currentUser, {
          sku: cleanSku,
          productName: cleanName,
          category: cleanCategory,
          previousValue: prevQty,
          newValue: qty,
          description: `Editó ${cleanSku} (${cleanName})`,
        });

        if (qty !== prevQty) {
          const diff = qty - prevQty;
          const msg = diff > 0
            ? `${currentUser.displayName || currentUser.email} agregó ${diff} uds a ${cleanSku} (${cleanName})`
            : `${currentUser.displayName || currentUser.email} descontó ${Math.abs(diff)} uds de ${cleanSku} (${cleanName})`;
          await sendNotification(diff > 0 ? 'agregado' : 'descuento', msg, currentUser);
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
          updatedBy: currentUser.uid,
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
          `${currentUser.displayName || currentUser.email} agregó nuevo producto ${cleanSku} (${cleanName})`,
          currentUser
        );
      }

      setShowModal(false);
    } catch (error) {
      console.error('Error guardando producto:', error);
    }
  };

  const handleDelete = async (product) => {
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
        `⚠️ ${currentUser.displayName || currentUser.email} eliminó ${product.sku} (${product.name})`,
        currentUser
      );
    } catch (error) {
      console.error('Error eliminando producto:', error);
    }
  };

  const handleQuantityChange = async (product, delta) => {
    const newQty = (product.quantity || 0) + delta;
    try {
      await updateDoc(doc(db, 'products', product.id), {
        quantity: newQty,
        lastUpdated: serverTimestamp(),
        updatedBy: currentUser.uid,
      });

      const action = delta > 0 ? 'cantidad_agregada' : 'cantidad_descontada';
      await logAction(action, currentUser, {
        sku: product.sku,
        productName: product.name,
        previousValue: product.quantity,
        newValue: newQty,
      });

      const msg = delta > 0
        ? `${currentUser.displayName || currentUser.email} agregó ${delta} uds a ${product.sku} (${product.name})`
        : `${currentUser.displayName || currentUser.email} descontó ${Math.abs(delta)} uds de ${product.sku} (${product.name})`;
      await sendNotification(delta > 0 ? 'agregado' : 'descuento', msg, currentUser);
    } catch (error) {
      console.error('Error actualizando cantidad:', error);
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
        `📥 ${currentUser.displayName || currentUser.email} importó ${normalized.length} productos desde Excel (${inserted} creados, ${updated} actualizados${sumMsg})`,
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
        <div className="col-12 col-md-5 col-lg-6">
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
              style={{ fontSize: '15px' }}
            />
            {search && (
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={() => setSearch('')}
                aria-label="Limpiar búsqueda"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* View Toggle */}
        <div className="col-12 col-md-auto">
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
              style={{ minHeight: '40px' }}
            >
              <i className="bi bi-collection me-1"></i> Secciones
            </button>
            <button
              type="button"
              className={`btn btn-sm ${viewMode === 'flat' ? 'btn-primary' : 'btn-outline-secondary text-light'}`}
              onClick={() => setViewMode('flat')}
              style={{ minHeight: '40px' }}
            >
              <i className="bi bi-list-ul me-1"></i> Lista
            </button>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="col-12 col-md d-flex justify-content-md-end gap-2 flex-wrap">
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary text-light flex-grow-1 flex-md-grow-0 d-flex align-items-center justify-content-center gap-1"
            onClick={() => setShowImportModal(true)}
            style={{ minHeight: '40px' }}
          >
            <i className="bi bi-file-earmark-arrow-up"></i>
            <span>Importar Excel</span>
          </button>
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary text-light flex-grow-1 flex-md-grow-0 d-flex align-items-center justify-content-center gap-1"
            onClick={handleExport}
            style={{ minHeight: '40px' }}
          >
            <i className="bi bi-file-earmark-excel"></i>
            <span>Exportar Excel</span>
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary w-100 w-md-auto order-first order-md-last d-flex align-items-center justify-content-center gap-1 fw-bold"
            onClick={openAddModal}
            style={{ minHeight: '44px' }}
          >
            <i className="bi bi-plus-lg"></i>
            <span>Agregar Producto</span>
          </button>
        </div>
      </div>

      {/* Selector / Chips de Categorías */}
      {categories.length > 0 && (
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
              {search || selectedCategory !== 'all' ? 'Sin resultados' : 'Inventario vacío'}
            </div>
            <div className="empty-state-text">
              {search || selectedCategory !== 'all'
                ? 'No se encontraron productos con los filtros aplicados'
                : 'Agrega productos manualmente o importa tu archivo Excel con un clic'
              }
            </div>
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
                  {/* Desktop Table View */}
                  <div className="table-responsive d-none d-md-block">
                    <table className="table table-dark table-hover align-middle mb-0">
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
                            <td>{product.name}</td>
                            <td>
                              <span style={{
                                fontWeight: 700,
                                fontSize: 'var(--font-size-md)',
                                color: product.quantity < 0 ? 'var(--danger)' : product.quantity === 0 ? 'var(--warning)' : product.quantity < 10 ? 'var(--warning)' : 'var(--text-primary)',
                              }}>
                                {product.quantity}
                                {product.quantity < 0 && (
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
                                )}
                              </span>
                            </td>
                            <td>
                              <div className="quantity-control">
                                <button
                                  className="quantity-btn minus"
                                  onClick={() => handleQuantityChange(product, -1)}
                                >
                                  −
                                </button>
                                <div className="quantity-display">
                                  {product.quantity}
                                </div>
                                <button
                                  className="quantity-btn plus"
                                  onClick={() => handleQuantityChange(product, 1)}
                                >
                                  +
                                </button>
                              </div>
                            </td>
                            <td>
                              <div style={{ display: 'flex', gap: '8px' }}>
                                <button
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => openEditModal(product)}
                                >
                                  ✏️ Editar
                                </button>
                                <button
                                  className="btn btn-danger btn-sm"
                                  onClick={() => handleDelete(product)}
                                >
                                  🗑️
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile Cards View (Bootstrap 5) */}
                  <div className="d-block d-md-none p-2">
                    {prods.map((product) => renderProductMobileCard(product, false))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* ================= VISTA TABLA PLANA ================= */
        <div>
          {/* Desktop Table View */}
          <div className="table-responsive d-none d-md-block">
            <table className="table table-dark table-hover align-middle mb-0">
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
                      <td>{product.name}</td>
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
                        <span style={{
                          fontWeight: 700,
                          fontSize: 'var(--font-size-md)',
                          color: product.quantity < 0 ? 'var(--danger)' : product.quantity === 0 ? 'var(--warning)' : product.quantity < 10 ? 'var(--warning)' : 'var(--text-primary)',
                        }}>
                          {product.quantity}
                          {product.quantity < 0 && (
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
                          )}
                        </span>
                      </td>
                      <td>
                        <div className="quantity-control">
                          <button
                            className="quantity-btn minus"
                            onClick={() => handleQuantityChange(product, -1)}
                          >
                            −
                          </button>
                          <div className="quantity-display">
                            {product.quantity}
                          </div>
                          <button
                            className="quantity-btn plus"
                            onClick={() => handleQuantityChange(product, 1)}
                          >
                            +
                          </button>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => openEditModal(product)}
                          >
                            ✏️ Editar
                          </button>
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => handleDelete(product)}
                          >
                            🗑️
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards View (Bootstrap 5) */}
          <div className="d-block d-md-none py-2">
            {filteredProducts.map((product) => renderProductMobileCard(product, true))}
          </div>
        </div>
      )}

      {/* Modal Agregar / Editar Manual */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">
                {editProduct ? 'Editar Producto' : 'Nuevo Producto'}
              </h2>
              <button className="modal-close" onClick={() => setShowModal(false)}>
                ✕
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
                <div className="form-group">
                  <label className="form-label">Cantidad (permite números negativos para faltantes/déficit)</label>
                  <input
                    type="number"
                    className="form-input"
                    placeholder="0 (ej: -3 si hay faltante)"
                    value={formData.quantity}
                    onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                    required
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary">
                  {editProduct ? 'Guardar Cambios' : 'Agregar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Importar Excel */}
      {showImportModal && (
        <div className="modal-overlay" onClick={() => !importing && setShowImportModal(false)}>
          <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 className="modal-title">📤 Importar Inventario desde Excel</h2>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  Carga masiva de productos mediante archivo .xlsx, .xls o .csv con detección de categorías
                </p>
              </div>
              <button
                className="modal-close"
                onClick={() => !importing && setShowImportModal(false)}
                disabled={importing}
              >
                ✕
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
                }}>
                  ⚠️ {importError}
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
                }}>
                  ✅ {importSuccess}
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
                  <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>📊</div>
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
                      <span style={{ fontWeight: 600 }}>📄 {importFile?.name}</span>
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
                    <div style={{ fontWeight: 600, marginBottom: '12px', fontSize: '14px' }}>
                      ⚙️ Asignación de Columnas del Excel:
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
                      <div>
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

                      <div>
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

                      <div>
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

                      <div>
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
                            <span style={{ fontSize: '1.2rem' }}>🔄</span>
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
                    <div style={{ fontWeight: 600, marginBottom: '10px', fontSize: '14px' }}>
                      📋 Modo de Importación:
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
                          <strong style={{ color: 'var(--success)' }}>➕ Sumar cantidades al stock existente</strong>: Si el SKU ya existe, <u>suma</u> la cantidad del Excel al stock actual (ej: tenés 3 + importás 5 = 8). Si no existe, lo crea.
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
                    <div className="table-container" style={{ maxHeight: '180px', overflowY: 'auto' }}>
                      <table className="table" style={{ fontSize: '12px' }}>
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
    </div>
  );
}
