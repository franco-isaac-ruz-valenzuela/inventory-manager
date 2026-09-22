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
} from '../../lib/excelUtils';

export default function InventarioPage() {
  const { currentUser } = useAuth();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editProduct, setEditProduct] = useState(null);
  const [formData, setFormData] = useState({ sku: '', name: '', quantity: '' });

  // Estados para Importar Excel
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importRawData, setImportRawData] = useState([]);
  const [importCols, setImportCols] = useState(null);
  const [importMode, setImportMode] = useState('upsert'); // upsert | only_new | replace
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const [importError, setImportError] = useState('');
  const [importSuccess, setImportSuccess] = useState('');
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

  const filteredProducts = products.filter((p) => {
    const s = search.toLowerCase();
    return (
      p.sku?.toLowerCase().includes(s) ||
      p.name?.toLowerCase().includes(s)
    );
  });

  const openAddModal = () => {
    setEditProduct(null);
    setFormData({ sku: '', name: '', quantity: '' });
    setShowModal(true);
  };

  const openEditModal = (product) => {
    setEditProduct(product);
    setFormData({
      sku: product.sku,
      name: product.name,
      quantity: String(product.quantity),
    });
    setShowModal(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    const cleanSku = formData.sku.trim().slice(0, 100);
    const cleanName = formData.name.trim().slice(0, 200);
    const qty = Math.max(0, parseInt(formData.quantity) || 0);

    if (!cleanSku || !cleanName) return;

    try {
      if (editProduct) {
        // Editar
        const prevQty = editProduct.quantity;
        await updateDoc(doc(db, 'products', editProduct.id), {
          sku: cleanSku,
          name: cleanName,
          quantity: qty,
          lastUpdated: serverTimestamp(),
          updatedBy: currentUser.uid,
        });

        const action = qty !== prevQty
          ? (qty > prevQty ? 'cantidad_agregada' : 'cantidad_descontada')
          : 'producto_editado';

        await logAction(action, currentUser, {
          sku: formData.sku,
          productName: formData.name,
          previousValue: prevQty,
          newValue: qty,
          description: `Editó ${formData.sku} (${formData.name})`,
        });

        if (qty !== prevQty) {
          const diff = qty - prevQty;
          const msg = diff > 0
            ? `${currentUser.displayName || currentUser.email} agregó ${diff} uds a ${formData.sku} (${formData.name})`
            : `${currentUser.displayName || currentUser.email} descontó ${Math.abs(diff)} uds de ${formData.sku} (${formData.name})`;
          await sendNotification(diff > 0 ? 'agregado' : 'descuento', msg, currentUser);
        }
      } else {
        // Crear
        await addDoc(collection(db, 'products'), {
          sku: cleanSku,
          name: cleanName,
          quantity: qty,
          createdAt: serverTimestamp(),
          lastUpdated: serverTimestamp(),
          updatedBy: currentUser.uid,
        });

        await logAction('producto_creado', currentUser, {
          sku: cleanSku,
          productName: cleanName,
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
    const newQty = Math.max(0, product.quantity + delta);
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

  const handleExecuteImport = async () => {
    if (!importCols?.sku || !importCols?.quantity) {
      setImportError('Debes seleccionar al menos las columnas de SKU y Cantidad.');
      return;
    }

    setImporting(true);
    setImportError('');
    setImportProgress('Procesando datos del archivo...');

    try {
      const normalized = normalizeData(importRawData, importCols).filter(
        (item) => item.sku && item.sku.length > 0
      );

      if (normalized.length === 0) {
        throw new Error('No se encontraron filas válidas con SKU en el archivo.');
      }

      setImportProgress(`Preparando ${normalized.length} productos...`);

      // Mapeo de productos existentes por SKU
      const existingMap = new Map();
      products.forEach((p) => {
        if (p.sku) existingMap.set(String(p.sku).trim().toLowerCase(), p);
      });

      // Si el modo es "replace", eliminamos los productos anteriores primero
      if (importMode === 'replace' && products.length > 0) {
        setImportProgress('Limpiando inventario anterior...');
        const BATCH_SIZE = 400;
        for (let i = 0; i < products.length; i += BATCH_SIZE) {
          const batch = writeBatch(db);
          const slice = products.slice(i, i + BATCH_SIZE);
          slice.forEach((p) => batch.delete(doc(db, 'products', p.id)));
          await batch.commit();
        }
        existingMap.clear();
      }

      // Procesar importación en lotes de 400
      const BATCH_SIZE = 400;
      let inserted = 0;
      let updated = 0;
      let skipped = 0;

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
              quantity: item.quantity,
              createdAt: serverTimestamp(),
              lastUpdated: serverTimestamp(),
              updatedBy: currentUser.uid,
            });
            inserted++;
          } else {
            // upsert (actualizar o crear)
            if (existing) {
              batch.update(doc(db, 'products', existing.id), {
                name: item.name || existing.name,
                quantity: item.quantity,
                lastUpdated: serverTimestamp(),
                updatedBy: currentUser.uid,
              });
              updated++;
            } else {
              const newRef = doc(collection(db, 'products'));
              batch.set(newRef, {
                sku: item.sku,
                name: item.name || item.sku,
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
      await logAction('excel_subido', currentUser, {
        fileName: importFile.name,
        mode: importMode,
        totalRows: normalized.length,
        inserted,
        updated,
        skipped,
        description: `Importó Excel "${importFile.name}": ${inserted} creados, ${updated} actualizados${skipped ? `, ${skipped} omitidos` : ''}.`,
      });

      await sendNotification(
        'info',
        `📥 ${currentUser.displayName || currentUser.email} importó ${normalized.length} productos desde Excel (${inserted} creados, ${updated} actualizados)`,
        currentUser
      );

      setImportSuccess(`¡Importación completada! ${inserted} productos creados, ${updated} actualizados${skipped ? `, ${skipped} omitidos` : ''}.`);
      setTimeout(() => {
        setShowImportModal(false);
        setImportFile(null);
        setImportRawData([]);
        setImportCols(null);
        setImportSuccess('');
        setImportProgress('');
      }, 1800);
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
          {products.length} productos registrados
        </p>
      </div>

      {/* Toolbar */}
      <div className="toolbar">
        <div className="toolbar-group">
          <div className="search-bar" style={{ minWidth: '280px' }}>
            <span className="search-bar-icon">🔍</span>
            <input
              type="text"
              placeholder="Buscar por SKU o nombre..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="toolbar-group">
          <button className="btn btn-secondary" onClick={() => setShowImportModal(true)}>
            📤 Importar Excel
          </button>
          <button className="btn btn-secondary" onClick={handleExport}>
            📥 Exportar Excel
          </button>
          <button className="btn btn-primary" onClick={openAddModal}>
            ➕ Agregar Producto
          </button>
        </div>
      </div>

      {/* Table */}
      {filteredProducts.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">📦</div>
            <div className="empty-state-title">
              {search ? 'Sin resultados' : 'Inventario vacío'}
            </div>
            <div className="empty-state-text">
              {search
                ? 'No se encontraron productos con esa búsqueda'
                : 'Agrega productos manualmente o importa tu archivo Excel con un clic'
              }
            </div>
            {!search && (
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginTop: '16px' }}>
                <button className="btn btn-primary" onClick={openAddModal}>
                  ➕ Agregar producto
                </button>
                <button className="btn btn-secondary" onClick={() => setShowImportModal(true)}>
                  📤 Importar desde Excel
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="table-container">
          <table className="table">
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
              {filteredProducts.map((product) => (
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
                      color: product.quantity === 0 ? 'var(--danger)' : product.quantity < 10 ? 'var(--warning)' : 'var(--text-primary)',
                    }}>
                      {product.quantity}
                    </span>
                  </td>
                  <td>
                    <div className="quantity-control">
                      <button
                        className="quantity-btn minus"
                        onClick={() => handleQuantityChange(product, -1)}
                        disabled={product.quantity <= 0}
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
                    placeholder="Ej: Cable HDMI 2m"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Cantidad</label>
                  <input
                    type="number"
                    className="form-input"
                    placeholder="0"
                    min="0"
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
                  Carga masiva de productos mediante archivo .xlsx, .xls o .csv
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
                    Compatible con archivos .xlsx, .xls y .csv
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
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
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
                      <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '13px' }}>
                        <input
                          type="radio"
                          name="importMode"
                          value="upsert"
                          checked={importMode === 'upsert'}
                          onChange={(e) => setImportMode(e.target.value)}
                        />
                        <span>
                          <strong>Actualizar y agregar nuevos (Recomendado)</strong>: Si el SKU ya existe, actualiza su stock; si no existe, lo crea.
                        </span>
                      </label>

                      <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '13px' }}>
                        <input
                          type="radio"
                          name="importMode"
                          value="only_new"
                          checked={importMode === 'only_new'}
                          onChange={(e) => setImportMode(e.target.value)}
                        />
                        <span>
                          <strong>Solo agregar nuevos</strong>: Solo crea productos nuevos; no modifica los que ya estén registrados.
                        </span>
                      </label>

                      <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '13px' }}>
                        <input
                          type="radio"
                          name="importMode"
                          value="replace"
                          checked={importMode === 'replace'}
                          onChange={(e) => setImportMode(e.target.value)}
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
                            <th>Cantidad</th>
                          </tr>
                        </thead>
                        <tbody>
                          {importRawData.slice(0, 5).map((row, idx) => (
                            <tr key={idx}>
                              <td><code>{String(row[importCols?.sku] || '—')}</code></td>
                              <td>{String(row[importCols?.name] || row[importCols?.sku] || '—')}</td>
                              <td><strong>{row[importCols?.quantity] ?? 0}</strong></td>
                            </tr>
                          ))}
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
