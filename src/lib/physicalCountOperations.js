import {doc, FieldPath, runTransaction, serverTimestamp, setDoc, updateDoc} from 'firebase/firestore';
import {parseQuantity} from './validation';

const AUDIT_DOC_PATH = ['active_physical_audit', 'current'];

function getActorName(user) {
  return user?.displayName || user?.email || 'Usuario';
}

export async function resetPhysicalAuditSession(db, user, {sessionName, monthKey}) {
  if (!user?.uid) throw new Error('Debes iniciar sesión.');
  await setDoc(doc(db, ...AUDIT_DOC_PATH), {
    sessionName,
    monthKey,
    status: 'in_progress',
    counts: {},
    extraProducts: {},
    updatedByMap: {},
    lastUpdated: serverTimestamp(),
    lastUpdatedBy: getActorName(user),
  });
}

export async function keepPreviousPhysicalAuditMonth(db, user, {sessionName, monthKey}) {
  if (!user?.uid) throw new Error('Debes iniciar sesión.');
  await updateDoc(doc(db, ...AUDIT_DOC_PATH), {
    sessionName,
    monthKey,
    status: 'in_progress',
    lastUpdated: serverTimestamp(),
    lastUpdatedBy: getActorName(user),
  });
}

export async function savePhysicalCount(db, user, productId, value, {expected, delta = null} = {}) {
  if (!user?.uid) throw new Error('Debes iniciar sesión.');
  const quantity = parseQuantity(value);
  if (quantity < 0) throw new Error('El conteo no puede ser negativo.');
  const id = String(productId);
  const ref = doc(db, ...AUDIT_DOC_PATH);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await runTransaction(db, async transaction => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists()) throw new Error('La sesión aún no está disponible. Espera la sincronización.');
        const previous = parseQuantity(snapshot.data().counts?.[id] ?? 0);
        if (delta === null && previous !== expected) throw new Error('Otro usuario cambió este conteo. Revisa el valor actualizado antes de volver a guardarlo.');
        const next = delta === null ? quantity : Math.max(0, parseQuantity(previous + parseQuantity(delta)));
        transaction.update(ref,
          new FieldPath('counts', id), next,
          new FieldPath('updatedByMap', id), {userId:user.uid,userName:getActorName(user),time:new Date().toLocaleTimeString('es-CL',{hour:'2-digit',minute:'2-digit'})},
          'lastUpdated', serverTimestamp(), 'lastCountProductId', id,
          'lastUpdatedBy', getActorName(user));
        return next;
      });
    } catch(error) {
      if (error.code !== 'permission-denied' || attempt === 2) throw error;
    }
  }
}
