import { runTransaction, doc, collection, Timestamp } from 'firebase/firestore';
import { db, auth } from './firebase';

/**
 * Record a stock entry (cosecha, compra, devolucion).
 * Increments producto.cantidad and creates a movimiento.
 */
export async function recordStockEntry(
  productoId: string,
  productoNombre: string,
  cantidad: number,
  motivo: 'cosecha' | 'compra' | 'devolucion' | 'ajuste',
): Promise<void> {
  await runTransaction(db, async (tx) => {
    const prodRef = doc(db, 'productos', productoId);
    const snap = await tx.get(prodRef);
    if (!snap.exists()) throw new Error('Producto no encontrado');

    const current = snap.data().cantidad as number;
    tx.update(prodRef, {
      cantidad: current + cantidad,
      updatedAt: Timestamp.now(),
    });

    const movRef = doc(collection(db, 'movimientos'));
    tx.set(movRef, {
      tipo: 'entrada',
      productoId,
      productoNombre,
      cantidad,
      fecha: Timestamp.now(),
      motivo,
      vendedor: auth.currentUser?.email || '',
      createdBy: auth.currentUser?.uid || '',
      createdAt: Timestamp.now(),
    });
  });
}

/**
 * Record a sale. Decrements stock and creates a movimiento linked to a prospecto.
 * Throws if insufficient stock.
 */
export async function recordSale(
  productoId: string,
  productoNombre: string,
  cantidad: number,
  prospectoId?: string,
  prospectoLocal?: string,
  precioVenta?: number,
): Promise<void> {
  await runTransaction(db, async (tx) => {
    const prodRef = doc(db, 'productos', productoId);
    const snap = await tx.get(prodRef);
    if (!snap.exists()) throw new Error('Producto no encontrado');

    const current = snap.data().cantidad as number;
    if (current < cantidad) {
      throw new Error(`Stock insuficiente. Disponible: ${current}`);
    }

    tx.update(prodRef, {
      cantidad: current - cantidad,
      updatedAt: Timestamp.now(),
    });

    const movRef = doc(collection(db, 'movimientos'));
    tx.set(movRef, {
      tipo: 'salida',
      productoId,
      productoNombre,
      cantidad,
      fecha: Timestamp.now(),
      motivo: 'venta' as const,
      vendedor: auth.currentUser?.email || '',
      createdBy: auth.currentUser?.uid || '',
      createdAt: Timestamp.now(),
      ...(prospectoId ? { prospectoId, prospectoLocal } : {}),
      ...(precioVenta != null ? { precioVenta } : {}),
    });
  });
}

/**
 * Record a stock exit (merma, ajuste).
 */
export async function recordStockExit(
  productoId: string,
  productoNombre: string,
  cantidad: number,
  motivo: 'merma' | 'ajuste',
): Promise<void> {
  await runTransaction(db, async (tx) => {
    const prodRef = doc(db, 'productos', productoId);
    const snap = await tx.get(prodRef);
    if (!snap.exists()) throw new Error('Producto no encontrado');

    const current = snap.data().cantidad as number;
    if (current < cantidad) {
      throw new Error(`Stock insuficiente. Disponible: ${current}`);
    }

    tx.update(prodRef, {
      cantidad: current - cantidad,
      updatedAt: Timestamp.now(),
    });

    const movRef = doc(collection(db, 'movimientos'));
    tx.set(movRef, {
      tipo: 'salida',
      productoId,
      productoNombre,
      cantidad,
      fecha: Timestamp.now(),
      motivo,
      vendedor: auth.currentUser?.email || '',
      createdBy: auth.currentUser?.uid || '',
      createdAt: Timestamp.now(),
    });
  });
}
