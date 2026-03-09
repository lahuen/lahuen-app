import { runTransaction, doc, collection, Timestamp, getDocs, query, where, orderBy } from 'firebase/firestore';
import { db, auth } from './firebase';
import { logAudit } from './audit';
import { getMovimientos } from './store';

export interface LoteInfo {
  numero: string;
  vencimiento: Date | null;
  ubicacion: string;
}

function autoLoteNumero(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `L-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/**
 * Find the best lote for FEFO exit (earliest vencimiento with cantidad > 0).
 * Returns loteId or null if no lotes exist.
 */
async function findFefoLote(productoId: string): Promise<string | null> {
  const lotesSnap = await getDocs(
    query(collection(db, 'lotes'), where('productoId', '==', productoId), where('cantidad', '>', 0)),
  );
  if (lotesSnap.empty) return null;

  let best: { id: string; venc: Date | null } | null = null;
  for (const d of lotesSnap.docs) {
    const data = d.data();
    const venc = data.vencimiento ? data.vencimiento.toDate() : null;
    if (!best) {
      best = { id: d.id, venc };
    } else if (venc && (!best.venc || venc < best.venc)) {
      best = { id: d.id, venc };
    }
  }
  return best?.id || null;
}

/**
 * Record a stock entry (cosecha, compra, devolucion).
 * Creates a lote doc and increments producto.cantidad.
 */
export async function recordStockEntry(
  productoId: string,
  productoNombre: string,
  cantidad: number,
  motivo: 'cosecha' | 'compra' | 'devolucion' | 'ajuste',
  loteInfo?: LoteInfo,
): Promise<void> {
  const info = loteInfo || { numero: autoLoteNumero(), vencimiento: null, ubicacion: '' };
  let loteId = '';

  await runTransaction(db, async (tx) => {
    const prodRef = doc(db, 'productos', productoId);
    const snap = await tx.get(prodRef);
    if (!snap.exists()) throw new Error('Producto no encontrado');

    const current = snap.data().cantidad as number;
    tx.update(prodRef, {
      cantidad: current + cantidad,
      updatedAt: Timestamp.now(),
      updatedBy: auth.currentUser?.email || '',
    });

    const loteRef = doc(collection(db, 'lotes'));
    loteId = loteRef.id;
    tx.set(loteRef, {
      productoId,
      productoNombre,
      numero: info.numero,
      cantidad,
      vencimiento: info.vencimiento ? Timestamp.fromDate(info.vencimiento) : null,
      ubicacion: info.ubicacion,
      fechaIngreso: Timestamp.now(),
      createdBy: auth.currentUser?.uid || '',
      createdAt: Timestamp.now(),
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
      loteId,
    });
  });
  logAudit('update', 'productos', productoId, productoNombre, `entrada: +${cantidad} (${motivo}) lote=${info.numero}`);
}

/**
 * Record a sale. Decrements stock and creates a movimiento linked to a prospecto.
 * Uses FEFO lote selection if no loteId provided.
 */
export async function recordSale(
  productoId: string,
  productoNombre: string,
  cantidad: number,
  prospectoId?: string,
  prospectoLocal?: string,
  precioVenta?: number,
  loteId?: string,
): Promise<void> {
  // FEFO: find best lote if not specified
  const targetLoteId = loteId || await findFefoLote(productoId);

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
      updatedBy: auth.currentUser?.email || '',
    });

    // Decrement lote cantidad
    if (targetLoteId) {
      const loteRef = doc(db, 'lotes', targetLoteId);
      const loteSnap = await tx.get(loteRef);
      if (loteSnap.exists()) {
        const loteCurrent = loteSnap.data().cantidad as number;
        tx.update(loteRef, { cantidad: Math.max(0, loteCurrent - cantidad) });
      }
    }

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
      ...(targetLoteId ? { loteId: targetLoteId } : {}),
      ...(prospectoId ? { prospectoId, prospectoLocal } : {}),
      ...(precioVenta != null ? { precioVenta } : {}),
    });
  });
  logAudit('update', 'productos', productoId, productoNombre, `venta: -${cantidad}`);
}

/**
 * Record a stock exit (merma, ajuste).
 * Uses FEFO lote selection if no loteId provided.
 */
export async function recordStockExit(
  productoId: string,
  productoNombre: string,
  cantidad: number,
  motivo: 'merma' | 'ajuste',
  loteId?: string,
): Promise<void> {
  const targetLoteId = loteId || await findFefoLote(productoId);

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
      updatedBy: auth.currentUser?.email || '',
    });

    if (targetLoteId) {
      const loteRef = doc(db, 'lotes', targetLoteId);
      const loteSnap = await tx.get(loteRef);
      if (loteSnap.exists()) {
        const loteCurrent = loteSnap.data().cantidad as number;
        tx.update(loteRef, { cantidad: Math.max(0, loteCurrent - cantidad) });
      }
    }

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
      ...(targetLoteId ? { loteId: targetLoteId } : {}),
    });
  });
  logAudit('update', 'productos', productoId, productoNombre, `salida: -${cantidad} (${motivo})`);
}

/**
 * Anular (void) a movimiento by creating a reverse entry.
 * Adjusts producto and lote quantities accordingly.
 */
export async function recordStockAnulacion(movimientoId: string): Promise<void> {
  const movs = getMovimientos();
  const original = movs.find(m => m.id === movimientoId);
  if (!original) throw new Error('Movimiento no encontrado');
  if (original.motivo === 'anulacion') throw new Error('No se puede anular una anulacion');
  if (movs.some(m => m.anulacionDe === movimientoId)) throw new Error('Este movimiento ya fue anulado');

  const reverseTipo = original.tipo === 'entrada' ? 'salida' : 'entrada';

  await runTransaction(db, async (tx) => {
    const prodRef = doc(db, 'productos', original.productoId);
    const prodSnap = await tx.get(prodRef);
    if (!prodSnap.exists()) throw new Error('Producto no encontrado');

    const currentQty = prodSnap.data().cantidad as number;
    const newQty = reverseTipo === 'salida'
      ? currentQty - original.cantidad
      : currentQty + original.cantidad;

    if (newQty < 0) throw new Error(`Stock insuficiente para anular. Disponible: ${currentQty}`);

    tx.update(prodRef, {
      cantidad: newQty,
      updatedAt: Timestamp.now(),
      updatedBy: auth.currentUser?.email || '',
    });

    // Reverse lote quantity if applicable
    if (original.loteId) {
      const loteRef = doc(db, 'lotes', original.loteId);
      const loteSnap = await tx.get(loteRef);
      if (loteSnap.exists()) {
        const loteCurrent = loteSnap.data().cantidad as number;
        const loteNew = reverseTipo === 'salida'
          ? Math.max(0, loteCurrent - original.cantidad)
          : loteCurrent + original.cantidad;
        tx.update(loteRef, { cantidad: loteNew });
      }
    }

    const movRef = doc(collection(db, 'movimientos'));
    tx.set(movRef, {
      tipo: reverseTipo,
      productoId: original.productoId,
      productoNombre: original.productoNombre,
      cantidad: original.cantidad,
      fecha: Timestamp.now(),
      motivo: 'anulacion' as const,
      anulacionDe: movimientoId,
      vendedor: auth.currentUser?.email || '',
      createdBy: auth.currentUser?.uid || '',
      createdAt: Timestamp.now(),
      ...(original.loteId ? { loteId: original.loteId } : {}),
    });
  });
  logAudit('update', 'productos', original.productoId, original.productoNombre,
    `anulacion de ${original.tipo} ${original.cantidad} (${original.motivo})`);
}
