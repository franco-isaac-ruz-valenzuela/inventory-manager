import { collection, doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { getUserDisplayName } from '../contexts/AuthContext';
import { parseQuantity, validateProduct } from './validation';

// A single immutable operation record authorizes all product writes in this transaction.
// This keeps stock, evidence and optional order/session records atomic.
export async function commitInventoryChanges(changes, user, options = {}) {
  if (!user?.uid) throw new Error('Debes iniciar sesión.');
  if (!changes.length || changes.length > 100) throw new Error('La operación debe incluir entre 1 y 100 productos. Divide operaciones mayores antes de continuar.');
  if (changes.filter((change) => change.kind === 'delete').length > 5) throw new Error('Para conservar el respaldo y la auditoría, elimina como máximo 5 productos por operación. No se aplicó ningún cambio.');
  const ids = changes.map((change) => change.id);
  if (new Set(ids).size !== ids.length) throw new Error('Un producto está repetido en la operación.');
  const operationRef = doc(collection(db, 'audit_log'));
  const refs = changes.map((change) => doc(db, 'products', change.id));
  const orderRef = options.orderNumber
    ? doc(db, 'order_receipts', encodeURIComponent(options.orderNumber.trim().toUpperCase()))
    : null;
  if (options.orderNumber && options.orderNumber.length > 100) throw new Error('La nota de pedido es demasiado larga.');
  // Rules compare audit evidence with the committed stock. A concurrent commit
  // can make that evidence stale before the SDK reports a conflict. Retry from
  // fresh reads, while preserving all permission checks and the same receipt ID.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await runTransaction(db, async (transaction) => {
    // All reads precede writes. Firebase may retry this callback on concurrent changes.
    const order = orderRef ? await transaction.get(orderRef) : null;
    if (order?.exists()) throw new Error('Esta nota de pedido ya fue aplicada. No se descontó nuevamente.');
    const snapshots = [];
    for (const ref of refs) snapshots.push(await transaction.get(ref));
    const movements = {};
    const results = changes.map((change, index) => {
      const snapshot = snapshots[index];
      const previous = snapshot.exists() ? snapshot.data() : null;
      if (change.kind === 'create' && previous) throw new Error('El producto ya existe.');
      if (change.kind !== 'create' && !previous) throw new Error('Un producto ya no existe. Actualiza la página.');
      const previousQuantity = previous ? parseQuantity(previous.quantity) : null;
      if (change.expectedQuantity !== undefined && previousQuantity !== parseQuantity(change.expectedQuantity)) {
        throw new Error(`El stock de ${previous.sku} cambió mientras trabajabas. Actualiza y revisa antes de aplicar.`);
      }
      if (change.expectedProduct && ['sku', 'name', 'category'].some((key) => (previous[key] || '') !== (change.expectedProduct[key] || ''))) {
        throw new Error('El producto fue editado por otro usuario. Vuelve a abrirlo.');
      }
      let next = null;
      if (change.kind !== 'delete') {
        const quantity = change.kind === 'delta'
          ? parseQuantity(previousQuantity + parseQuantity(change.delta))
          : parseQuantity(change.data.quantity);
        next = validateProduct({ ...previous, ...change.data, quantity });
      }
      movements[change.id] = {
        sku: next?.sku || previous.sku,
        productName: next?.name || previous.name,
        previousValue: previousQuantity,
        newValue: next?.quantity ?? null,
        kind: change.kind,
      };
      return { id: change.id, previous, next };
    });
    const timestamp = serverTimestamp();
    transaction.set(operationRef, {
      action: options.action || 'producto_editado',
      userId: user.uid,
      userName: getUserDisplayName(user),
      userEmail: user.email || '',
      timestamp,
      movements,
      details: {
        ...(results.length === 1 ? movements[results[0].id] : {}),
        description: options.description || `Actualizó ${results.length} producto(s)`,
        notaPedido: options.orderNumber || '',
        cliente: options.customer || '',
      },
    });
    results.forEach((result, index) => {
      if (!result.next) {
        transaction.set(doc(db, 'product_deletions', result.id), {
          productData: result.previous,
          operationId: operationRef.id,
          userId: user.uid,
          timestamp,
        });
        transaction.delete(refs[index]);
      } else {
        const payload = { ...result.next, lastUpdated: timestamp, updatedBy: user.uid, lastMutationId: operationRef.id };
        if (!result.previous) payload.createdAt = timestamp;
        if (result.previous) transaction.update(refs[index], payload);
        else transaction.set(refs[index], payload);
      }
    });
    if (orderRef) transaction.set(orderRef, { number: options.orderNumber, userId: user.uid, timestamp, operationId: operationRef.id });
    if (options.session) transaction.set(doc(collection(db, 'inventory_sessions')), {
      ...options.session, createdBy: user.uid, createdAt: timestamp, operationId: operationRef.id,
    });
    return results;
      });
    } catch (error) {
      if (error.code !== 'permission-denied' || attempt === 2) throw error;
    }
  }
}

export async function adjustProductStock(productId, delta, user, options = {}) {
  return (await commitInventoryChanges([{ id: productId, kind: 'delta', delta }], user, {
    action: delta > 0 ? 'cantidad_agregada' : 'cantidad_descontada', ...options,
  }))[0];
}
