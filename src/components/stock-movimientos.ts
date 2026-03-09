import { esc } from '../lib/sanitize';
import { formatDate, formatCurrency } from '../lib/format';
import { getMovimientos, subscribe } from '../lib/store';
import { recordStockAnulacion } from '../lib/stock';
import { showToast } from '../lib/toast';
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
          <option value="anulado">Anulados</option>
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
              <th></th>
            </tr>
          </thead>
          <tbody id="mov-tbody">
            <tr><td colspan="8" class="empty-state"><p>Cargando...</p></td></tr>
          </tbody>
        </table>
      </div>

      <!-- Mobile cards -->
      <div class="mov-cards" id="mov-cards"></div>
    </div>
  `;

  const filterTipo = document.getElementById('mov-filter-tipo') as HTMLSelectElement;
  filterTipo.addEventListener('change', applyFilter);

  // Delegated click for anular buttons
  container.addEventListener('click', handleAnular);

  const unsub = subscribe(applyFilter);
  applyFilter();

  /** Set of anulado movimiento IDs (originals that have been voided) */
  function getAnuladoIds(): Set<string> {
    const ids = new Set<string>();
    for (const m of getMovimientos()) {
      if (m.anulacionDe) ids.add(m.anulacionDe);
    }
    return ids;
  }

  function applyFilter() {
    const tipo = filterTipo.value;
    const allMovs = getMovimientos();
    const anuladoIds = getAnuladoIds();

    let filtered: (Movimiento & { id: string })[];
    if (tipo === 'anulado') {
      filtered = allMovs.filter(m => m.motivo === 'anulacion' || anuladoIds.has(m.id));
    } else if (tipo) {
      filtered = allMovs.filter(m => m.tipo === tipo);
    } else {
      filtered = allMovs;
    }

    renderTable(filtered, anuladoIds);
    renderCards(filtered, anuladoIds);
    document.getElementById('mov-count')!.textContent = filtered.length + ' movimientos';
  }

  function renderTable(items: (Movimiento & { id: string })[], anuladoIds: Set<string>) {
    const tbody = document.getElementById('mov-tbody')!;
    if (items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-state"><p>Sin movimientos</p></td></tr>';
      return;
    }
    tbody.innerHTML = items.map(m => {
      const isAnulado = anuladoIds.has(m.id);
      const isAnulacion = m.motivo === 'anulacion';
      const rowCls = isAnulado ? 'row-anulado' : (isAnulacion ? 'row-anulacion' : '');
      const canAnular = !isAnulado && !isAnulacion;

      return `<tr class="${rowCls}">
        <td class="text-secondary">${formatDate(m.fecha)}</td>
        <td>
          <span class="badge badge-${m.tipo}">${m.tipo === 'entrada' ? 'Entrada' : 'Salida'}</span>
          ${isAnulado ? '<span class="badge badge-anulado">Anulado</span>' : ''}
          ${isAnulacion ? '<span class="badge badge-anulado">Anulacion</span>' : ''}
        </td>
        <td class="td-name">${esc(m.productoNombre)}</td>
        <td>${m.cantidad}</td>
        <td class="text-secondary">${esc(m.motivo)}</td>
        <td>${m.prospectoLocal ? `<a href="#editar/${m.prospectoId}" class="text-accent">${esc(m.prospectoLocal)}</a>` : '<span class="text-tertiary">--</span>'}</td>
        <td class="text-secondary text-xs">${esc((m.vendedor || '').split('@')[0])}</td>
        <td>${canAnular ? `<button class="btn btn-sm btn-secondary btn-anular" data-anular-id="${m.id}">Anular</button>` : ''}</td>
      </tr>`;
    }).join('');
  }

  function renderCards(items: (Movimiento & { id: string })[], anuladoIds: Set<string>) {
    const cardsEl = document.getElementById('mov-cards')!;
    if (items.length === 0) {
      cardsEl.innerHTML = '';
      return;
    }
    cardsEl.innerHTML = items.map(m => {
      const isAnulado = anuladoIds.has(m.id);
      const isAnulacion = m.motivo === 'anulacion';
      const cardCls = isAnulado ? 'row-anulado' : (isAnulacion ? 'row-anulacion' : '');
      const canAnular = !isAnulado && !isAnulacion;

      return `<div class="mov-card ${cardCls}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--sp-2);">
          <div style="display:flex;gap:var(--sp-1);flex-wrap:wrap;">
            <span class="badge badge-${m.tipo}">${m.tipo === 'entrada' ? 'Entrada' : 'Salida'}</span>
            ${isAnulado ? '<span class="badge badge-anulado">Anulado</span>' : ''}
            ${isAnulacion ? '<span class="badge badge-anulado">Anulacion</span>' : ''}
          </div>
          <span class="text-xs text-secondary">${formatDate(m.fecha)}</span>
        </div>
        <strong>${esc(m.productoNombre)}</strong> &middot; ${m.cantidad}
        <div class="text-xs text-secondary" style="margin-top:var(--sp-1);">
          ${esc(m.motivo)}${m.prospectoLocal ? ' &rarr; ' + esc(m.prospectoLocal) : ''}
          ${m.precioVenta ? ' &middot; ' + formatCurrency(m.precioVenta) : ''}
        </div>
        ${canAnular ? `<div style="margin-top:var(--sp-2);"><button class="btn btn-sm btn-secondary btn-anular" data-anular-id="${m.id}">Anular</button></div>` : ''}
      </div>`;
    }).join('');
  }

  async function handleAnular(e: Event) {
    const btn = (e.target as HTMLElement).closest('[data-anular-id]') as HTMLElement | null;
    if (!btn) return;

    // Double-click confirmation
    if (btn.dataset.confirmed !== 'true') {
      btn.textContent = 'Confirmar anulacion?';
      btn.classList.replace('btn-secondary', 'btn-danger');
      btn.dataset.confirmed = 'true';
      return;
    }

    const movId = btn.dataset.anularId!;
    btn.textContent = '...';
    (btn as HTMLButtonElement).disabled = true;

    try {
      await recordStockAnulacion(movId);
      showToast('Movimiento anulado', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al anular';
      showToast(msg, 'error');
      // Reset button
      btn.textContent = 'Anular';
      btn.classList.replace('btn-danger', 'btn-secondary');
      btn.dataset.confirmed = '';
      (btn as HTMLButtonElement).disabled = false;
    }
  }

  return () => unsub();
}
