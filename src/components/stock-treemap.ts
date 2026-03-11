import { esc } from '../lib/sanitize';
import { formatCurrency, formatDate } from '../lib/format';
import { getProductos, getLotes, getMovimientos } from '../lib/store';
import { computeAllProductMetrics, computeLoteHealth, computeDaysRemaining, computeShelfLifePercent } from '../lib/stock-metrics';
import { computeTreemapLayout } from '../lib/treemap';
import { showToast } from '../lib/toast';
import { recordStockEntry, recordStockExit, recordSale } from '../lib/stock';
import type { Producto, Lote, Movimiento } from '../lib/types';
import type { ProductMetrics } from '../lib/stock-metrics';
import type { Timestamp } from 'firebase/firestore';

type ProductHealth = 'ok' | 'low' | 'danger' | 'zero';
type CellTier = 'full' | 'medium' | 'small' | 'tiny';

function getProductHealth(p: Producto & { id: string }, m: ProductMetrics): ProductHealth {
  if (p.cantidad === 0) return 'zero';
  if (m.expiredLotes > 0 || m.expiringLotes > 0) return 'danger';
  if (p.cantidad < 20 || (m.daysToStockout !== null && m.daysToStockout < 7)) return 'low';
  return 'ok';
}

function getCellTier(w: number, h: number): CellTier {
  const area = w * h; // percentage area (0-10000 scale)
  if (area > 1500) return 'full';
  if (area > 800) return 'medium';
  if (area > 300) return 'small';
  return 'tiny';
}

// Module-level state preserved across re-renders from parent
let _selectedId: string | null = null;

