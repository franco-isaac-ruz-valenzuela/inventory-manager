'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { db } from '../lib/firebase';
import { collection, query, orderBy, limit, onSnapshot, getCountFromServer } from 'firebase/firestore';
import { timeAgo } from '../lib/notifications';
import { getActionStyle, getActionMessage } from '../lib/auditLog';
import { isLowStock, getLowStockThreshold } from '../lib/stockRules';

export default function DashboardPage() {
  const [stats, setStats] = useState({
    totalProducts: 0,
    lowStock: 0,
    lowStockByCategory: {},
    sessions: 0,
  });
  const [showLowStockModal, setShowLowStockModal] = useState(false);
  const [recentActivity, setRecentActivity] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Listen to products collection for stats
    const unsubProducts = onSnapshot(collection(db, 'products'), (snapshot) => {
      let total = 0;
      let low = 0;
      const byCat = {};
      snapshot.forEach((doc) => {
        total++;
        const data = doc.data();
        if (isLowStock(data)) {
          low++;
          const cat = (data.category || 'SIN CATEGORÍA').toUpperCase();
          byCat[cat] = (byCat[cat] || 0) + 1;
        }
      });
      setStats((prev) => ({ ...prev, totalProducts: total, lowStock: low, lowStockByCategory: byCat }));
      setLoading(false);
    });

    // Listen to recent audit log
    const auditQuery = query(
      collection(db, 'audit_log'),
      orderBy('timestamp', 'desc'),
      limit(15)
    );
    const unsubAudit = onSnapshot(auditQuery, (snapshot) => {
      const activities = [];
      snapshot.forEach((doc) => {
        activities.push({ id: doc.id, ...doc.data() });
      });
      setRecentActivity(activities);
    });

    // Count sessions
    getCountFromServer(collection(db, 'inventory_sessions')).then((snap) => {
      setStats((prev) => ({ ...prev, sessions: snap.data().count }));
    }).catch(() => {});

    return () => {
      unsubProducts();
      unsubAudit();
    };
  }, []);

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
        <h1 className="page-title">Dashboard</h1>
        <p className="page-description">Resumen general del inventario</p>
      </div>

      {/* Stats */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon icon-blue">
            <i className="bi bi-box-seam-fill"></i>
          </div>
          <div className="stat-value">{stats.totalProducts}</div>
          <div className="stat-label">Productos totales</div>
        </div>
        <div
          className="stat-card"
          onClick={() => setShowLowStockModal(true)}
          style={{ cursor: 'pointer', transition: 'all 0.2s ease' }}
          title="Haz clic para ver el desglose por categoría"
        >
          <div className="d-flex justify-content-between align-items-start">
            <div className="stat-icon icon-amber">
              <i className="bi bi-exclamation-triangle-fill"></i>
            </div>
            <span className="badge bg-warning text-dark font-monospace" style={{ fontSize: '10px' }}>
              Ver detalle →
            </span>
          </div>
          <div className="stat-value" style={{ color: stats.lowStock > 0 ? 'var(--warning)' : 'inherit' }}>
            {stats.lowStock}
          </div>
          <div className="stat-label">Stock bajo (por categoría)</div>
          <div className="text-secondary mt-1" style={{ fontSize: '11px', lineHeight: 1.3 }}>
            Onduladas/Alveolar &lt;50 • Perfiles &lt;100 • Industrial &lt;20 • Compacto &lt;3 • Accesorios/Rollos &lt;5
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon icon-purple">
            <i className="bi bi-arrow-left-right"></i>
          </div>
          <div className="stat-value">{stats.sessions}</div>
          <div className="stat-label">Comparaciones realizadas</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon icon-emerald">
            <i className="bi bi-clock-history"></i>
          </div>
          <div className="stat-value">{recentActivity.length}</div>
          <div className="stat-label">Actividades recientes</div>
        </div>
      </div>

      {/* Activity Feed */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <i className="bi bi-broadcast" style={{ color: 'var(--danger)' }}></i> Actividad en Vivo
          </h2>
          <span className="badge badge-info">Tiempo real</span>
        </div>

        {recentActivity.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <i className="bi bi-clipboard2-data"></i>
            </div>
            <div className="empty-state-title">Sin actividad aún</div>
            <div className="empty-state-text">
              Las acciones del equipo aparecerán aquí en tiempo real
            </div>
          </div>
        ) : (
          <div className="activity-feed">
            {recentActivity.map((activity) => {
              const style = getActionStyle(activity.action);
              const message = getActionMessage(
                activity.action,
                activity.userName,
                activity.details || {}
              );

              return (
                <div key={activity.id} className="activity-item">
                  <div
                    className="activity-icon"
                    style={{ background: `${style.color}15`, color: style.color }}
                  >
                    <i className={style.icon}></i>
                  </div>
                  <div className="activity-content">
                    <div className="activity-message">{message}</div>
                    <div className="activity-time">
                      {timeAgo(activity.timestamp)}
                    </div>
                  </div>
                  <span
                    className="badge"
                    style={{
                      background: `${style.color}15`,
                      color: style.color,
                      alignSelf: 'flex-start',
                    }}
                  >
                    {style.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal Desglose Stock Bajo por Categoría */}
      {showLowStockModal && (
        <div className="modal-overlay" onClick={() => setShowLowStockModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', maxWidth: '520px' }}>
            <div className="modal-header">
              <div>
                <h2 className="modal-title">⚠️ Stock Bajo por Categoría</h2>
                <p className="text-secondary small mb-0 mt-1">
                  Total de {stats.lowStock} productos que requieren reposición
                </p>
              </div>
              <button className="modal-close" onClick={() => setShowLowStockModal(false)}>
                ✕
              </button>
            </div>
            <div className="modal-body p-3">
              <div className="list-group list-group-flush mb-3">
                {Object.entries(stats.lowStockByCategory || {})
                  .sort(([, a], [, b]) => b - a)
                  .map(([cat, count]) => {
                    const threshold = getLowStockThreshold(cat);
                    return (
                      <div key={cat} className="list-group-item bg-dark border-secondary text-light d-flex justify-content-between align-items-center py-2 px-3">
                        <div>
                          <strong className="d-block text-truncate" style={{ maxWidth: '280px' }}>{cat}</strong>
                          <small className="text-secondary">Alerta si hay &lt; {threshold} uds</small>
                        </div>
                        <span className="badge bg-warning text-dark fs-6 px-3 py-1 font-monospace">
                          {count} {count === 1 ? 'producto' : 'productos'}
                        </span>
                      </div>
                    );
                  })}
              </div>
              <div className="p-2 rounded text-secondary small" style={{ background: 'rgba(255, 255, 255, 0.03)', fontSize: '12px' }}>
                💡 <em>Pinturas y Adhesivos están configuradas para no alertar según las reglas del negocio.</em>
              </div>
            </div>
            <div className="modal-footer d-flex gap-2">
              <button type="button" className="btn btn-secondary flex-grow-1" onClick={() => setShowLowStockModal(false)} style={{ minHeight: '40px' }}>
                Cerrar
              </button>
              <Link href="/inventario" className="btn btn-primary flex-grow-1 text-center text-decoration-none d-flex align-items-center justify-content-center" style={{ minHeight: '40px' }}>
                Ir a Inventario
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
