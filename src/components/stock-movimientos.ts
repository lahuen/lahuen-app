import { collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { esc } from '../lib/sanitize';
import { formatDate, formatCurrency } from '../lib/format';
import type { Movimiento } from '../lib/types';

export function renderStockMovimientos(container: HTMLElement): (() => void) | null {
  container.innerHTML = `
    <div class="page">
      <h1 class="text-title" style="margin-bottom:var(--sp-4);">Movimientos de stock</h1>

      <div class="toolbar">
        <select class="filter-select" id="mov-filter-tipo">
          <option value="">Todos</option>
          <option value="entrada">Entradas</option>
          <option value="salida">Salidas</option>
        </select>
        <span id="mov-count" class="badge badge-neutral">--</span>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Tipo</th>
              <th>Producto</th>
              <th>Cantidad</th>
              <th>Motivo</th>
              <th>Prospecto</th>
              <th>Vendedor</th>
            </tr>
          </thead>
          <tbody id="mov-tbody">
            <tr><td colspan="7" class="empty-state"><p>Cargando...</p></td></tr>
          </tbody>
        </table>
      </div>

      <!-- Mobile cards -->
      <div class="mov-cards" id="mov-cards"></div>
    </div>
  `;

  let allMovs: (Movimiento & { id: string })[] = [];
  const filterTipo = document.getElementById('mov-filter-tipo') as HTMLSelectElement;
  filterTipo.addEventListener('change', applyFilter);

  const q = query(collection(db, 'movimientos'), orderBy('createdAt', 'desc'), limit(200));
  const unsub = onSnapshot(q, (snap) => {
    allMovs = snap.docs.map(d => ({ id: d.id, ...d.data() } as Movimiento & { id: string }));
    applyFilter();
  });

  function applyFilter() {
    const tipo = filterTipo.value;
    const filtered = tipo ? allMovs.filter(m => m.tipo === tipo) : allMovs;
    renderTable(filtered);
    renderCards(filtered);
    document.getElementById('mov-count')!.textContent = filtered.length + ' movimientos';
  }

  function renderTable(items: (Movimiento & { id: string })[]) {
    const tbody = document.getElementById('mov-tbody')!;
    if (items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><p>Sin movimientos</p></td></tr>';
      return;
    }
    tbody.innerHTML = items.map(m => `
      <tr>
        <td class="text-secondary">${formatDate(m.fecha)}</td>
        <td><span class="badge badge-${m.tipo}">${m.tipo === 'entrada' ? 'Entrada' : 'Salida'}</span></td>
        <td class="td-name">${esc(m.productoNombre)}</td>
        <td>${m.cantidad}</td>
        <td class="text-secondary">${esc(m.motivo)}</td>
        <td>${m.prospectoLocal ? `<a href="#editar/${m.prospectoId}" class="text-accent">${esc(m.prospectoLocal)}</a>` : '<span class="text-tertiary">--</span>'}</td>
        <td class="text-secondary text-xs">${esc((m.vendedor || '').split('@')[0])}</td>
      </tr>
    `).join('');
  }

  function renderCards(items: (Movimiento & { id: string })[]) {
    const cardsEl = document.getElementById('mov-cards')!;
    if (items.length === 0) {
      cardsEl.innerHTML = '';
      return;
    }
    cardsEl.innerHTML = items.map(m => `
      <div class="mov-card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--sp-2);">
          <span class="badge badge-${m.tipo}">${m.tipo === 'entrada' ? 'Entrada' : 'Salida'}</span>
          <span class="text-xs text-secondary">${formatDate(m.fecha)}</span>
        </div>
        <strong>${esc(m.productoNombre)}</strong> &middot; ${m.cantidad}
        <div class="text-xs text-secondary" style="margin-top:var(--sp-1);">
          ${esc(m.motivo)}${m.prospectoLocal ? ' &rarr; ' + esc(m.prospectoLocal) : ''}
          ${m.precioVenta ? ' &middot; ' + formatCurrency(m.precioVenta) : ''}
        </div>
      </div>
    `).join('');
  }

  return () => unsub();
}
