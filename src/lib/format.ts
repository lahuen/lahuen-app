import type { Timestamp } from 'firebase/firestore';

export function formatDate(ts: Timestamp | null): string {
  if (!ts) return '';
  const d = ts.toDate();
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export function toInputDate(ts: Timestamp | null): string {
  if (!ts) return '';
  return ts.toDate().toISOString().split('T')[0];
}

export function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

export function isOverdue(ts: Timestamp | null): boolean {
  if (!ts) return false;
  const d = ts.toDate();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d <= today;
}

export function seguimientoLabel(ts: Timestamp | null, resultado: string): { text: string; cls: string } {
  if (!ts) return { text: '--', cls: 'text-tertiary' };
  const d = ts.toDate();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.ceil((d.getTime() - today.getTime()) / 86400000);

  if (resultado === 'cliente' || resultado === 'no_interesado') {
    return { text: formatDate(ts), cls: 'text-tertiary' };
  }
  if (diffDays < 0) return { text: `Vencido (${Math.abs(diffDays)}d)`, cls: 'text-danger' };
  if (diffDays === 0) return { text: 'Hoy', cls: 'text-warning' };
  if (diffDays <= 3) return { text: `En ${diffDays}d`, cls: 'text-warning' };
  return { text: formatDate(ts), cls: 'text-secondary' };
}

export function formatCurrency(n: number): string {
  return n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 });
}
