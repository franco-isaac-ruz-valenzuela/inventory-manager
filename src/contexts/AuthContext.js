'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { auth, db } from '../lib/firebase';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
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
  return ['M5qscStYVWcZsm1gSFF2sMmN3Ek1', 'TadrO5T20Ka4g1vRUfDZBeNl5q22'].includes(user.uid);
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
    if (s === 'msilva@leker.cl') return 'Jefe de Bodega';
    if (s === 'franco.ruz.valenzuela@gmail.com') return 'Franco Ruz';
    return user;
  }

  const email = (user.email || '').toLowerCase().trim();
  const displayName = (user.displayName || '').trim();

  // 1. M. Silva -> Jefe de Bodega
  if (user.uid === 'M5qscStYVWcZsm1gSFF2sMmN3Ek1') {
    return 'Jefe de Bodega';
  }

  // 2. Franco
  if (
    email === 'franco.ruz.valenzuela@gmail.com'
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
  const [accessError, setAccessError] = useState('');

  function login(email, password) {
    setAccessError('');
    return signInWithEmailAndPassword(auth, email, password);
  }

  function logout() {
    return signOut(auth);
  }

  useEffect(() => {
    let generation = 0;
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      const version = ++generation;
      setCurrentUser(null);
      setLoading(true);
      try {
        if (user && !checkCanEdit(user)) {
          const membership = await getDoc(doc(db, 'authorized_users', user.uid));
          if (!membership.exists() || membership.data().enabled !== true) {
            if (version !== generation) return;
            setAccessError('Tu cuenta no está autorizada para acceder al inventario. Contacta al administrador.');
            await signOut(auth);
            return;
          }
        }
        if (version === generation) setCurrentUser(user);
      } catch {
        if (version === generation) setAccessError('No se pudo comprobar el acceso de tu cuenta. Vuelve a iniciar sesión.');
      } finally {
        if (version === generation) setLoading(false);
      }
    });

    return unsubscribe;
  }, []);

  const canEdit = checkCanEdit(currentUser);
  useEffect(() => {
    if (!currentUser || checkCanEdit(currentUser)) return;
    return onSnapshot(doc(db, 'authorized_users', currentUser.uid), snapshot => {
      if (!snapshot.exists() || snapshot.data().enabled !== true) {
        setAccessError('El administrador revocó el acceso de esta cuenta.');
        signOut(auth).catch(() => setCurrentUser(null));
      }
    }, () => {
      setAccessError('No se pudo verificar la autorización. Vuelve a iniciar sesión.');
      signOut(auth).catch(() => setCurrentUser(null));
    });
  }, [currentUser?.uid]);
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
    accessError,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
