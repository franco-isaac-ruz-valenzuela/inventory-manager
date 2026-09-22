import { db } from './firebase';
import {
  collection,
  addDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  updateDoc,
  doc,
  arrayUnion,
  serverTimestamp,
} from 'firebase/firestore';

/**
 * Enviar una notificación a todos los usuarios
 */
export async function sendNotification(type, message, user) {
  try {
    await addDoc(collection(db, 'notifications'), {
      type,
      message,
      userId: user.uid,
      userName: user.displayName || user.email,
      timestamp: serverTimestamp(),
      readBy: [],
    });
  } catch (error) {
    console.error('Error enviando notificación:', error);
  }
}

/**
 * Suscribirse a notificaciones en tiempo real
 * @param {function} callback - Función que recibe el array de notificaciones
 * @param {number} maxItems - Máximo de notificaciones a obtener
 * @returns {function} unsubscribe - Función para desuscribirse
 */
export function subscribeToNotifications(callback, maxItems = 50) {
  const q = query(
    collection(db, 'notifications'),
    orderBy('timestamp', 'desc'),
    limit(maxItems)
  );

  return onSnapshot(q, (snapshot) => {
    const notifications = [];
    snapshot.forEach((docSnap) => {
      notifications.push({ id: docSnap.id, ...docSnap.data() });
    });
    callback(notifications);
  });
}

/**
 * Marcar una notificación como leída
 */
export async function markAsRead(notificationId, userId) {
  try {
    const notifRef = doc(db, 'notifications', notificationId);
    await updateDoc(notifRef, {
      readBy: arrayUnion(userId),
    });
  } catch (error) {
    console.error('Error marcando como leída:', error);
  }
}

/**
 * Marcar todas las notificaciones como leídas para un usuario
 */
export async function markAllAsRead(notifications, userId) {
  try {
    const unread = notifications.filter(
      (n) => !n.readBy?.includes(userId)
    );
    await Promise.all(
      unread.map((n) => {
        const notifRef = doc(db, 'notifications', n.id);
        return updateDoc(notifRef, { readBy: arrayUnion(userId) });
      })
    );
  } catch (error) {
    console.error('Error marcando todas como leídas:', error);
  }
}

/**
 * Tiempo relativo legible
 */
export function timeAgo(timestamp) {
  if (!timestamp) return '';
  const now = new Date();
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const seconds = Math.floor((now - date) / 1000);

  if (seconds < 60) return 'hace un momento';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `hace ${days}d`;
  return date.toLocaleDateString('es-AR');
}