export function renderStockTreemap(
  container: HTMLElement,
  searchQuery: string,
): (() => void) | null {
  // Use module-level state so selection persists across store-driven re-renders
  const selectedId = _selectedId;

  render();

  function render() {
    const allProducts = getProductos();
    const filtered = searchQuery
      ? allProducts.filter(p => p.nombre.toLowerCase().includes(searchQuery) || (p.proveedor || '').toLowerCase().includes(searchQuery))
      : allProducts;

    const metricsMap = computeAllProductMetrics();

    // Separate zero-value products
    const withValue = filtered.filter(p => p.cantidad * p.precio > 0);
    const zeroProducts = filtered.filter(p => p.cantidad === 0 || p.precio === 0);

    // Compute layout
    const items = withValue.map(p => ({
      id: p.id,
      value: p.cantidad * p.precio,
    }));

    // Use 16:9 base ratio for layout calculation
    const rects = computeTreemapLayout(items, 1600, 900);

    // Build treemap cells HTML
    const cellsHtml = rects.map(r => {
      const p = withValue.find(pr => pr.id === r.item.id)!;
      const m = metricsMap.get(p.id);
      const health = m ? getProductHealth(p, m) : 'ok';
      const tier = getCellTier(r.w, r.h);
      const isSelected = selectedId === p.id;
      const velLabel = m && m.weeklyVelocity > 0 ? `${m.weeklyVelocity}/sem` : '';
      const stockoutLabel = m && m.daysToStockout != null ? `~${m.daysToStockout}d` : '';
      const loteDots = m && m.activeLotes > 0
        ? getLotes().filter(l => l.productoId === p.id && l.cantidad > 0).map(l => {
            const lh = computeLoteHealth(l);
            return `<span class="lote-dot lote-dot-${lh}"></span>`;
          }).join('')
        : '';

      return `<div class="treemap-cell treemap-${health} treemap-cell-${tier} ${isSelected ? 'treemap-cell-selected' : ''}"
        style="left:${r.x}%;top:${r.y}%;width:${r.w}%;height:${r.h}%;"
        data-treemap-id="${p.id}">
        <span class="treemap-cell-name">${esc(p.nombre)}</span>
        <span class="treemap-cell-qty">${p.cantidad} ${esc(p.unidad)}</span>
        <span class="treemap-cell-value">${formatCurrency(r.item.value)}</span>
        <span class="treemap-cell-meta">${velLabel}${velLabel && stockoutLabel ? ' · ' : ''}${stockoutLabel}${loteDots ? ' ' + loteDots : ''}</span>
      </div>`;
    }).join('');

    // Zero products row
    const zeroHtml = zeroProducts.length > 0
      ? `<div class="treemap-zero-row">
          <span class="text-xs text-tertiary">Sin stock:</span>
          ${zeroProducts.map(p => `<span class="badge badge-neutral treemap-zero-badge" data-treemap-id="${p.id}">${esc(p.nombre)}</span>`).join('')}
        </div>`
      : '';

    // Detail panel
    const detailHtml = selectedId ? renderDetail(selectedId, metricsMap) : '';

    container.innerHTML = `
      <div class="treemap-container" id="treemap-cells">
        ${cellsHtml}
        ${rects.length === 0 ? '<div class="empty-state" style="min-height:100%;"><p>Sin productos con valor</p></div>' : ''}
      </div>
      ${zeroHtml}
      ${detailHtml}
    `;

    // Attach click listeners via delegation
    container.addEventListener('click', handleClick);
  }

  function handleClick(e: Event) {
    const target = e.target as HTMLElement;

    // Treemap cell or zero badge click
    const cell = target.closest('[data-treemap-id]') as HTMLElement | null;
    if (cell && !target.closest('button') && !target.closest('input') && !target.closest('select')) {
      const pid = cell.dataset.treemapId!;
      _selectedId = _selectedId === pid ? null : pid;
      render();
      return;
    }

    // Stock action buttons
    const actionBtn = target.closest('[data-tm-action]') as HTMLElement | null;
    if (actionBtn) {
      const action = actionBtn.dataset.tmAction as 'entrada' | 'salida';
      const id = actionBtn.dataset.tmId!;
      const name = actionBtn.dataset.tmName!;
      showInlineForm(id, name, action);
      return;
    }
  }

  function renderDetail(productoId: string, metricsMap: Map<string, ProductMetrics>): string {
    const p = getProductos().find(pr => pr.id === productoId);
    if (!p) return '';
    const m = metricsMap.get(productoId);
    const pLotes = getLotes()
      .filter(l => l.productoId === productoId && l.cantidad > 0)
      .sort((a, b) => {
        if (!a.vencimiento && !b.vencimiento) return 0;
        if (!a.vencimiento) return 1;
        if (!b.vencimiento) return -1;
        return a.vencimiento.toDate().getTime() - b.vencimiento.toDate().getTime();
      });
    const movs = getMovimientos().filter(mv => mv.productoId === productoId).slice(0, 5);
    const health = m ? getProductHealth(p, m) : 'ok';

    // Lotes section
    const lotesHtml = pLotes.length > 0 ? pLotes.map((l, i) => {
      const lHealth = computeLoteHealth(l);
      const days = computeDaysRemaining(l.vencimiento);
      const percent = computeShelfLifePercent(l.fechaIngreso, l.vencimiento);
      return `<div class="lote-detail ${i === 0 ? 'lote-fefo' : ''}">
        <div class="lote-detail-header">
          <span class="lote-numero">${esc(l.numero)}</span>
          ${i === 0 ? '<span class="badge badge-accent" style="font-size:10px;">FEFO</span>' : ''}
          <span class="lote-qty">${l.cantidad} uds</span>
          ${l.ubicacion ? `<span class="lote-ubic">${esc(l.ubicacion)}</span>` : ''}
        </div>
        <div class="lote-shelf-life">
          <div class="shelf-life-bar"><div class="shelf-life-fill shelf-life-${lHealth}" style="width:${percent}%"></div></div>
          <span class="text-xs ${lHealth === 'danger' || lHealth === 'expired' ? 'text-danger' : 'text-secondary'}">${days != null ? (days <= 0 ? 'Vencido' : days + 'd') : 'Sin venc.'}</span>
        </div>
      </div>`;
    }).join('') : '<p class="text-xs text-tertiary">Sin lotes activos</p>';

    // Movements
    const movsHtml = movs.length > 0 ? movs.map(mv => {
      const tipoCls = mv.tipo === 'entrada' ? 'badge-success' : 'badge-danger';
      return `<div class="mini-mov">
        <span class="badge ${tipoCls}" style="font-size:10px;padding:1px 6px;">${mv.tipo === 'entrada' ? '+' : '-'}</span>
        <span>${mv.cantidad}</span>
        <span class="text-secondary">${esc(mv.motivo)}</span>
        <span class="text-xs text-tertiary" style="margin-left:auto;">${timeAgo(mv.fecha)}</span>
      </div>`;
    }).join('') : '<p class="text-xs text-tertiary">Sin movimientos</p>';

    // Local metrics summary (replaces per-product AI)
    const metricParts: string[] = [];
    if (m) {
      metricParts.push(`Velocidad: ${m.weeklyVelocity > 0 ? m.weeklyVelocity + '/sem' : '--'}`);
      if (m.daysToStockout != null) metricParts.push(`Stock para ~${m.daysToStockout}d`);
      else if (p.cantidad === 0) metricParts.push('Sin stock');
      if (m.expiringLotes > 0) metricParts.push(`${m.expiringLotes} lote(s) por vencer`);
      if (m.expiredLotes > 0) metricParts.push(`${m.expiredLotes} vencido(s)`);
      if (m.lastMovementDate) {
        const daysAgo = Math.floor((Date.now() - m.lastMovementDate.getTime()) / 86400000);
        metricParts.push(`Ultimo mov: ${daysAgo === 0 ? 'hoy' : daysAgo === 1 ? 'ayer' : 'hace ' + daysAgo + 'd'}`);
      }
      metricParts.push(`Valor: ${formatCurrency(m.totalValue)}`);
    }

    return `<div class="treemap-detail">
      <div class="treemap-detail-header">
        <div>
          <strong style="font-size:var(--text-lg);">${esc(p.nombre)}</strong>
          <span class="text-xs text-secondary" style="margin-left:var(--sp-2);">${p.cantidad} ${esc(p.unidad)} · ${formatCurrency(p.cantidad * p.precio)}</span>
        </div>
        <span class="badge treemap-${health}" style="color:#fff;">${health === 'ok' ? 'OK' : health === 'low' ? 'Bajo' : health === 'danger' ? 'Riesgo' : 'Sin stock'}</span>
      </div>
      ${metricParts.length > 0 ? `<div class="product-metrics-summary">${metricParts.join(' · ')}</div>` : ''}
      <div class="grid-2">
        <div class="expanded-section">
          <h4>Lotes (${pLotes.length})</h4>
          ${lotesHtml}
        </div>
        <div class="expanded-section">
          <h4>Ultimos movimientos</h4>
          ${movsHtml}
        </div>
      </div>
      <div class="expanded-actions" style="margin-top:var(--sp-3);">
        <button class="btn btn-sm btn-primary" data-tm-action="entrada" data-tm-id="${productoId}" data-tm-name="${esc(p.nombre)}">+ Entrada</button>
        <button class="btn btn-sm btn-secondary" data-tm-action="salida" data-tm-id="${productoId}" data-tm-name="${esc(p.nombre)}">- Salida</button>
      </div>
      <div id="tm-inline-${productoId}" style="display:none;margin-top:var(--sp-3);"></div>
    </div>`;
  }

  function showInlineForm(productoId: string, productoNombre: string, tipo: 'entrada' | 'salida') {
    const inlineContainer = document.getElementById(`tm-inline-${productoId}`);
    if (!inlineContainer) return;

    if (tipo === 'entrada') {
      const motivos = '<option value="cosecha">Cosecha</option><option value="compra">Compra</option><option value="devolucion">Devolucion</option><option value="ajuste">Ajuste</option>';
      inlineContainer.innerHTML = `
        <div class="grid-2" style="gap:var(--sp-2);">
          <input type="number" id="tm-qty-${productoId}" class="form-control" min="1" placeholder="Cantidad" style="padding:8px;" />
          <select id="tm-motivo-${productoId}" class="form-control" style="padding:8px;">${motivos}</select>
        </div>
        <div class="grid-2" style="gap:var(--sp-2);margin-top:var(--sp-2);">
          <input type="text" id="tm-lote-${productoId}" class="form-control" placeholder="Nro lote (ej: L001)" style="padding:8px;" />
          <input type="date" id="tm-venc-${productoId}" class="form-control" style="padding:8px;" title="Vencimiento" />
        </div>
        <div style="margin-top:var(--sp-2);">
          <input type="text" id="tm-ubic-${productoId}" class="form-control" placeholder="Ubicacion (opcional)" style="padding:8px;" />
        </div>
        <div style="display:flex;gap:var(--sp-2);margin-top:var(--sp-2);">
          <button class="btn btn-sm btn-primary" id="tm-confirm-${productoId}">Confirmar</button>
          <button class="btn btn-sm btn-secondary" id="tm-cancel-${productoId}">Cancelar</button>
        </div>
      `;
    } else {
      const pLotes = getLotes().filter(l => l.productoId === productoId && l.cantidad > 0)
        .sort((a, b) => {
          if (!a.vencimiento && !b.vencimiento) return 0;
          if (!a.vencimiento) return 1;
          if (!b.vencimiento) return -1;
          return a.vencimiento.toDate().getTime() - b.vencimiento.toDate().getTime();
        });
      const motivos = '<option value="venta">Venta</option><option value="merma">Merma</option><option value="ajuste">Ajuste</option>';
      let loteSelect = '';
      if (pLotes.length > 0) {
        const opts = pLotes.map(l => {
          const vencLabel = l.vencimiento ? ` - Vence: ${formatDate(l.vencimiento)}` : '';
          const ubicLabel = l.ubicacion ? ` (${l.ubicacion})` : '';
          return `<option value="${l.id}">${esc(l.numero)}: ${l.cantidad} uds${vencLabel}${ubicLabel}</option>`;
        }).join('');
        loteSelect = `<div style="margin-top:var(--sp-2);"><select id="tm-lote-sel-${productoId}" class="form-control" style="padding:8px;"><option value="">FEFO automatico</option>${opts}</select></div>`;
      }
      inlineContainer.innerHTML = `
        <div class="grid-2" style="gap:var(--sp-2);">
          <input type="number" id="tm-qty-${productoId}" class="form-control" min="1" placeholder="Cantidad" style="padding:8px;" />
          <select id="tm-motivo-${productoId}" class="form-control" style="padding:8px;">${motivos}</select>
        </div>
        ${loteSelect}
        <div style="display:flex;gap:var(--sp-2);margin-top:var(--sp-2);">
          <button class="btn btn-sm btn-primary" id="tm-confirm-${productoId}">Confirmar</button>
          <button class="btn btn-sm btn-secondary" id="tm-cancel-${productoId}">Cancelar</button>
        </div>
      `;
    }

    inlineContainer.style.display = '';

    document.getElementById(`tm-cancel-${productoId}`)!.addEventListener('click', () => {
      inlineContainer.style.display = 'none';
      inlineContainer.innerHTML = '';
    });

    document.getElementById(`tm-confirm-${productoId}`)!.addEventListener('click', async () => {
      const qty = Number((document.getElementById(`tm-qty-${productoId}`) as HTMLInputElement).value);
      const motivo = (document.getElementById(`tm-motivo-${productoId}`) as HTMLSelectElement).value;
      if (!qty || qty <= 0) { showToast('Ingresa una cantidad valida', 'error'); return; }

      if (tipo === 'salida') {
        const confirmEl = document.getElementById(`tm-confirm-${productoId}`) as HTMLButtonElement;
        if (confirmEl.dataset.confirmed !== 'true') {
          confirmEl.textContent = `Confirmar -${qty}?`;
          confirmEl.classList.replace('btn-primary', 'btn-danger');
          confirmEl.dataset.confirmed = 'true';
          return;
        }
      }

      try {
        if (tipo === 'entrada') {
          const loteNumero = (document.getElementById(`tm-lote-${productoId}`) as HTMLInputElement).value.trim();
          const vencStr = (document.getElementById(`tm-venc-${productoId}`) as HTMLInputElement).value;
          const ubicacion = (document.getElementById(`tm-ubic-${productoId}`) as HTMLInputElement).value.trim();
          const loteInfo = { numero: loteNumero || undefined!, vencimiento: vencStr ? new Date(vencStr + 'T00:00:00') : null, ubicacion: ubicacion || '' };
          const hasLoteInfo = loteNumero || vencStr;
          await recordStockEntry(productoId, productoNombre, qty, motivo as 'cosecha' | 'compra' | 'devolucion' | 'ajuste', hasLoteInfo ? loteInfo : undefined);
        } else {
          const loteSelEl = document.getElementById(`tm-lote-sel-${productoId}`) as HTMLSelectElement | null;
          const selectedLoteId = loteSelEl?.value || undefined;
          if (motivo === 'venta') {
            await recordSale(productoId, productoNombre, qty, undefined, undefined, undefined, selectedLoteId);
          } else {
            await recordStockExit(productoId, productoNombre, qty, motivo as 'merma' | 'ajuste', selectedLoteId);
          }
        }
        showToast(`${tipo === 'entrada' ? 'Entrada' : 'Salida'} registrada`, 'success');
        inlineContainer.style.display = 'none';
        inlineContainer.innerHTML = '';
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Error';
        showToast(msg, 'error');
      }
    });
  }

  return () => {
    _selectedId = null;
  };
}

function timeAgo(ts: Timestamp): string {
  const diff = Date.now() - ts.toDate().getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'hoy';
  if (days === 1) return 'ayer';
  if (days < 7) return `hace ${days}d`;
  if (days < 30) return `hace ${Math.floor(days / 7)}sem`;
  return ts.toDate().toLocaleDateString('es-AR');
}
