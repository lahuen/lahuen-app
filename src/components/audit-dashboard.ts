import { collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { esc } from '../lib/sanitize';
import type { AuditEntry } from '../lib/types';

export function renderAuditDashboard(container: HTMLElement): (() => void) | null {
  container.innerHTML = `
    <div class="page">
      <h1 class="text-title" style="margin-bottom:var(--sp-4);">Registro de cambios</h1>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Usuario</th>
              <th>Accion</th>
              <th>Coleccion</th>
              <th>Registro</th>
              <th>Detalle</th>
            </tr>
          </thead>
          <tbody id="audit-tbody">
            <tr><td colspan="6" class="empty-state"><p>Cargando...</p></td></tr>
          </tbody>
        </table>
      </div>

      <!-- Mobile cards view -->
      <div class="audit-cards" id="audit-cards"></div>
    </div>
  `;

  const q2 = query(collection(db, 'audit_log'), orderBy('timestamp', 'desc'), limit(200));
  const unsub = onSnapshot(q2, (snap) => {
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as AuditEntry & { id: string }));
    renderTable(items);
    renderCards(items);
  }, () => {
    document.getElementById('audit-tbody')!.innerHTML =
      '<tr><td colspan="6" class="empty-state"><p>Sin permisos para ver este registro.</p></td></tr>';
    document.getElementById('audit-cards')!.innerHTML =
      '<div class="empty-state"><p>Sin permisos para ver este registro.</p></div>';
  });

  function actionBadge(action: string) {
    if (action === 'create') return 'badge-success';
    if (action === 'delete') return 'badge-danger';
    return 'badge-info';
  }

  function renderTable(items: (AuditEntry & { id: string })[]) {
    const tbody = document.getElementById('audit-tbody')!;
    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><p>Sin entradas</p></td></tr>';
      return;
    }
    tbody.innerHTML = items.map(i => {
      const dt = i.timestamp?.toDate().toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) || '';
      return `<tr>
        <td class="text-xs text-secondary">${esc(dt)}</td>
        <td class="text-xs">${esc(i.userEmail.split('@')[0])}</td>
        <td><span class="badge ${actionBadge(i.action)}">${esc(i.action)}</span></td>
        <td class="text-xs text-secondary">${esc(i.collection)}</td>
        <td class="text-xs">${esc(i.docLabel)}</td>
        <td class="text-xs text-secondary">${esc(i.changes || '')}</td>
      </tr>`;
    }).join('');
  }

  function renderCards(items: (AuditEntry & { id: string })[]) {
    const cardsEl = document.getElementById('audit-cards')!;
    if (!items.length) { cardsEl.innerHTML = ''; return; }
    cardsEl.innerHTML = items.map(i => {
      const dt = i.timestamp?.toDate().toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) || '';
      return `<div class="card" style="margin-bottom:var(--sp-2);padding:var(--sp-3);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--sp-1);">
          <strong class="text-xs">${esc(i.docLabel)}</strong>
          <span class="badge ${actionBadge(i.action)}">${esc(i.action)}</span>
        </div>
        <div class="text-xs text-secondary">${esc(i.userEmail.split('@')[0])} &middot; ${esc(dt)} &middot; ${esc(i.collection)}</div>
        ${i.changes ? `<div class="text-xs text-tertiary" style="margin-top:2px;">${esc(i.changes)}</div>` : ''}
      </div>`;
    }).join('');
  }

  return () => unsub();
}
