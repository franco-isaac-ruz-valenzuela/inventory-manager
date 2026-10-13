import { collection, doc, runTransaction, serverTimestamp } from 'firebase/firestore';

export const ADMIN_UID = 'TadrO5T20Ka4g1vRUfDZBeNl5q22';
export const EDITOR_UIDS = [ADMIN_UID, 'M5qscStYVWcZsm1gSFF2sMmN3Ek1'];

export async function saveUserAccess(db, admin, entry) {
  if (admin?.uid !== ADMIN_UID) throw new Error('Solo Franco puede administrar accesos.');
  const uid = String(entry.uid || '').trim();
  const email = String(entry.email || '').trim().toLowerCase();
  const name = String(entry.name || '').trim();
  if (!uid || uid.length > 128 || uid.includes('/') || /[\u0000-\u001f]/.test(uid)) throw new Error('UID inválido.');
  if (EDITOR_UIDS.includes(uid)) throw new Error('Los permisos de los editores se administran por separado.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('Correo inválido.');
  if (!name || name.length > 200 || typeof entry.enabled !== 'boolean') throw new Error('Datos del acceso inválidos.');
  const accessRef = doc(db, 'authorized_users', uid);
  const auditRef = doc(collection(db, 'audit_log'));
  await runTransaction(db, async (transaction) => {
    const previous = await transaction.get(accessRef);
    if (entry.expectedEnabled !== undefined && previous.data()?.enabled !== entry.expectedEnabled) throw new Error('El acceso cambió. Actualiza la lista antes de continuar.');
    if (entry.isNew && previous.exists()) throw new Error('Ese UID ya está registrado. Edita su acceso en la lista.');
    const timestamp = serverTimestamp();
    transaction.set(auditRef, {action:'acceso_actualizado',userId:admin.uid,userEmail:admin.email,userName:admin.displayName || admin.email,timestamp,details:{targetUserId:uid,enabled:entry.enabled,description:`${entry.enabled ? 'Autorizó' : 'Revocó'} acceso de ${email}`}});
    transaction.set(accessRef, {enabled:entry.enabled,email,name,updatedAt:timestamp,updatedBy:admin.uid,operationId:auditRef.id});
  });
}
