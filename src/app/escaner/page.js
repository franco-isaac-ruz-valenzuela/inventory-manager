'use client';

import { useState, useCallback } from 'react';
import { db } from '../../lib/firebase';
import {
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  doc,
  serverTimestamp,
} from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';
import { logAction } from '../../lib/auditLog';
import { sendNotification } from '../../lib/notifications';
import BarcodeScanner from '../../components/BarcodeScanner';

export default function EscanerPage() {
  const { currentUser } = useAuth();
  const [scannedCode, setScannedCode] = useState('');
  const [product, setProduct] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [scanHistory, setScanHistory] = useState([]);
  const [manualCode, setManualCode] = useState('');
  const [updating, setUpdating] = useState(false);

  const searchProduct = useCallback(async (code) => {
    setScannedCode(code);
    setNotFound(false);
    setProduct(null);

    try {
      const q = query(collection(db, 'products'), where('sku', '==', code));
      const snapshot = await getDocs(q);

      if (snapshot.empty) {
        setNotFound(true);
        setScanHistory((prev) => [
          { code, found: false, time: new Date() },
          ...prev.slice(0, 19),
        ]);
      } else {
        const docSnap = snapshot.docs[0];
        const prod = { id: docSnap.id, ...docSnap.data() };
        setProduct(prod);
        setScanHistory((prev) => [
          { code, found: true, name: prod.name, time: new Date() },
          ...prev.slice(0, 19),
        ]);

        await logAction('escaneo', currentUser, {
          sku: code,
          productName: prod.name,
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
                <div style={{ textAlign: 'center', padding: '16px' }}>
                  <div style={{ fontSize: '2.5rem', marginBottom: '12px', color: 'var(--danger)' }}>
                    <i className="bi bi-x-circle-fill"></i>
                  </div>
                  <div className="scanner-result-sku">{scannedCode}</div>
                  <p style={{ color: 'var(--text-secondary)' }}>
                    Producto no encontrado en el inventario
                  </p>
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
            <div className="card-title" style={{ marginBottom: '12px' }}>
              📋 Historial de Escaneos
            </div>
            {scanHistory.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '24px' }}>
                Los escaneos aparecerán aquí
              </div>
            ) : (
              <div style={{ maxHeight: '300px', overflow: 'auto' }}>
                {scanHistory.map((scan, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '8px 0',
                      borderBottom: '1px solid var(--border-color)',
                    }}
                  >
                    <span>{scan.found ? '✅' : '❌'}</span>
                    <div style={{ flex: 1 }}>
                      <code style={{ color: 'var(--accent-primary)', fontSize: 'var(--font-size-sm)' }}>
                        {scan.code}
                      </code>
                      {scan.name && (
                        <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)', marginLeft: '8px' }}>
                          {scan.name}
                        </span>
                      )}
                    </div>
                    <span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)' }}>
                      {scan.time.toLocaleTimeString('es-AR')}
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
