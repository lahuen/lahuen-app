import { collection, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import type { Prospecto, Producto, Lote } from './types';

const NOTIF_KEY = 'lahuen_notif_last';

export async function checkAndNotify(): Promise<void> {
  if (!('Notification' in window)) return;

  // Ask permission once
  if (Notification.permission === 'default') {
    await Notification.requestPermission();
  }
  if (Notification.permission !== 'granted') return;

  // Only check once per 12 hours
  const last = Number(localStorage.getItem(NOTIF_KEY) || '0');
  if (Date.now() - last < 12 * 60 * 60 * 1000) return;
  localStorage.setItem(NOTIF_KEY, String(Date.now()));

  const alerts: string[] = [];
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  tomorrow.setHours(23, 59, 59, 999);

  const [productoSnap, prospectoSnap, lotesSnap] = await Promise.all([
    getDocs(collection(db, 'productos')),
    getDocs(collection(db, 'prospectos')),
    getDocs(collection(db, 'lotes')),
  ]);

  // Stock expiring within 24h — check from lotes
  lotesSnap.docs.forEach(d => {
    const l = d.data() as Lote;
    if (l.vencimiento && l.cantidad > 0) {
      const vDate = l.vencimiento.toDate();
      if (vDate <= tomorrow && vDate >= now) {
        alerts.push(`${l.productoNombre} (lote ${l.numero}): ${l.cantidad} uds vence mañana`);
      }
    }
  });

  // Follow-ups due tomorrow
  prospectoSnap.docs.forEach(d => {
    const p = d.data() as Prospecto;
    if (p.resultado === 'cliente' || p.resultado === 'no_interesado') return;
    if (p.fechaSeguimiento) {
      const sDate = p.fechaSeguimiento.toDate();
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);
      const tomorrowEnd = new Date(todayStart.getTime() + 2 * 24 * 60 * 60 * 1000);
      if (sDate >= todayStart && sDate <= tomorrowEnd) {
        alerts.push(`Seguimiento: ${p.local}`);
      }
    }
  });

  if (!alerts.length) return;

  const body = alerts.length <= 3
    ? alerts.join('\n')
    : alerts.slice(0, 3).join('\n') + `\n+${alerts.length - 3} mas`;

  new Notification('Lahuen — Alertas', {
    body,
    icon: '/icon.svg',
    tag: 'lahuen-daily',
  });
}
