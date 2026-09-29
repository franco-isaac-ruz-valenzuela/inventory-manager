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
  const role = canEdit ? 'admin' : 'viewer';
  const roleLabel = canEdit ? 'Editor / Admin' : 'Solo Lectura';

  const value = {
    currentUser,
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
