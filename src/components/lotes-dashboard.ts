import { doc, updateDoc, Timestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { esc } from '../lib/sanitize';
import { formatDate, formatCurrency, toInputDate } from '../lib/format';
import { getLotes, getProductos, subscribe } from '../lib/store';
import { computeLoteHealth, computeDaysRemaining, computeShelfLifePercent } from '../lib/stock-metrics';
import { showToast } from '../lib/toast';
import { logAudit } from '../lib/audit';
import type { Lote } from '../lib/types';

type FilterType = 'all' | 'expiring' | 'expired';

export function renderLotesDashboard(container: HTMLElement): (() => void) | null {
  let filter: FilterType = 'all';
  let productFilter = '';
  let editingLoteId: string | null = null;

  container.innerHTML = `
    <div class="page">
      <div class="toolbar" style="margin-bottom:var(--sp-4);">
        <h2 class="text-title" style="flex:1;margin:0;">Lotes</h2>
        <select class="form-control" id="lote-filter" style="width:auto;padding:6px 10px;font-size:var(--text-xs);">
          <option value="all">Todos</option>
          <option value="expiring">Por vencer (7d)</option>
          <option value="expired">Vencidos</option>
        </select>
        <select class="form-control" id="lote-product-filter" style="width:auto;padding:6px 10px;font-size:var(--text-xs);">
          <option value="">Todos los productos</option>
        </select>
        <span id="lote-count" class="badge badge-neutral">--</span>
      </div>

      <div class="stat-grid lote-stats" style="margin-bottom:var(--sp-4);">
        <div class="stat-card"><p class="stat-label">Lotes activos</p><p class="stat-value" id="lote-active">--</p></div>
        <div class="stat-card"><p class="stat-label">Por vencer</p><p class="stat-value text-warning" id="lote-expiring">--</p></div>
        <div class="stat-card"><p class="stat-label">Vencidos</p><p class="stat-value text-danger" id="lote-expired">--</p></div>
        <div class="stat-card"><p class="stat-label">Valor en riesgo</p><p class="stat-value text-danger" id="lote-risk-value">--</p></div>
      </div>

      <div class="table-wrap" id="lote-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Producto</th>
              <th>Lote</th>
              <th>Cantidad</th>
              <th>Vencimiento</th>
              <th>Dias</th>
              <th>Vida util</th>
              <th>Ubicacion</th>
              <th>Ingreso</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="lote-tbody"></tbody>
        </table>
      </div>

      <div id="lote-cards"></div>
    </div>
  `;

  const filterEl = document.getElementById('lote-filter') as HTMLSelectElement;
  const productFilterEl = document.getElementById('lote-product-filter') as HTMLSelectElement;

  filterEl.addEventListener('change', () => { filter = filterEl.value as FilterType; rebuild(); });
  productFilterEl.addEventListener('change', () => { productFilter = productFilterEl.value; rebuild(); });

  // Edit/save/cancel delegation on table
  document.getElementById('lote-table-wrap')!.addEventListener('click', handleAction);
  // Edit/save/cancel delegation on cards
  document.getElementById('lote-cards')!.addEventListener('click', handleAction);

  function handleAction(e: Event) {
    const target = e.target as HTMLElement;

    // Edit button
    const editBtn = target.closest('[data-edit]') as HTMLElement | null;
    if (editBtn) {
      editingLoteId = editingLoteId === editBtn.dataset.edit ? null : editBtn.dataset.edit!;
      rebuild();
      return;
    }

    // Cancel button
    if (target.closest('[data-cancel]')) {
      editingLoteId = null;
      rebuild();
      return;
    }

    // Save button
    const saveBtn = target.closest('[data-save]') as HTMLElement | null;
    if (saveBtn) {
      saveLote(saveBtn.dataset.save!);
      return;
    }
  }

  async function saveLote(loteId: string) {
    const form = document.querySelector(`[data-id="${loteId}"].lote-edit-row, .lote-edit-form[data-id="${loteId}"]`) as HTMLElement | null;
    if (!form) return;

    const numero = (form.querySelector('[data-field="numero"]') as HTMLInputElement).value.trim();
    const vencStr = (form.querySelector('[data-field="vencimiento"]') as HTMLInputElement).value;
    const ubicacion = (form.querySelector('[data-field="ubicacion"]') as HTMLInputElement).value.trim();

    if (!numero) {
      showToast('El numero de lote es obligatorio', 'error');
      return;
    }

    try {
      const updates: Record<string, unknown> = {
        numero,
        ubicacion,
        vencimiento: vencStr ? Timestamp.fromDate(new Date(vencStr + 'T00:00:00')) : null,
      };
      await updateDoc(doc(db, 'lotes', loteId), updates);

      const lote = getLotes().find(l => l.id === loteId);
      logAudit('update', 'lotes', loteId, lote?.productoNombre || numero, `lote: ${numero}`);

      editingLoteId = null;
      showToast('Lote actualizado', 'success');
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : 'Error'}`, 'error');
    }
  }

  const unsub = subscribe(rebuild, ['productos', 'lotes']);
  rebuild();

  function rebuild() {
    const allLotes = getLotes();
    const productos = getProductos();
    const priceMap = new Map<string, number>();
    for (const p of productos) priceMap.set(p.id, p.precio);

    // Populate product filter dropdown
    const uniqueProducts = [...new Set(allLotes.filter(l => l.cantidad > 0).map(l => l.productoNombre))].sort();
    const currentOptions = Array.from(productFilterEl.options).map(o => o.value);
    const expectedOptions = ['', ...uniqueProducts.map(n => n)];
    if (JSON.stringify(currentOptions) !== JSON.stringify(expectedOptions)) {
      const selectedVal = productFilterEl.value;
      productFilterEl.innerHTML = `<option value="">Todos los productos</option>` +
        uniqueProducts.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
      productFilterEl.value = selectedVal;
    }

    // Filter active lotes
    let filtered = allLotes.filter(l => l.cantidad > 0);

    if (productFilter) {
      filtered = filtered.filter(l => l.productoNombre === productFilter);
    }

    const now = Date.now();
    const sevenDays = now + 7 * 86400000;

    if (filter === 'expiring') {
      filtered = filtered.filter(l => l.vencimiento && l.vencimiento.toDate().getTime() > now && l.vencimiento.toDate().getTime() <= sevenDays);
    } else if (filter === 'expired') {
      filtered = filtered.filter(l => l.vencimiento && l.vencimiento.toDate().getTime() <= now);
    }

    // Sort by vencimiento ASC, nulls at end
    filtered.sort((a, b) => {
      if (!a.vencimiento && !b.vencimiento) return 0;
      if (!a.vencimiento) return 1;
      if (!b.vencimiento) return -1;
      return a.vencimiento.toDate().getTime() - b.vencimiento.toDate().getTime();
    });

    // KPIs (computed from ALL active lotes, not filtered)
    const allActive = allLotes.filter(l => l.cantidad > 0);
    let kpiExpiring = 0;
    let kpiExpired = 0;
    let riskValue = 0;

    for (const l of allActive) {
      if (!l.vencimiento) continue;
      const vTime = l.vencimiento.toDate().getTime();
      const price = priceMap.get(l.productoId) || 0;
      if (vTime <= now) {
        kpiExpired++;
        riskValue += l.cantidad * price;
      } else if (vTime <= sevenDays) {
        kpiExpiring++;
        riskValue += l.cantidad * price;
      }
    }

    document.getElementById('lote-active')!.textContent = String(allActive.length);
    document.getElementById('lote-expiring')!.textContent = String(kpiExpiring);
    document.getElementById('lote-expired')!.textContent = String(kpiExpired);
    document.getElementById('lote-risk-value')!.textContent = formatCurrency(riskValue);
    document.getElementById('lote-count')!.textContent = `${filtered.length} lotes`;

    // Render table (desktop)
    const tbody = document.getElementById('lote-tbody')!;
    tbody.innerHTML = filtered.map(l => {
      const health = computeLoteHealth(l);
      const days = computeDaysRemaining(l.vencimiento);
      const percent = computeShelfLifePercent(l.fechaIngreso, l.vencimiento);
      const statusLabel = health === 'expired' ? 'Vencido' : health === 'danger' ? 'Critico' : health === 'warning' ? 'Por vencer' : health === 'depleted' ? 'Agotado' : 'OK';
      const statusCls = health === 'expired' || health === 'danger' ? 'badge-danger' : health === 'warning' ? 'badge-warning' : 'badge-success';
      const isEditing = editingLoteId === l.id;

      let editRow = '';
      if (isEditing) {
        editRow = `<tr class="lote-edit-row" data-id="${l.id}">
          <td colspan="10">
            <div class="lote-edit-form">
              <div class="form-group">
                <label class="form-label">Lote</label>
                <input type="text" class="form-control" data-field="numero" value="${esc(l.numero)}" />
              </div>
              <div class="form-group">
                <label class="form-label">Vencimiento</label>
                <input type="date" class="form-control" data-field="vencimiento" value="${toInputDate(l.vencimiento)}" />
              </div>
              <div class="form-group">
                <label class="form-label">Ubicacion</label>
                <input type="text" class="form-control" data-field="ubicacion" value="${esc(l.ubicacion || '')}" placeholder="Ej: Camara fria" />
              </div>
              <div style="display:flex;gap:var(--sp-2);align-items:end;">
                <button class="btn btn-sm btn-primary" data-save="${l.id}">Guardar</button>
                <button class="btn btn-sm btn-secondary" data-cancel>Cancelar</button>
              </div>
            </div>
          </td>
        </tr>`;
      }

      return `<tr>
        <td><strong>${esc(l.productoNombre)}</strong></td>
        <td>${esc(l.numero)}</td>
        <td>${l.cantidad}</td>
        <td>${l.vencimiento ? formatDate(l.vencimiento) : '--'}</td>
        <td class="${days != null && days <= 7 ? 'text-danger' : ''}">${days != null ? (days <= 0 ? 'Vencido' : days + 'd') : '--'}</td>
        <td><div class="shelf-life-bar"><div class="shelf-life-fill shelf-life-${health}" style="width:${percent}%"></div></div></td>
        <td>${esc(l.ubicacion || '--')}</td>
        <td>${formatDate(l.fechaIngreso)}</td>
        <td><span class="badge ${statusCls}">${statusLabel}</span></td>
        <td><button class="btn btn-xs btn-secondary" data-edit="${l.id}" title="Editar lote">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button></td>
      </tr>${editRow}`;
    }).join('');

    // Render cards (mobile)
    const cardsEl = document.getElementById('lote-cards')!;
    cardsEl.innerHTML = filtered.map(l => {
      const health = computeLoteHealth(l);
      const days = computeDaysRemaining(l.vencimiento);
      const percent = computeShelfLifePercent(l.fechaIngreso, l.vencimiento);
      const borderCls = health === 'expired' || health === 'danger' ? 'lote-card-danger' : health === 'warning' ? 'lote-card-warning' : '';

      const isEditing = editingLoteId === l.id;
      let editForm = '';
      if (isEditing) {
        editForm = `<div class="lote-edit-form" style="margin-top:var(--sp-3);padding-top:var(--sp-3);border-top:1px solid var(--color-border);" data-id="${l.id}">
          <div class="form-group">
            <label class="form-label">Lote</label>
            <input type="text" class="form-control" data-field="numero" value="${esc(l.numero)}" />
          </div>
          <div class="form-group">
            <label class="form-label">Vencimiento</label>
            <input type="date" class="form-control" data-field="vencimiento" value="${toInputDate(l.vencimiento)}" />
          </div>
          <div class="form-group">
            <label class="form-label">Ubicacion</label>
            <input type="text" class="form-control" data-field="ubicacion" value="${esc(l.ubicacion || '')}" placeholder="Ej: Camara fria" />
          </div>
          <div style="display:flex;gap:var(--sp-2);">
            <button class="btn btn-sm btn-primary" data-save="${l.id}">Guardar</button>
            <button class="btn btn-sm btn-secondary" data-cancel>Cancelar</button>
          </div>
        </div>`;
      }

      return `<div class="lote-card ${borderCls}">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:var(--sp-2);">
          <div>
            <strong>${esc(l.productoNombre)}</strong>
            <div class="text-xs text-secondary">${esc(l.numero)} ${l.ubicacion ? '· ' + esc(l.ubicacion) : ''}</div>
          </div>
          <div style="display:flex;gap:var(--sp-2);align-items:center;">
            <span class="badge ${health === 'expired' || health === 'danger' ? 'badge-danger' : health === 'warning' ? 'badge-warning' : 'badge-success'}">
              ${l.cantidad} uds
            </span>
            <button class="btn btn-xs btn-secondary" data-edit="${l.id}" title="Editar lote">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
          </div>
        </div>
        <div class="lote-shelf-life">
          <div class="shelf-life-bar"><div class="shelf-life-fill shelf-life-${health}" style="width:${percent}%"></div></div>
          <span class="text-xs ${days != null && days <= 7 ? 'text-danger' : 'text-secondary'}">
            ${days != null ? (days <= 0 ? 'Vencido' : days + 'd') : 'Sin venc.'}
          </span>
        </div>
        <div class="text-xs text-tertiary" style="margin-top:var(--sp-2);">Ingreso: ${formatDate(l.fechaIngreso)}</div>
        ${editForm}
      </div>`;
    }).join('');
  }

  return () => unsub();
}
