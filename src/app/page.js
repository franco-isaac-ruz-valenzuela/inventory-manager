'use client';

import { useEffect, useState } from 'react';
import { db } from '../lib/firebase';
import { collection, query, orderBy, limit, onSnapshot, getCountFromServer } from 'firebase/firestore';
import { timeAgo } from '../lib/notifications';
import { getActionStyle, getActionMessage } from '../lib/auditLog';

export default function DashboardPage() {
  const [stats, setStats] = useState({
    totalProducts: 0,
    lowStock: 0,
    sessions: 0,
  });
  const [recentActivity, setRecentActivity] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Listen to products collection for stats
    const unsubProducts = onSnapshot(collection(db, 'products'), (snapshot) => {
      let total = 0;
      let low = 0;
      snapshot.forEach((doc) => {
        total++;
        const data = doc.data();
        if (data.quantity <= 5) low++;
      });
      setStats((prev) => ({ ...prev, totalProducts: total, lowStock: low }));
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
        <div className="stat-card">
          <div className="stat-icon icon-amber">
            <i className="bi bi-exclamation-triangle-fill"></i>
          </div>
          <div className="stat-value" style={{ color: stats.lowStock > 0 ? 'var(--warning)' : 'inherit' }}>
            {stats.lowStock}
          </div>
          <div className="stat-label">Stock bajo (≤5 uds)</div>
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
    </div>
  );
}
