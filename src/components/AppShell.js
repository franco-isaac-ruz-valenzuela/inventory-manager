'use client';

import { AuthProvider, useAuth } from '../contexts/AuthContext';
import Sidebar from '../components/Sidebar';
import NotificationBell from '../components/NotificationBell';
import { useState } from 'react';
import { usePathname } from 'next/navigation';

function AppContent({ children }) {
  const { currentUser, loading } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();

  // Loading state
  if (loading) {
    return (
      <div className="loading-page">
        <div className="spinner" />
      </div>
    );
  }

  // Si no hay sesión y no estamos en login, mostrar login
  if (!currentUser && pathname !== '/login') {
    // Redirect a login
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
    return (
      <div className="loading-page">
        <div className="spinner" />
      </div>
    );
  }

  // Si estamos en login, no mostrar sidebar
  if (pathname === '/login') {
    return <>{children}</>;
  }

  // Page titles
  const pageTitles = {
    '/': 'Dashboard',
    '/inventario': 'Inventario',
    '/comparar': 'Comparar Excel',
    '/escaner': 'Escáner',
    '/reportes': 'Reportes',
    '/historial': 'Historial de Actividad',
  };

  return (
    <div className="app-layout">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            className="mobile-menu-btn"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label="Abrir menú de navegación"
          >
            <i className="bi bi-list" style={{ fontSize: '1.4rem' }}></i>
          </button>
          <div className="topbar-brand">
            <img
              src="/logo.jpg"
              alt="LEKER"
              className="topbar-logo"
            />
            <span className="topbar-brand-title">LEKER</span>
            <span className="topbar-divider">/</span>
            <span className="topbar-title">{pageTitles[pathname] || 'Inventarios'}</span>
          </div>
        </div>
        <div className="topbar-actions">
          <NotificationBell />
          {currentUser && (
            <div className="topbar-user-badge">
              <span className="topbar-user-dot" />
              <span>{currentUser.displayName || currentUser.email?.split('@')[0]}</span>
            </div>
          )}
        </div>
      </div>

      <main className="main-content">
        {children}
      </main>
    </div>
  );
}

export default function AppShell({ children }) {
  return (
    <AuthProvider>
      <AppContent>{children}</AppContent>
    </AuthProvider>
  );
}
