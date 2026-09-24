'use client';

import { useState, useEffect } from 'react';
import { db } from '../../lib/firebase';
import { collection, query, orderBy, limit, onSnapshot, where } from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';
import { getActionStyle, getActionMessage } from '../../lib/auditLog';
import { exportHistoryToExcel } from '../../lib/excelUtils';

const actionTypes = [
  { value: 'all', label: 'Todas', icon: 'bi bi-list-ul' },
  { value: 'producto_agregado', label: 'Agregados / Creados', icon: 'bi bi-plus-circle' },
  { value: 'producto_editado', label: 'Editados', icon: 'bi bi-pencil-square' },
  { value: 'producto_eliminado', label: 'Eliminados', icon: 'bi bi-trash3' },
  { value: 'cantidad_descontada', label: 'Descontados', icon: 'bi bi-dash-circle' },
  { value: 'cantidad_agregada', label: 'Stock Agregado', icon: 'bi bi-plus-circle-dotted' },
  { value: 'escaneo', label: 'Escaneos', icon: 'bi bi-upc-scan' },
  { value: 'excel_subido', label: 'Excel', icon: 'bi bi-file-earmark-excel' },
  { value: 'comparacion_realizada', label: 'Comparaciones', icon: 'bi bi-arrow-left-right' },
  { value: 'reporte_descargado', label: 'Reportes', icon: 'bi bi-download' },
];

export default function HistorialPage() {
  const { currentUser } = useAuth();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterAction, setFilterAction] = useState('all');
  const [filterUser, setFilterUser] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [users, setUsers] = useState([]);

  useEffect(() => {
    const q = query(
      collection(db, 'audit_log'),
      orderBy('timestamp', 'desc'),
      limit(300)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = [];
        const userSet = new Map();

        snapshot.forEach((doc) => {
          const entry = { id: doc.id, ...doc.data() };
          data.push(entry);

          if (entry.userId && !userSet.has(entry.userId)) {
            userSet.set(entry.userId, {
              uid: entry.userId,
              name: entry.userName || entry.userEmail || 'Desconocido',
            });
          }
        });

        setLogs(data);
        setUsers(Array.from(userSet.values()));
        setLoading(false);
      },
      (error) => {
        console.error('Error cargando historial de auditoría:', error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  // Filtrar logs
  const filteredLogs = logs.filter((log) => {
    if (filterAction !== 'all') {
      if (filterAction === 'producto_agregado') {
        if (log.action !== 'producto_agregado' && log.action !== 'producto_creado') return false;
      } else if (log.action !== filterAction) {
        return false;
      }
    }
    if (filterUser !== 'all' && log.userId !== filterUser) return false;
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      const details = log.details || {};
      return (
        details.sku?.toLowerCase().includes(s) ||
        details.productName?.toLowerCase().includes(s) ||
        details.description?.toLowerCase().includes(s) ||
        log.userName?.toLowerCase().includes(s)
      );
    }
    return true;
  });

  const handleExportHistory = () => {
    if (filteredLogs.length === 0) return;
    exportHistoryToExcel(filteredLogs, `historial_${new Date().toISOString().slice(0, 10)}.xlsx`);
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
        <h1 className="page-title">Historial de Actividad</h1>
        <p className="page-description">
          Registro completo de todas las acciones realizadas en el sistema
        </p>
      </div>

      {/* Toolbar */}
      <div className="toolbar">
        <div className="toolbar-group" style={{ flex: 1, flexWrap: 'wrap' }}>
          <div className="search-bar" style={{ minWidth: '240px' }}>
            <i className="bi bi-search search-bar-icon"></i>
            <input
              type="text"
              placeholder="Buscar por SKU, producto o usuario..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <select
            className="form-input"
            style={{ width: 'auto', minWidth: '160px' }}
            value={filterUser}
            onChange={(e) => setFilterUser(e.target.value)}
          >
            <option value="all">Todos los usuarios</option>
            {users.map((u) => (
              <option key={u.uid} value={u.uid}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
        <div className="toolbar-group">
          <button className="btn btn-secondary" onClick={handleExportHistory} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <i className="bi bi-file-earmark-excel"></i> Exportar Excel
          </button>
        </div>
      </div>

      {/* Action filters */}
      <div className="filter-chips" style={{ marginBottom: '24px' }}>
        {actionTypes.map((type) => (
          <button
            key={type.value}
            className={`filter-chip ${filterAction === type.value ? 'active' : ''}`}
            onClick={() => setFilterAction(type.value)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <i className={type.icon}></i> {type.label}
          </button>
        ))}
      </div>

      {/* Results count */}
      <p style={{
        fontSize: 'var(--font-size-sm)',
        color: 'var(--text-muted)',
        marginBottom: '16px',
      }}>
        Mostrando {filteredLogs.length} de {logs.length} registros
      </p>

      {/* Timeline */}
      {filteredLogs.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <i className="bi bi-clipboard2-x"></i>
            </div>
            <div className="empty-state-title">Sin registros</div>
            <div className="empty-state-text">
              {logs.length === 0
                ? 'Las acciones del equipo aparecerán aquí'
                : 'No hay registros que coincidan con los filtros'
              }
            </div>
          </div>
        </div>
      ) : (
        <div className="timeline">
          {filteredLogs.map((log) => {
            const style = getActionStyle(log.action);
            const message = getActionMessage(
              log.action,
              log.userName,
              log.details || {}
            );

            return (
              <div key={log.id} className="timeline-item">
                <div
                  className="timeline-dot"
                  style={{ borderColor: style.color }}
                />
                <div className="timeline-content">
                  <div className="timeline-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <i className={style.icon} style={{ fontSize: '1.05rem', color: style.color }}></i>
                      <span className="timeline-user">{log.userName}</span>
                      <span
                        className="badge"
                        style={{
                          background: `${style.color}15`,
                          color: style.color,
                        }}
                      >
                        {style.label}
                      </span>
                    </div>
                    <span className="timeline-time">
                      {log.timestamp?.toDate
                        ? log.timestamp.toDate().toLocaleString('es-AR')
                        : timeAgo(log.timestamp)
                      }
                    </span>
                  </div>
                  <div className="timeline-message">{message}</div>
                  {log.details?.sku && (
                    <div style={{ marginTop: '6px' }}>
                      <code style={{
                        background: 'rgba(0, 212, 255, 0.1)',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        color: 'var(--accent-primary)',
                        fontSize: 'var(--font-size-xs)',
                      }}>
                        {log.details.sku}
                      </code>
                      {log.details.previousValue != null && log.details.newValue != null && (
                        <span style={{
                          marginLeft: '8px',
                          fontSize: 'var(--font-size-xs)',
                          color: 'var(--text-muted)',
                        }}>
                          {log.details.previousValue} → {log.details.newValue}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
