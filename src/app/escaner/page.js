'use client';

import { useState, useCallback, useEffect } from 'react';
import { db } from '../../lib/firebase';
import {
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  addDoc,
  doc,
  serverTimestamp,
  orderBy,
  limit,
  onSnapshot,
} from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';
import { logAction } from '../../lib/auditLog';
import { sendNotification, timeAgo } from '../../lib/notifications';
import BarcodeScanner from '../../components/BarcodeScanner';

export default function EscanerPage() {
  const { currentUser } = useAuth();
  const [scannedCode, setScannedCode] = useState('');
  const [product, setProduct] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [scanHistory, setScanHistory] = useState([]);
  const [manualCode, setManualCode] = useState('');
  const [updating, setUpdating] = useState(false);
  const [newProductName, setNewProductName] = useState('');
  const [newProductQty, setNewProductQty] = useState(1);
  // Persistir y sincronizar historial de escaneos en tiempo real desde Firestore
  useEffect(() => {
    try {
      const saved = localStorage.getItem('leker_scan_history');
      if (saved) {
        setScanHistory(JSON.parse(saved));
      }
    } catch (e) {}

    const q = query(
      collection(db, 'audit_log'),
      orderBy('timestamp', 'desc'),
      limit(60)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const scans = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        if (data.action === 'escaneo') {
          scans.push({
            id: docSnap.id,
            code: data.details?.sku || '',
            name: data.details?.productName && data.details?.productName !== 'No registrado' ? data.details.productName : '',
            found: data.details?.found !== false,
            userName: data.userName || 'Usuario',
            time: data.timestamp?.toDate ? data.timestamp.toDate() : new Date(),
          });
        }
      });

      if (scans.length > 0) {
        setScanHistory(scans.slice(0, 25));
        try {
          localStorage.setItem('leker_scan_history', JSON.stringify(scans.slice(0, 25)));
        } catch (e) {}
      }
    });

    return () => unsubscribe();
  }, []);

  const searchProduct = useCallback(async (code) => {
    setScannedCode(code);
    setNotFound(false);
    setProduct(null);

    try {
      const q = query(collection(db, 'products'), where('sku', '==', code));
      const snapshot = await getDocs(q);

      if (snapshot.empty) {
        setNotFound(true);

        // Registrar SIEMPRE el intento de escaneo en el Log de Auditoría
        await logAction('escaneo', currentUser, {
          sku: code,
          productName: 'No registrado',
          found: false,
          description: `Escaneó código ${code} (No registrado)`,
        });
      } else {
        const docSnap = snapshot.docs[0];
        const prod = { id: docSnap.id, ...docSnap.data() };
        setProduct(prod);

        // Registrar el escaneo exitoso en el Log de Auditoría
        await logAction('escaneo', currentUser, {
          sku: code,
          productName: prod.name,
          found: true,
          description: `Escaneó ${code} (${prod.name})`,
        });
      }
    } catch (error) {
      console.error('Error buscando producto:', error);
    }
  }, [currentUser]);

  const handleQuantityChange = async (delta) => {
    if (!product || updating) return;
    setUpdating(true);

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

      setProduct((prev) => ({ ...prev, quantity: newQty }));
    } catch (error) {
      console.error('Error actualizando cantidad:', error);
    }

    setUpdating(false);
  };

  const handleManualSearch = (e) => {
    e.preventDefault();
    if (manualCode.trim()) {
      searchProduct(manualCode.trim());
      setManualCode('');
    }
  };

  const handleCreateProduct = async (e) => {
    e.preventDefault();
    if (!newProductName.trim() || !scannedCode || creating) return;
    setCreating(true);

    try {
      const cleanSku = scannedCode.trim();
      const cleanName = newProductName.trim();
      const qty = parseInt(newProductQty) || 0;

      const docRef = await addDoc(collection(db, 'products'), {
        sku: cleanSku,
        name: cleanName,
        quantity: qty,
        createdAt: serverTimestamp(),
        lastUpdated: serverTimestamp(),
        updatedBy: currentUser.uid,
      });

      await logAction('producto_agregado', currentUser, {
        sku: cleanSku,
        productName: cleanName,
        newValue: qty,
        description: `Agregó producto escaneado ${cleanSku} (${cleanName}) con stock ${qty}`,
      });

      await sendNotification(
        'creado',
        `${currentUser.displayName || currentUser.email} registró nuevo producto desde el escáner: ${cleanSku} (${cleanName})`,
        currentUser
      );

      const createdProduct = {
        id: docRef.id,
        sku: cleanSku,
        name: cleanName,
        quantity: qty,
      };

      setProduct(createdProduct);
      setNotFound(false);
      setNewProductName('');
      setNewProductQty(1);

      // Actualizar el historial de escaneos
      setScanHistory((prev) => [
        { code: cleanSku, found: true, name: cleanName, time: new Date() },
        ...prev.slice(1),
      ]);
    } catch (err) {
      console.error('Error registrando producto:', err);
      alert('Error al guardar el producto en la base de datos');
    }
    setCreating(false);
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Escáner de Códigos</h1>
        <p className="page-description">
          Escanea códigos de barras o busca manualmente por SKU
        </p>
      </div>

      <div className="scanner-grid">
        {/* Left: Scanner */}
        <div>
          <div className="card" style={{ marginBottom: '16px' }}>
            <div className="card-title" style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <i className="bi bi-camera" style={{ color: 'var(--accent-primary)' }}></i> Cámara
            </div>
            <BarcodeScanner
              onScan={searchProduct}
              onError={(err) => console.error(err)}
            />
          </div>

          {/* Manual search */}
          <div className="card">
            <div className="card-title" style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <i className="bi bi-search" style={{ color: 'var(--accent-primary)' }}></i> Búsqueda Manual
            </div>
            <form onSubmit={handleManualSearch} style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                className="form-input"
                placeholder="Ingresa el SKU manualmente..."
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
              />
              <button type="submit" className="btn btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <i className="bi bi-search"></i> Buscar
              </button>
            </form>
          </div>
        </div>

        {/* Right: Result */}
        <div>
          {/* Scan result */}
          {scannedCode && (
            <div className="card" style={{ marginBottom: '16px' }}>
              {notFound ? (
                <div style={{ padding: '8px' }}>
                  <div style={{ textAlign: 'center', marginBottom: '16px' }}>
                    <div style={{ fontSize: '2.5rem', marginBottom: '8px', color: 'var(--accent-primary)' }}>
                      <i className="bi bi-upc-scan"></i>
                    </div>
                    <div className="scanner-result-sku">{scannedCode}</div>
                    <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)' }}>
                      Este código aún no existe en la base de datos.
                    </p>
                  </div>

                  <form onSubmit={handleCreateProduct} style={{
                    background: 'var(--bg-glass)',
                    padding: '20px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-accent)',
                  }}>
                    <h4 style={{
                      fontSize: 'var(--font-size-md)',
                      fontWeight: 600,
                      marginBottom: '14px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      color: 'var(--accent-primary)',
                    }}>
                      <i className="bi bi-plus-circle-fill"></i> Registrar en Base de Datos
                    </h4>

                    <div className="form-group" style={{ marginBottom: '12px' }}>
                      <label className="form-label">Código SKU / Barras</label>
                      <input
                        type="text"
                        className="form-input"
                        value={scannedCode}
                        readOnly
                        style={{ opacity: 0.85, background: 'rgba(255,255,255,0.05)', fontWeight: 600 }}
                      />
                    </div>

                    <div className="form-group" style={{ marginBottom: '12px' }}>
                      <label className="form-label">Nombre del Producto *</label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Ej: Teclado Mecánico RGB, Arroz 1kg..."
                        value={newProductName}
                        onChange={(e) => setNewProductName(e.target.value)}
                        autoFocus
                        required
                      />
                    </div>

                    <div className="form-group" style={{ marginBottom: '16px' }}>
                      <label className="form-label">Cantidad Inicial</label>
                      <input
                        type="number"
                        className="form-input"
                        value={newProductQty}
                        onChange={(e) => setNewProductQty(e.target.value)}
                        required
                      />
                    </div>

                    <button
                      type="submit"
                      className="btn btn-primary"
                      disabled={creating || !newProductName.trim()}
                      style={{ width: '100%', justifyContent: 'center', gap: '8px' }}
                    >
                      {creating ? (
                        <>
                          <div className="spinner" style={{ width: '16px', height: '16px' }} />
                          Guardando en Firestore...
                        </>
                      ) : (
                        <>
                          <i className="bi bi-cloud-arrow-up-fill"></i> Guardar y Agregar al Inventario
                        </>
                      )}
                    </button>
                  </form>
                </div>
              ) : product ? (
                <div>
                  <div style={{ marginBottom: '16px' }}>
                    <span className="badge badge-success" style={{ marginBottom: '8px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <i className="bi bi-check-circle-fill"></i> Producto encontrado
                    </span>
                    <div className="scanner-result-sku">{product.sku}</div>
                    <h3 style={{ fontSize: 'var(--font-size-lg)', marginBottom: '4px' }}>
                      {product.name}
                    </h3>
                  </div>

                  <div style={{
                    background: 'var(--bg-glass)',
                    borderRadius: 'var(--radius-md)',
                    padding: '16px',
                    textAlign: 'center',
                  }}>
                    <div style={{
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--text-secondary)',
                      marginBottom: '8px',
                    }}>
                      Cantidad actual
                    </div>
                    <div className="quantity-control" style={{ justifyContent: 'center' }}>
                      <button
                        className="quantity-btn minus"
                        onClick={() => handleQuantityChange(-1)}
                        disabled={updating}
                      >
                        −
                      </button>
                      <div className="quantity-display" style={{
                        color: product.quantity < 0 ? 'var(--danger)' : undefined,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                      }}>
                        <span>{product.quantity}</span>
                        {product.quantity < 0 && (
                          <span style={{
                            fontSize: '10px',
                            fontWeight: 700,
                            background: 'var(--danger-bg)',
                            color: 'var(--danger)',
                            padding: '1px 6px',
                            borderRadius: '4px',
                            marginTop: '2px',
                          }}>
                            Faltante
                          </span>
                        )}
                      </div>
                      <button
                        className="quantity-btn plus"
                        onClick={() => handleQuantityChange(1)}
                        disabled={updating}
                      >
                        +
                      </button>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'center' }}>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => handleQuantityChange(-5)}
                        disabled={updating}
                      >
                        -5
                      </button>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => handleQuantityChange(-10)}
                        disabled={updating}
                      >
                        -10
                      </button>
                      <button
                        className="btn btn-success btn-sm"
                        onClick={() => handleQuantityChange(5)}
                        disabled={updating}
                      >
                        +5
                      </button>
                      <button
                        className="btn btn-success btn-sm"
                        onClick={() => handleQuantityChange(10)}
                        disabled={updating}
                      >
                        +10
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {/* Scan history */}
          <div className="card">
            <div className="card-title" style={{ marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <i className="bi bi-clock-history" style={{ color: 'var(--accent-primary)' }}></i> Historial de Escaneos
            </div>
            {scanHistory.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '24px' }}>
                <i className="bi bi-upc-scan" style={{ fontSize: '2rem', display: 'block', marginBottom: '8px', opacity: 0.4 }}></i>
                Los escaneos del equipo aparecerán aquí y quedarán guardados permanentemente
              </div>
            ) : (
              <div style={{ maxHeight: '340px', overflowY: 'auto' }}>
                {scanHistory.map((scan, i) => (
                  <div
                    key={scan.id || i}
                    onClick={() => searchProduct(scan.code)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '10px 8px',
                      borderBottom: '1px solid var(--border-color)',
                      cursor: 'pointer',
                      borderRadius: 'var(--radius-sm)',
                      transition: 'background var(--transition-fast)',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-glass-hover)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    title="Haz clic para volver a cargar este producto"
                  >
                    {scan.found ? (
                      <i className="bi bi-check-circle-fill text-success" style={{ fontSize: '1.1rem' }}></i>
                    ) : (
                      <i className="bi bi-question-circle-fill text-warning" style={{ fontSize: '1.1rem' }}></i>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <code style={{
                          color: 'var(--accent-primary)',
                          fontSize: 'var(--font-size-sm)',
                          fontWeight: 700,
                        }}>
                          {scan.code}
                        </code>
                        {scan.userName && (
                          <span className="badge badge-info" style={{ fontSize: '10px', padding: '1px 6px' }}>
                            {scan.userName}
                          </span>
                        )}
                      </div>
                      <div style={{
                        color: scan.name ? 'var(--text-primary)' : 'var(--text-muted)',
                        fontSize: 'var(--font-size-sm)',
                        marginTop: '2px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {scan.name || (scan.found ? 'Sin nombre' : 'No registrado en catálogo')}
                      </div>
                    </div>
                    <span style={{
                      color: 'var(--text-muted)',
                      fontSize: 'var(--font-size-xs)',
                      whiteSpace: 'nowrap',
                    }}>
                      {scan.time ? (scan.time instanceof Date ? scan.time.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '') : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
