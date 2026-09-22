'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  subscribeToNotifications,
  markAsRead,
  markAllAsRead,
  timeAgo,
} from '../lib/notifications';

const typeIcons = {
  descuento: '📉',
  agregado: '📈',
  eliminado: '🗑️',
  editado: '✏️',
};

export default function NotificationBell() {
  const { currentUser } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  const unreadCount = notifications.filter(
    (n) => !n.readBy?.includes(currentUser?.uid)
  ).length;

  useEffect(() => {
    if (!currentUser) return;
    const unsubscribe = subscribeToNotifications((notifs) => {
      setNotifications(notifs);
    });
    return () => unsubscribe();
  }, [currentUser]);

  // Cerrar dropdown al hacer click fuera
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleMarkAllRead = () => {
    if (currentUser) {
      markAllAsRead(notifications, currentUser.uid);
    }
  };

  const handleNotificationClick = (notification) => {
    if (currentUser && !notification.readBy?.includes(currentUser.uid)) {
      markAsRead(notification.id, currentUser.uid);
    }
  };

  return (
    <div className="notification-bell" ref={dropdownRef}>
      <button
        className="notification-bell-btn"
        onClick={() => setIsOpen(!isOpen)}
        title="Notificaciones"
      >
        🔔
        {unreadCount > 0 && (
          <span className="notification-badge">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="notification-dropdown">
          <div className="notification-dropdown-header">
            <span className="notification-dropdown-title">
              Notificaciones
            </span>
            {unreadCount > 0 && (
              <button
                className="btn btn-sm btn-secondary"
                onClick={handleMarkAllRead}
              >
                Marcar leídas
              </button>
            )}
          </div>

          <div className="notification-list">
            {notifications.length === 0 ? (
              <div className="notification-empty">
                🔕 No hay notificaciones
              </div>
            ) : (
              notifications.map((notif) => (
                <div
                  key={notif.id}
                  className={`notification-item ${
                    !notif.readBy?.includes(currentUser?.uid) ? 'unread' : ''
                  }`}
                  onClick={() => handleNotificationClick(notif)}
                >
                  <span className="notification-item-icon">
                    {typeIcons[notif.type] || '📋'}
                  </span>
                  <div className="notification-item-content">
                    <div className="notification-item-message">
                      {notif.message}
                    </div>
                    <div className="notification-item-time">
                      {timeAgo(notif.timestamp)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
