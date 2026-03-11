import type { Timestamp } from 'firebase/firestore';
import type { Lote } from './types';
import { getProductos, getLotes, getMovimientos } from './store';

export interface ProductMetrics {
  totalValue: number;
  weeklyVelocity: number;
  daysToStockout: number | null;
  lastMovementDate: Date | null;
  activeLotes: number;
  expiringLotes: number;
  expiredLotes: number;
}

export type LoteHealth = 'ok' | 'warning' | 'danger' | 'expired' | 'depleted';

const DAY_MS = 86400000;

export function computeDaysRemaining(vencimiento: Timestamp | null): number | null {
  if (!vencimiento) return null;
  return Math.ceil((vencimiento.toDate().getTime() - Date.now()) / DAY_MS);
}

export function computeLoteHealth(lote: Lote & { id: string }): LoteHealth {
  if (lote.cantidad <= 0) return 'depleted';
  const days = computeDaysRemaining(lote.vencimiento);
  if (days === null) return 'ok';
  if (days <= 0) return 'expired';
  if (days <= 7) return 'danger';
  if (days <= 14) return 'warning';
  return 'ok';
}

export function computeShelfLifePercent(fechaIngreso: Timestamp, vencimiento: Timestamp | null): number {
  if (!vencimiento) return 100;
  const start = fechaIngreso.toDate().getTime();
  const end = vencimiento.toDate().getTime();
  const totalLife = end - start;
  if (totalLife <= 0) return 0;
  const remaining = end - Date.now();
  return Math.max(0, Math.min(100, (remaining / totalLife) * 100));
}

// Memoization: recompute only when store arrays change (reference equality)
let _cachedMetrics: Map<string, ProductMetrics> | null = null;
let _prevProductos: unknown = null;
let _prevLotes: unknown = null;
let _prevMovimientos: unknown = null;

/** Single-pass computation of metrics for all products (memoized). */
export function computeAllProductMetrics(): Map<string, ProductMetrics> {
  const productos = getProductos();
  const lotes = getLotes();
  const movimientos = getMovimientos();

  // Return cached result if store data hasn't changed
  if (_cachedMetrics && productos === _prevProductos && lotes === _prevLotes && movimientos === _prevMovimientos) {
    return _cachedMetrics;
  }
  _prevProductos = productos;
  _prevLotes = lotes;
  _prevMovimientos = movimientos;
  const now = Date.now();
  const thirtyDaysAgo = now - 30 * DAY_MS;
  const weekMs = 7 * DAY_MS;
  const sevenDaysFromNow = now + 7 * DAY_MS;

  // Initialize metrics map
  const metrics = new Map<string, ProductMetrics>();
  for (const p of productos) {
    metrics.set(p.id, {
      totalValue: p.cantidad * p.precio,
      weeklyVelocity: 0,
      daysToStockout: null,
      lastMovementDate: null,
      activeLotes: 0,
      expiringLotes: 0,
      expiredLotes: 0,
    });
  }

  // Single pass over movimientos for velocity + last movement
  const salidas30d = new Map<string, number>();
  for (const m of movimientos) {
    const pid = m.productoId;
    const pm = metrics.get(pid);
    if (!pm) continue;

    const mDate = m.fecha.toDate();
    if (!pm.lastMovementDate || mDate > pm.lastMovementDate) {
      pm.lastMovementDate = mDate;
    }

    if (m.tipo === 'salida' && m.motivo !== 'anulacion' && mDate.getTime() >= thirtyDaysAgo) {
      salidas30d.set(pid, (salidas30d.get(pid) || 0) + m.cantidad);
    }
  }

  // Compute velocity and days-to-stockout
  const weeksInPeriod = Math.max(1, (now - thirtyDaysAgo) / weekMs);
  for (const p of productos) {
    const pm = metrics.get(p.id)!;
    const totalSalidas = salidas30d.get(p.id) || 0;
    pm.weeklyVelocity = Math.round((totalSalidas / weeksInPeriod) * 10) / 10;
    if (pm.weeklyVelocity > 0 && p.cantidad > 0) {
      pm.daysToStockout = Math.round(p.cantidad / (pm.weeklyVelocity / 7));
    }
  }

  // Single pass over lotes
  for (const l of lotes) {
    const pm = metrics.get(l.productoId);
    if (!pm) continue;
    if (l.cantidad <= 0) continue;

    pm.activeLotes++;
    if (l.vencimiento) {
      const vTime = l.vencimiento.toDate().getTime();
      if (vTime <= now) {
        pm.expiredLotes++;
      } else if (vTime <= sevenDaysFromNow) {
        pm.expiringLotes++;
      }
    }
  }

  _cachedMetrics = metrics;
  return metrics;
}

export function computeProductMetrics(productoId: string): ProductMetrics {
  const all = computeAllProductMetrics();
  return all.get(productoId) || {
    totalValue: 0,
    weeklyVelocity: 0,
    daysToStockout: null,
    lastMovementDate: null,
    activeLotes: 0,
    expiringLotes: 0,
    expiredLotes: 0,
  };
}
