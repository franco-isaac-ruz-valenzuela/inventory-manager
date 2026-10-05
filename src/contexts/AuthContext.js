'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { auth } from '../lib/firebase';
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';

const AuthContext = createContext({});

export function useAuth() {
  return useContext(AuthContext);
}

/**
 * Verifica si el usuario actual tiene permisos de edición (Admin / Editor).
 * Regla de negocio: Solo franco.ruz.valenzuela@gmail.com y M.silva pueden editar.
 * Todos los demás usuarios tienen perfil de solo lectura / consulta.
 */
export function checkCanEdit(user) {
  if (!user) return false;
  const email = (user.email || '').toLowerCase().trim();
  const displayName = (user.displayName || '').toLowerCase().trim();

  // 1. Franco
  if (email === 'franco.ruz.valenzuela@gmail.com' || email.startsWith('franco.ruz.valenzuela@')) {
    return true;
  }

  // 2. M.silva (coincidencia por email o nombre de usuario)
  if (
    email.startsWith('m.silva@') ||
    email.startsWith('msilva@') ||
    email.includes('m.silva') ||
    email.includes('msilva') ||
    displayName.includes('m.silva') ||
    displayName.includes('m silva') ||
    displayName.includes('msilva')
  ) {
    return true;
  }

  return false;
}

/**
 * Retorna el nombre visible del usuario en el sistema.
 * Para m.silva -> "Jefe de Bodega"
 * Para franco.ruz.valenzuela -> "Franco Ruz"
 */
export function getUserDisplayName(user) {
  if (!user) return 'Usuario';
  if (typeof user === 'string') {
    const s = user.toLowerCase().trim();
    if (s.includes('msilva') || s.includes('m.silva') || s.includes('jefe de bodega')) return 'Jefe de Bodega';
    if (s.includes('franco.ruz')) return 'Franco Ruz';
    return user;
  }

  const email = (user.email || '').toLowerCase().trim();
  const displayName = (user.displayName || '').trim();

  // 1. M. Silva -> Jefe de Bodega
  if (
    email.startsWith('m.silva@') ||
    email.startsWith('msilva@') ||
    email.includes('m.silva') ||
    email.includes('msilva') ||
    displayName.toLowerCase().includes('m.silva') ||
    displayName.toLowerCase().includes('m silva') ||
    displayName.toLowerCase().includes('msilva') ||
    displayName.toLowerCase().includes('jefe de bodega')
  ) {
    return 'Jefe de Bodega';
  }

  // 2. Franco
  if (
    email === 'franco.ruz.valenzuela@gmail.com' ||
    email.startsWith('franco.ruz.valenzuela@') ||
    email.includes('franco.ruz')
  ) {
    return displayName && displayName.toLowerCase() !== 'usuario' ? displayName : 'Franco Ruz';
  }

  // 3. Display name personalizado si existe y no es genérico
  if (displayName && displayName.toLowerCase() !== 'usuario') {
    return displayName;
  }

  // 4. Nombre derivado del correo
  if (user.email) {
    const prefix = user.email.split('@')[0];
    return prefix.charAt(0).toUpperCase() + prefix.slice(1);
  }

  return 'Usuario';
}

/**
 * Retorna la inicial para el avatar del usuario.
 * Para m.silva -> "M"
 */
export function getUserInitial(user) {
  if (!user) return '?';
  const email = (typeof user === 'string' ? user : user.email || '').toLowerCase().trim();
  if (email.includes('msilva') || email.includes('m.silva')) {
    return 'M';
  }
  if (email.includes('franco')) {
    return 'F';
  }
  if (typeof user === 'object' && user.displayName && user.displayName.toLowerCase() !== 'usuario') {
    return user.displayName.charAt(0).toUpperCase();
  }
  if (email) {
    return email.charAt(0).toUpperCase();
  }
  return 'U';
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);

  function login(email, password) {
    return signInWithEmailAndPassword(auth, email, password);
  }

  function logout() {
    return signOut(auth);
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const canEdit = checkCanEdit(currentUser);
  const userDisplayName = getUserDisplayName(currentUser);
  const userInitial = getUserInitial(currentUser);
  const role = canEdit ? 'admin' : 'viewer';
  const roleLabel = canEdit ? 'Editor / Admin' : 'Solo Lectura';

  const value = {
    currentUser,
    userDisplayName,
    userInitial,
    canEdit,
    role,
    roleLabel,
    isEditor: canEdit,
    login,
    logout,
    loading,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
