import { collection, onSnapshot, query, orderBy, where, limit, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { esc } from '../lib/sanitize';
import { buildEvents, groupByDate, type AgendaEvent, type AgendaGroup } from '../lib/agenda-data';
import type { Prospecto, Producto, Movimiento, Lote } from '../lib/types';

export function renderAgendaDashboard(container: HTMLElement): (() => void) | null {
  let prospectos: (Prospecto & { id: string })[] = [];
  let productos: (Producto & { id: string })[] = [];
  let movimientos: (Movimiento & { id: string })[] = [];
  let lotes: (Lote & { id: string })[] = [];
  let filterType = '';

  container.innerHTML = `
    <div class="page">
      <div class="toolbar" style="margin-bottom:var(--sp-4);">
        <h2 class="text-title" style="flex:1;">Agenda</h2>
        <select class="filter-select" id="agenda-filter-type">
          <option value="">Todos los eventos</option>
          <option value="seguimiento">Seguimientos</option>
          <option value="visita">Visitas</option>
          <option value="vencimiento">Vencimientos</option>
          <option value="entrega">Entregas</option>
        </select>
        <span id="agenda-count" class="badge badge-neutral">--</span>
      </div>
      <div id="agenda-timeline">
        <div class="empty-state"><p>Cargando...</p></div>
      </div>
    </div>
  `;

  const filterEl = document.getElementById('agenda-filter-type') as HTMLSelectElement;
  filterEl.addEventListener('change', () => { filterType = filterEl.value; rebuild(); });

  // Load movimientos once (not real-time, historical data)
  getDocs(query(collection(db, 'movimientos'), where('motivo', '==', 'venta'), orderBy('fecha', 'desc'), limit(50)))
    .then(snap => {
      movimientos = snap.docs.map(d => ({ id: d.id, ...d.data() } as Movimiento & { id: string }));
      rebuild();
    });

  // Real-time listeners for prospectos + productos
  const unsubP = onSnapshot(query(collection(db, 'prospectos'), orderBy('createdAt', 'desc')), snap => {
    prospectos = snap.docs.map(d => ({ id: d.id, ...d.data() } as Prospecto & { id: string }));
    rebuild();
  });

  const unsubS = onSnapshot(query(collection(db, 'productos'), orderBy('nombre')), snap => {
    productos = snap.docs.map(d => ({ id: d.id, ...d.data() } as Producto & { id: string }));
    rebuild();
  });

  const unsubL = onSnapshot(query(collection(db, 'lotes')), snap => {
    lotes = snap.docs.map(d => ({ id: d.id, ...d.data() } as Lote & { id: string }));
    rebuild();
  });

  function rebuild() {
    let events = buildEvents(prospectos, productos, movimientos, lotes);
    if (filterType) events = events.filter(e => e.type === filterType);

    const groups = groupByDate(events);
    const timeline = document.getElementById('agenda-timeline')!;
    const countEl = document.getElementById('agenda-count')!;
    const total = groups.reduce((sum, g) => sum + g.events.length, 0);
    countEl.textContent = total + ' eventos';

    if (!groups.length) {
      timeline.innerHTML = '<div class="empty-state"><p>Sin eventos en los proximos 30 dias.</p></div>';
      return;
    }

    timeline.innerHTML = groups.map(g => `
      <div class="agenda-group">
        <div class="agenda-date-header">
          <span class="agenda-date-label ${g.isToday ? 'today' : ''} ${g.isPast ? 'overdue' : ''}">${esc(g.label)}</span>
          <span class="agenda-date-count">${g.events.length} evento${g.events.length > 1 ? 's' : ''}</span>
        </div>
        <div class="agenda-events">
          ${g.events.map(renderEvent).join('')}
        </div>
      </div>
    `).join('');

    // Event click delegation
    timeline.querySelectorAll('[data-link]').forEach(el => {
      el.addEventListener('click', () => {
        const link = (el as HTMLElement).dataset.link;
        if (link) window.location.hash = link;
      });
    });
  }

  function renderEvent(ev: AgendaEvent): string {
    const clickable = ev.linkHash ? `data-link="${esc(ev.linkHash)}"` : '';
    return `
      <div class="agenda-event agenda-event-${ev.type}" ${clickable}>
        <span class="badge ${ev.badgeCls}" style="flex-shrink:0;">${esc(ev.badgeLabel)}</span>
        <div class="agenda-event-content">
          <strong>${esc(ev.title)}</strong>
          <div class="text-xs text-secondary">${esc(ev.subtitle)}</div>
        </div>
        ${ev.linkHash ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;color:var(--color-tertiary);"><path d="M9 18l6-6-6-6"/></svg>' : ''}
      </div>
    `;
  }

  return () => { unsubP(); unsubS(); unsubL(); };
}
