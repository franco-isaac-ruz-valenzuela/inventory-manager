'use client';

import { useState, useEffect, useRef } from 'react';
import { db } from '../../lib/firebase';
import { collection, query, orderBy, limit, getDocs, startAfter, documentId } from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';
import { getActionStyle, getActionMessage } from '../../lib/auditLog';
import { exportHistoryToExcel } from '../../lib/excelUtils';

const actionTypes = [
  { value: 'all', label: 'Todas', icon: 'bi bi-list-ul' },
  { value: 'descuento_nota_pedido', label: 'Notas de Pedido', icon: 'bi bi-receipt' },
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
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const cursorRef = useRef(null);
  const requestRef = useRef(0);
  const busyRef = useRef(false);

  useEffect(() => {
    const version = ++requestRef.current;
    cursorRef.current = null;
    busyRef.current = false;
    setLoading(true);
    setLogs([]);
    setLoadError('');
    const q = query(collection(db, 'audit_log'), orderBy('timestamp', 'desc'), orderBy(documentId(), 'desc'), limit(51));
    getDocs(q).then((snapshot) => {
        if (version !== requestRef.current) return;
        const data = [];
        const userSet = new Map();

        snapshot.docs.slice(0, 50).forEach((doc) => {
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
        cursorRef.current = snapshot.docs[Math.min(snapshot.size, 50) - 1] || null;
        setHasMore(snapshot.size > 50);
        setLoading(false);
      }).catch((error) => {
        if (version !== requestRef.current) return;
        console.error('Error cargando historial de auditoría:', error);
        setLoadError('No se pudo cargar el historial. Intenta actualizar.');
        setLoading(false);
      });
    return () => { requestRef.current += 1; };
  }, [currentUser?.uid, refreshKey]);

  const loadMore = async () => {
    if (busyRef.current || !hasMore || !cursorRef.current) return;
    busyRef.current = true;
    setLoadingMore(true);
    setLoadError('');
    const version = requestRef.current;
    try {
      const snapshot = await getDocs(query(collection(db, 'audit_log'), orderBy('timestamp', 'desc'), orderBy(documentId(), 'desc'), startAfter(cursorRef.current), limit(51)));
      if (version !== requestRef.current) return;
      const more = snapshot.docs.slice(0, 50).map((entry) => ({ id:entry.id, ...entry.data() }));
      setLogs((previous) => [...previous, ...more.filter((entry) => !previous.some((old) => old.id === entry.id))]);
      setUsers((previous) => [...new Map([...previous, ...more.map((entry) => ({uid:entry.userId,name:entry.userName || entry.userEmail || 'Usuario'}))].map((user) => [user.uid,user])).values()]);
      if (more.length) cursorRef.current = snapshot.docs[more.length - 1];
      setHasMore(snapshot.size > 50);
    } catch {
      if (version === requestRef.current) setLoadError('No se pudieron cargar más registros. Puedes reintentar.');
    } finally {
      if (version === requestRef.current) { busyRef.current = false; setLoadingMore(false); }
    }
  };

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
        details.notaPedido?.toLowerCase().includes(s) ||
        details.cliente?.toLowerCase().includes(s) ||
        log.userName?.toLowerCase().includes(s) ||
        Object.values(log.movements || {}).some((movement) =>
          movement.sku?.toLowerCase().includes(s) || movement.productName?.toLowerCase().includes(s))
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
          Consulta el historial por bloques de 50 registros. Los filtros y la exportación usan los registros cargados.
        </p>
      </div>

      {loadError && <div role="alert" className="alert alert-danger">{loadError}</div>}
      <button className="btn btn-secondary mb-3" onClick={() => setRefreshKey((key) => key + 1)} disabled={loadingMore}>Actualizar historial</button>
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
                  {log.movements && Object.keys(log.movements).length > 1 && (
                    <details style={{ marginTop: '8px' }}>
                      <summary>{Object.keys(log.movements).length} productos en esta operación</summary>
                      {Object.entries(log.movements).map(([id, movement]) => (
                        <div key={id} style={{ padding: '4px 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                          {movement.sku} · {movement.productName}: {movement.previousValue ?? 'Nuevo'} → {movement.newValue ?? 'Eliminado'}
                        </div>
                      ))}
                    </details>
                  )}
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
      <div className="d-flex align-items-center justify-content-between gap-3 mt-4">
        <span className="text-secondary">{logs.length} registros cargados · {filteredLogs.length} coinciden</span>
        {hasMore && <button className="btn btn-secondary" disabled={loadingMore} onClick={loadMore}>{loadingMore ? 'Cargando…' : 'Cargar 50 anteriores'}</button>}
      </div>
    </div>
  );
}
