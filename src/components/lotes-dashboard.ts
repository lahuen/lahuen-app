import { esc } from '../lib/sanitize';
import { formatDate, formatCurrency } from '../lib/format';
import { getLotes, getProductos, subscribe } from '../lib/store';
import { computeLoteHealth, computeDaysRemaining, computeShelfLifePercent } from '../lib/stock-metrics';
import type { Lote } from '../lib/types';

type FilterType = 'all' | 'expiring' | 'expired';

export function renderLotesDashboard(container: HTMLElement): (() => void) | null {
  let filter: FilterType = 'all';
  let productFilter = '';

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

  const unsub = subscribe(rebuild);
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
      </tr>`;
    }).join('');

    // Render cards (mobile)
    const cardsEl = document.getElementById('lote-cards')!;
    cardsEl.innerHTML = filtered.map(l => {
      const health = computeLoteHealth(l);
      const days = computeDaysRemaining(l.vencimiento);
      const percent = computeShelfLifePercent(l.fechaIngreso, l.vencimiento);
      const borderCls = health === 'expired' || health === 'danger' ? 'lote-card-danger' : health === 'warning' ? 'lote-card-warning' : '';

      return `<div class="lote-card ${borderCls}">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:var(--sp-2);">
          <div>
            <strong>${esc(l.productoNombre)}</strong>
            <div class="text-xs text-secondary">${esc(l.numero)} ${l.ubicacion ? '· ' + esc(l.ubicacion) : ''}</div>
          </div>
          <span class="badge ${health === 'expired' || health === 'danger' ? 'badge-danger' : health === 'warning' ? 'badge-warning' : 'badge-success'}">
            ${l.cantidad} uds
          </span>
        </div>
        <div class="lote-shelf-life">
          <div class="shelf-life-bar"><div class="shelf-life-fill shelf-life-${health}" style="width:${percent}%"></div></div>
          <span class="text-xs ${days != null && days <= 7 ? 'text-danger' : 'text-secondary'}">
            ${days != null ? (days <= 0 ? 'Vencido' : days + 'd') : 'Sin venc.'}
          </span>
        </div>
        <div class="text-xs text-tertiary" style="margin-top:var(--sp-2);">Ingreso: ${formatDate(l.fechaIngreso)}</div>
      </div>`;
    }).join('');
  }

  return () => unsub();
}
