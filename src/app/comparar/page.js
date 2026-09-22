'use client';

import { useState, useRef } from 'react';
import { db } from '../../lib/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';
import { logAction } from '../../lib/auditLog';
import { sendNotification } from '../../lib/notifications';
import {
  parseExcelFile,
  detectColumns,
  normalizeData,
  compareInventories,
  generateDiffReport,
  downloadWorkbook,
} from '../../lib/excelUtils';

export default function CompararPage() {
  const { currentUser } = useAuth();
  const [previousFile, setPreviousFile] = useState(null);
  const [currentFile, setCurrentFile] = useState(null);
  const [previousData, setPreviousData] = useState(null);
  const [currentData, setCurrentData] = useState(null);
  const [previousCols, setPreviousCols] = useState(null);
  const [currentCols, setCurrentCols] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState('upload'); // upload | mapping | result
  const prevRef = useRef(null);
  const currRef = useRef(null);

  const handleFileChange = async (file, type) => {
    if (!file) return;
    setError('');

    try {
      const data = await parseExcelFile(file);
      const cols = detectColumns(data);

      if (type === 'previous') {
        setPreviousFile(file);
        setPreviousData(data);
        setPreviousCols(cols);
      } else {
        setCurrentFile(file);
        setCurrentData(data);
        setCurrentCols(cols);
      }
    } catch (err) {
      setError(`Error al leer el archivo: ${err.message}`);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.currentTarget.classList.add('drag-over');
  };

  const handleDragLeave = (e) => {
    e.currentTarget.classList.remove('drag-over');
  };

  const handleDrop = (e, type) => {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleFileChange(file, type);
  };

  const canCompare = previousData && currentData && previousCols?.detected && currentCols?.detected;

  const handleCompare = async () => {
    if (!canCompare) return;
    setLoading(true);
    setError('');

    try {
      const prevNorm = normalizeData(previousData, previousCols);
      const currNorm = normalizeData(currentData, currentCols);
      const comparison = compareInventories(prevNorm, currNorm);
      setResult(comparison);
      setStep('result');

      // Log action
      await logAction('comparacion_realizada', currentUser, {
        description: `Comparó "${previousFile.name}" vs "${currentFile.name}". ${comparison.summary.totalDifferences} diferencias encontradas.`,
      });

      await sendNotification(
        'editado',
        `${currentUser.displayName || currentUser.email} realizó una comparación de inventarios (${comparison.summary.totalDifferences} diferencias)`,
        currentUser
      );
    } catch (err) {
      setError(`Error al comparar: ${err.message}`);
    }

    setLoading(false);
  };

  const handleDownloadReport = async () => {
    if (!result) return;
    const sessionName = `Comparación ${new Date().toLocaleDateString('es-AR')}`;
    const wb = generateDiffReport(result, sessionName);
    downloadWorkbook(wb, `reporte_diferencias_${new Date().toISOString().slice(0, 10)}.xlsx`);

    await logAction('reporte_descargado', currentUser, {
      description: `Descargó reporte de diferencias`,
    });
  };

  const handleSaveSession = async () => {
    if (!result) return;

    try {
      await addDoc(collection(db, 'inventory_sessions'), {
        name: `Comparación ${new Date().toLocaleDateString('es-AR')}`,
        createdAt: serverTimestamp(),
        createdBy: currentUser.uid,
        createdByName: currentUser.displayName || currentUser.email,
        status: 'completed',
        previousFile: previousFile.name,
        currentFile: currentFile.name,
        summary: result.summary,
        differences: result.differences,
      });
      alert('✅ Sesión guardada correctamente');
    } catch (err) {
      console.error('Error guardando sesión:', err);
      alert('Error al guardar la sesión');
    }
  };

  const resetAll = () => {
    setPreviousFile(null);
    setCurrentFile(null);
    setPreviousData(null);
    setCurrentData(null);
    setPreviousCols(null);
    setCurrentCols(null);
    setResult(null);
    setStep('upload');
    setError('');
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Comparar Inventarios</h1>
        <p className="page-description">
          Sube dos archivos Excel para encontrar las diferencias
        </p>
      </div>

      {error && (
        <div className="login-error" style={{ marginBottom: '16px' }}>
          {error}
        </div>
      )}

      {step === 'upload' && (
        <>
          <div className="comparison-grid">
            {/* Previous file */}
            <div
              className={`drop-zone ${previousFile ? 'has-file' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, 'previous')}
              onClick={() => prevRef.current?.click()}
            >
              <input
                ref={prevRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                style={{ display: 'none' }}
                onChange={(e) => handleFileChange(e.target.files[0], 'previous')}
              />
              <div className="drop-zone-icon">
                {previousFile ? '✅' : '📁'}
              </div>
              <div className="drop-zone-text">
                {previousFile ? previousFile.name : 'Inventario ANTERIOR'}
              </div>
              <div className="drop-zone-hint">
                {previousFile
                  ? `${previousData?.length || 0} registros • ${previousCols?.detected ? 'Columnas detectadas ✓' : '⚠️ Revisar columnas'}`
                  : 'Arrastra o haz click para seleccionar'
                }
              </div>
            </div>

            {/* Current file */}
            <div
              className={`drop-zone ${currentFile ? 'has-file' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, 'current')}
              onClick={() => currRef.current?.click()}
            >
              <input
                ref={currRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                style={{ display: 'none' }}
                onChange={(e) => handleFileChange(e.target.files[0], 'current')}
              />
              <div className="drop-zone-icon">
                {currentFile ? '✅' : '📁'}
              </div>
              <div className="drop-zone-text">
                {currentFile ? currentFile.name : 'Inventario ACTUAL'}
              </div>
              <div className="drop-zone-hint">
                {currentFile
                  ? `${currentData?.length || 0} registros • ${currentCols?.detected ? 'Columnas detectadas ✓' : '⚠️ Revisar columnas'}`
                  : 'Arrastra o haz click para seleccionar'
                }
              </div>
            </div>
          </div>

          {/* Column detection info */}
          {(previousCols || currentCols) && (
            <div className="card" style={{ marginBottom: '16px' }}>
              <div className="card-title" style={{ marginBottom: '12px' }}>
                📊 Columnas detectadas
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                {previousCols && (
                  <div>
                    <strong style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
                      Archivo anterior:
                    </strong>
                    <div style={{ fontSize: 'var(--font-size-sm)', marginTop: '4px' }}>
                      SKU: <code>{previousCols.sku || '❌ No detectada'}</code> •
                      Nombre: <code>{previousCols.name || '❌ No detectada'}</code> •
                      Cantidad: <code>{previousCols.quantity || '❌ No detectada'}</code>
                    </div>
                  </div>
                )}
                {currentCols && (
                  <div>
                    <strong style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
                      Archivo actual:
                    </strong>
                    <div style={{ fontSize: 'var(--font-size-sm)', marginTop: '4px' }}>
                      SKU: <code>{currentCols.sku || '❌ No detectada'}</code> •
                      Nombre: <code>{currentCols.name || '❌ No detectada'}</code> •
                      Cantidad: <code>{currentCols.quantity || '❌ No detectada'}</code>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'center', gap: '12px' }}>
            <button
              className="btn btn-primary btn-lg"
              disabled={!canCompare || loading}
              onClick={handleCompare}
            >
              {loading ? (
                <>
                  <span className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
                  Comparando...
                </>
              ) : (
                '🔄 Comparar Inventarios'
              )}
            </button>
          </div>
        </>
      )}

      {step === 'result' && result && (
        <>
          {/* Summary */}
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-icon">📊</div>
              <div className="stat-value">{result.summary.totalDifferences}</div>
              <div className="stat-label">Total diferencias</div>
            </div>
            <div className="stat-card">
              <div className="stat-icon">🟢</div>
              <div className="stat-value" style={{ color: 'var(--success)' }}>
                {result.summary.added}
              </div>
              <div className="stat-label">Productos nuevos</div>
            </div>
            <div className="stat-card">
              <div className="stat-icon">🔴</div>
              <div className="stat-value" style={{ color: 'var(--danger)' }}>
                {result.summary.removed}
              </div>
              <div className="stat-label">Productos eliminados</div>
            </div>
            <div className="stat-card">
              <div className="stat-icon">🟡</div>
              <div className="stat-value" style={{ color: 'var(--warning)' }}>
                {result.summary.changed}
              </div>
              <div className="stat-label">Con cambios</div>
            </div>
          </div>

          {/* Actions */}
          <div className="toolbar">
            <div className="toolbar-group">
              <button className="btn btn-secondary" onClick={resetAll}>
                ← Nueva Comparación
              </button>
            </div>
            <div className="toolbar-group">
              <button className="btn btn-success" onClick={handleSaveSession}>
                💾 Guardar Sesión
              </button>
              <button className="btn btn-primary" onClick={handleDownloadReport}>
                📥 Descargar Reporte Excel
              </button>
            </div>
          </div>

          {/* Differences table */}
          {result.differences.length > 0 ? (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Estado</th>
                    <th>SKU</th>
                    <th>Nombre</th>
                    <th>Cantidad Anterior</th>
                    <th>Cantidad Actual</th>
                    <th>Diferencia</th>
                  </tr>
                </thead>
                <tbody>
                  {result.differences.map((diff, i) => (
                    <tr key={i} className={`diff-row-${diff.status}`}>
                      <td>
                        <span className={`badge badge-${
                          diff.status === 'nuevo' ? 'success' :
                          diff.status === 'eliminado' ? 'danger' : 'warning'
                        }`}>
                          {diff.status === 'nuevo' ? '🟢 Nuevo' :
                           diff.status === 'eliminado' ? '🔴 Eliminado' : '🟡 Modificado'}
                        </span>
                      </td>
                      <td>
                        <code style={{
                          background: 'rgba(0, 212, 255, 0.1)',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          color: 'var(--accent-primary)',
                        }}>
                          {diff.sku}
                        </code>
                      </td>
                      <td>{diff.name}</td>
                      <td>{diff.previousQty}</td>
                      <td>{diff.currentQty}</td>
                      <td>
                        <span className={diff.diff > 0 ? 'diff-positive' : 'diff-negative'}>
                          {diff.diff > 0 ? `+${diff.diff}` : diff.diff}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="card">
              <div className="empty-state">
                <div className="empty-state-icon">✅</div>
                <div className="empty-state-title">Sin diferencias</div>
                <div className="empty-state-text">
                  Los dos inventarios son idénticos
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
