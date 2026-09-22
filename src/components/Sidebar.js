'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '../contexts/AuthContext';

const navItems = [
  { label: 'Navegación', type: 'section' },
  { href: '/', icon: 'bi bi-grid-1x2', label: 'Dashboard' },
  { href: '/inventario', icon: 'bi bi-box-seam', label: 'Inventario' },
  { href: '/comparar', icon: 'bi bi-file-earmark-diff', label: 'Comparar Excel' },
  { href: '/escaner', icon: 'bi bi-camera', label: 'Escáner' },
  { label: 'Registros', type: 'section' },
  { href: '/reportes', icon: 'bi bi-bar-chart-line', label: 'Reportes' },
  { href: '/historial', icon: 'bi bi-clock-history', label: 'Historial' },
];

export default function Sidebar({ isOpen, onClose }) {
  const pathname = usePathname();
  const { currentUser, logout } = useAuth();

  const handleLogout = async () => {
    try {
      await logout();
    } catch (error) {
      console.error('Error al cerrar sesión:', error);
    }
  };

  const userInitial = currentUser?.displayName
    ? currentUser.displayName.charAt(0).toUpperCase()
    : currentUser?.email?.charAt(0).toUpperCase() || '?';

  return (
    <>
      <div
        className={`sidebar-overlay ${isOpen ? 'show' : ''}`}
        onClick={onClose}
      />
      <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
        <div className="sidebar-logo">
          <img src="/logo.jpg" alt="LEKER" style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover' }} />
          <span className="sidebar-logo-text">LEKER Inventarios</span>
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item, index) => {
            if (item.type === 'section') {
              return (
                <div key={index} className="sidebar-section-label">
                  {item.label}
                </div>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`sidebar-link ${pathname === item.href ? 'active' : ''}`}
                onClick={onClose}
              >
                <i className={`${item.icon} sidebar-link-icon`} style={{ fontSize: '1.15rem' }} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-user">
          <div className="sidebar-user-avatar">{userInitial}</div>
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">
              {currentUser?.displayName || 'Usuario'}
            </div>
            <div className="sidebar-user-email">{currentUser?.email}</div>
          </div>
          <button
            className="sidebar-logout-btn"
            onClick={handleLogout}
            title="Cerrar sesión"
          >
            <i className="bi bi-box-arrow-right" style={{ fontSize: '1.2rem' }} />
          </button>
        </div>
      </aside>
    </>
  );
}
