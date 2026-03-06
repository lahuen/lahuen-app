import type { Timestamp } from 'firebase/firestore';
import type { Prospecto, Producto, Movimiento } from './types';
import { formatDate } from './format';
import { getResultadoBadge } from './constants';

export interface AgendaEvent {
  id: string;
  date: Date;
  type: 'seguimiento' | 'visita' | 'vencimiento' | 'entrega';
  title: string;
  subtitle: string;
  badgeCls: string;
  badgeLabel: string;
  linkHash?: string;
}

export interface AgendaGroup {
  label: string;
  dateKey: string;
  isPast: boolean;
  isToday: boolean;
  events: AgendaEvent[];
}

// ── Build events from raw data ────────────────────────────────────────────

export function buildEvents(
  prospectos: (Prospecto & { id: string })[],
  productos: (Producto & { id: string })[],
  movimientos: (Movimiento & { id: string })[],
): AgendaEvent[] {
  const events: AgendaEvent[] = [];

  for (const p of prospectos) {
    if (p.resultado === 'no_interesado') continue;

    if (p.fechaSeguimiento) {
      const badge = getResultadoBadge(p.resultado);
      events.push({
        id: `seg-${p.id}`,
        date: p.fechaSeguimiento.toDate(),
        type: 'seguimiento',
        title: p.local,
        subtitle: `${p.contacto || 'Sin contacto'} · ${badge.label}`,
        badgeCls: 'badge-info',
        badgeLabel: 'Seguimiento',
        linkHash: `#editar/${p.id}`,
      });
    }

    if (p.fechaVisita) {
      events.push({
        id: `vis-${p.id}`,
        date: p.fechaVisita.toDate(),
        type: 'visita',
        title: p.local,
        subtitle: `Visita · ${p.zona || ''}`,
        badgeCls: 'badge-purple',
        badgeLabel: 'Visita',
        linkHash: `#editar/${p.id}`,
      });
    }
  }

  for (const p of productos) {
    if (p.vencimiento) {
      events.push({
        id: `ven-${p.id}`,
        date: p.vencimiento.toDate(),
        type: 'vencimiento',
        title: p.nombre,
        subtitle: `${p.cantidad} ${p.unidad} en stock`,
        badgeCls: 'badge-danger',
        badgeLabel: 'Vencimiento',
        linkHash: '#stock',
      });
    }
  }

  for (const m of movimientos) {
    if (m.motivo === 'venta' && m.prospectoLocal) {
      events.push({
        id: `ent-${m.id}`,
        date: m.fecha.toDate(),
        type: 'entrega',
        title: `${m.productoNombre} → ${m.prospectoLocal}`,
        subtitle: `${m.cantidad} unidades`,
        badgeCls: 'badge-success',
        badgeLabel: 'Entrega',
      });
    }
  }

  return events;
}

// ── Group by date ─────────────────────────────────────────────────────────

export function groupByDate(events: AgendaEvent[]): AgendaGroup[] {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const windowStart = new Date(now.getTime() - 30 * 86400000);
  const windowEnd = new Date(now.getTime() + 30 * 86400000);

  const filtered = events
    .filter(e => e.date >= windowStart && e.date <= windowEnd)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const groups = new Map<string, AgendaEvent[]>();

  for (const ev of filtered) {
    const key = ev.date.toISOString().split('T')[0];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(ev);
  }

  const todayKey = now.toISOString().split('T')[0];
  const tomorrow = new Date(now.getTime() + 86400000);
  const tomorrowKey = tomorrow.toISOString().split('T')[0];

  const result: AgendaGroup[] = [];

  for (const [dateKey, evts] of groups) {
    const d = new Date(dateKey + 'T00:00:00');
    const isPast = d < now;
    const isToday = dateKey === todayKey;
    let label: string;

    if (isToday) {
      label = 'Hoy';
    } else if (dateKey === tomorrowKey) {
      label = 'Mañana';
    } else {
      label = d.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' });
    }

    result.push({ label, dateKey, isPast: isPast && !isToday, isToday, events: evts });
  }

  return result;
}
