'use client';

import { useState, useEffect } from 'react';
import { db } from '../../lib/firebase';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';
import { logAction } from '../../lib/auditLog';
import { generateDiffReport, downloadWorkbook } from '../../lib/excelUtils';
import { timeAgo } from '../../lib/notifications';

export default function ReportesPage() {
  const { currentUser } = useAuth();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedSession, setSelectedSession] = useState(null);

  useEffect(() => {
    const q = query(
      collection(db, 'inventory_sessions'),
      orderBy('createdAt', 'desc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = [];
      snapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() });
      });
      setSessions(data);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleDownload = async (session) => {
    const result = {
      differences: session.differences || [],
      summary: session.summary || {},
    };
    const wb = generateDiffReport(result, session.name);
    downloadWorkbook(wb, `reporte_${session.name.replace(/\s+/g, '_')}.xlsx`);

    await logAction('reporte_descargado', currentUser, {
      description: `Re-descargó reporte: ${session.name}`,
    });
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
        <h1 className="page-title">Reportes</h1>
        <p className="page-description">
          Sesiones de comparación guardadas
        </p>
      </div>

      {sessions.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">📊</div>
            <div className="empty-state-title">Sin reportes aún</div>
            <div className="empty-state-text">
              Los reportes aparecerán aquí cuando guardes una comparación de inventarios
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '16px' }}>
          {sessions.map((session) => (
            <div key={session.id} className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h3 style={{ fontSize: 'var(--font-size-md)', fontWeight: 600, marginBottom: '4px' }}>
                    {session.name}
                  </h3>
                  <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                    Creado por {session.createdByName || 'Desconocido'} • {timeAgo(session.createdAt)}
                  </p>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <span className="badge badge-info">
                      📁 {session.previousFile}
                    </span>
                    <span style={{ color: 'var(--text-muted)' }}>vs</span>
                    <span className="badge badge-info">
                      📁 {session.currentFile}
                    </span>
                  </div>
                  {session.summary && (
                    <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
                      <span className="badge badge-success">+{session.summary.added} nuevos</span>
                      <span className="badge badge-danger">-{session.summary.removed} eliminados</span>
                      <span className="badge badge-warning">{session.summary.changed} cambiados</span>
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => setSelectedSession(
                      selectedSession?.id === session.id ? null : session
                    )}
                  >
                    {selectedSession?.id === session.id ? '▲ Ocultar' : '▼ Ver Detalles'}
                  </button>
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => handleDownload(session)}
                  >
                    📥 Excel
                  </button>
                </div>
              </div>

              {/* Expanded details */}
              {selectedSession?.id === session.id && session.differences?.length > 0 && (
                <div style={{ marginTop: '16px' }}>
                  <div className="table-container">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Estado</th>
                          <th>SKU</th>
                          <th>Nombre</th>
                          <th>Anterior</th>
                          <th>Actual</th>
                          <th>Diferencia</th>
                        </tr>
                      </thead>
                      <tbody>
                        {session.differences.map((diff, i) => (
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
                            <td><code>{diff.sku}</code></td>
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
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
