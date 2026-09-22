import { db } from './firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

/**
 * Registra una acción en el log de auditoría
 * Se llama automáticamente desde todos los módulos del sistema
 * 
 * @param {string} action - Tipo de acción: "producto_agregado" | "producto_editado" | "producto_eliminado" | "cantidad_descontada" | "cantidad_agregada" | "escaneo" | "excel_subido" | "comparacion_realizada" | "reporte_descargado"
 * @param {object} user - Objeto del usuario { uid, email, displayName }
 * @param {object} details - Detalles de la acción { sku, productName, previousValue, newValue, description }
 */
export async function logAction(action, user, details = {}) {
  try {
    await addDoc(collection(db, 'audit_log'), {
      action,
      userId: user.uid,
      userName: user.displayName || user.email,
      userEmail: user.email,
      timestamp: serverTimestamp(),
      details: {
        sku: details.sku || '',
        productName: details.productName || '',
        previousValue: details.previousValue ?? null,
        newValue: details.newValue ?? null,
        description: details.description || '',
      },
    });
  } catch (error) {
    console.error('Error registrando auditoría:', error);
  }
}

/**
 * Genera un mensaje legible para la acción
 */
export function getActionMessage(action, userName, details) {
  const product = details.productName ? `${details.sku} (${details.productName})` : details.sku;

  const messages = {
    producto_agregado: `${userName} agregó el producto ${product}`,
    producto_editado: `${userName} editó el producto ${product}`,
    producto_eliminado: `${userName} eliminó el producto ${product}`,
    cantidad_descontada: `${userName} descontó ${details.previousValue - details.newValue} uds de ${product} (${details.previousValue} → ${details.newValue})`,
    cantidad_agregada: `${userName} agregó ${details.newValue - details.previousValue} uds a ${product} (${details.previousValue} → ${details.newValue})`,
    escaneo: details.found === false
      ? `${userName} escaneó el código ${details.sku} (No registrado)`
      : `${userName} escaneó el producto ${product}`,
    excel_subido: `${userName} subió un archivo Excel`,
    comparacion_realizada: `${userName} realizó una comparación de inventarios`,
    reporte_descargado: `${userName} descargó un reporte`,
  };

  return messages[action] || `${userName} realizó una acción: ${action}`;
}

/**
 * Colores e íconos por tipo de acción
 */
export function getActionStyle(action) {
  const styles = {
    producto_agregado: { color: '#10b981', icon: 'bi bi-plus-circle-fill', label: 'Agregado' },
    producto_editado: { color: '#f59e0b', icon: 'bi bi-pencil-square', label: 'Editado' },
    producto_eliminado: { color: '#ef4444', icon: 'bi bi-trash3-fill', label: 'Eliminado' },
    cantidad_descontada: { color: '#ef4444', icon: 'bi bi-dash-circle-fill', label: 'Descontado' },
    cantidad_agregada: { color: '#10b981', icon: 'bi bi-plus-circle-fill', label: 'Agregado Stock' },
    escaneo: { color: '#3b82f6', icon: 'bi bi-upc-scan', label: 'Escaneo' },
    excel_subido: { color: '#8b5cf6', icon: 'bi bi-file-earmark-excel-fill', label: 'Excel Subido' },
    comparacion_realizada: { color: '#8b5cf6', icon: 'bi bi-arrow-left-right', label: 'Comparación' },
    reporte_descargado: { color: '#6366f1', icon: 'bi bi-download', label: 'Reporte' },
  };

  return styles[action] || { color: '#6b7280', icon: 'bi bi-activity', label: 'Acción' };
}
