import { collection, addDoc, Timestamp } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { esc } from '../lib/sanitize';
import { showToast } from '../lib/toast';
import { logAudit } from '../lib/audit';
import { formatCurrency, formatDate } from '../lib/format';
import { recordStockEntry, recordStockExit, recordSale } from '../lib/stock';
import { getProductos, getLotes, getMovimientos, subscribe } from '../lib/store';
import type { Producto, Lote } from '../lib/types';

export function renderStockDashboard(container: HTMLElement): (() => void) | null {
  container.innerHTML = `
    <div class="page">
      <div class="stat-grid" style="margin-bottom:var(--sp-4);">
        <div class="stat-card"><p class="stat-label">Productos</p><p class="stat-value" id="stock-total">--</p></div>
        <div class="stat-card"><p class="stat-label">Valor total</p><p class="stat-value text-accent" id="stock-value">--</p></div>
        <div class="stat-card"><p class="stat-label">Stock bajo</p><p class="stat-value text-warning" id="stock-low">--</p></div>
        <div class="stat-card"><p class="stat-label">Por vencer</p><p class="stat-value text-danger" id="stock-expiring">--</p></div>
        <div class="stat-card"><p class="stat-label">Sin stock</p><p class="stat-value text-danger" id="stock-zero">--</p></div>
      </div>

      <div id="stock-alerts"></div>

      <div class="insights-panel" id="insights-panel">
        <div class="insights-header">
          <span class="insights-label">Insights de stock</span>
          <button class="action-btn" id="insights-refresh" title="Actualizar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M1 4v6h6"/><path d="M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>
          </button>
        </div>
        <div id="insights-content">
          <div class="insight-skeleton"></div>
          <div class="insight-skeleton"></div>
        </div>
      </div>

      <div class="toolbar">
        <div class="search-wrap">
          <svg class="search-icon" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input type="text" class="search-input" placeholder="Buscar producto..." id="stock-search" />
        </div>
        <button class="btn btn-primary btn-sm" id="add-product-btn">+ Producto</button>
        <span id="stock-count" class="badge badge-neutral">-- productos</span>
      </div>

      <div id="add-product-form" style="display:none;margin-bottom:var(--sp-4);">
        <div class="card">
          <h3 class="text-title" style="margin-bottom:var(--sp-4);">Nuevo producto</h3>
          <form id="product-form" class="flex flex-col gap-4">
            <div class="grid-2">
              <div class="form-group">
                <label class="form-label">Nombre *</label>
                <input type="text" name="nombre" class="form-control" placeholder="Ej: Lechuga Crespa" required />
              </div>
              <div class="form-group">
                <label class="form-label">Unidad *</label>
                <select name="unidad" class="form-control" required>
                  <option value="bandejas">Bandejas</option>
                  <option value="atados">Atados</option>
                  <option value="kg">Kg</option>
                  <option value="unidades">Unidades</option>
                </select>
              </div>
            </div>
            <div class="grid-2">
              <div class="form-group">
                <label class="form-label">Precio unitario</label>
                <input type="number" name="precio" class="form-control" min="0" step="1" placeholder="0" />
              </div>
              <div class="form-group">
                <label class="form-label">Proveedor</label>
                <input type="text" name="proveedor" class="form-control" placeholder="Lahuen" value="Lahuen" />
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Imagen (URL)</label>
              <input type="url" name="imagen" class="form-control" placeholder="https://... (opcional)" />
            </div>
            <div style="display:flex;gap:var(--sp-3);">
              <button type="submit" class="btn btn-primary btn-sm">Guardar</button>
              <button type="button" class="btn btn-secondary btn-sm" id="cancel-product">Cancelar</button>
            </div>
          </form>
        </div>
      </div>

      <div class="stock-grid" id="stock-grid">
        <div class="empty-state"><p>Cargando...</p></div>
      </div>
    </div>
  `;

  // Toggle add form
  const addBtn = document.getElementById('add-product-btn')!;
  const addForm = document.getElementById('add-product-form')!;
  addBtn.addEventListener('click', () => { addForm.style.display = addForm.style.display === 'none' ? '' : 'none'; });
  document.getElementById('cancel-product')!.addEventListener('click', () => { addForm.style.display = 'none'; });

  // Search
  const stockSearch = document.getElementById('stock-search') as HTMLInputElement;
  stockSearch.addEventListener('input', refresh);

  // Product form submit
  const productForm = document.getElementById('product-form') as HTMLFormElement;
  productForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const nombreValue = (productForm.nombre as HTMLInputElement).value.trim();
      const ref = await addDoc(collection(db, 'productos'), {
        nombre: nombreValue,
        cantidad: 0,
        unidad: (productForm.unidad as HTMLSelectElement).value,
        precio: Number((productForm.precio as HTMLInputElement).value) || 0,
        proveedor: (productForm.proveedor as HTMLInputElement).value.trim(),
        lote: '',
        imagen: (productForm.imagen as HTMLInputElement).value.trim(),
        vencimiento: null,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        createdBy: auth.currentUser?.uid || '',
      });
      logAudit('create', 'productos', ref.id, nombreValue);
      showToast('Producto creado', 'success');
      productForm.reset();
      addForm.style.display = 'none';
    } catch {
      showToast('Error al crear producto', 'error');
    }
  });

  // Single delegated click listener for stock grid actions
  document.getElementById('stock-grid')!.addEventListener('click', handleGridClick);

  // Insights refresh button
  document.getElementById('insights-refresh')!.addEventListener('click', () => {
    import('../lib/stock-insights').then(({ clearInsightsCache }) => {
      clearInsightsCache();
      loadInsights();
    });
  });

  // Subscribe to global store
  const unsub = subscribe(refresh);

  // Render immediately from cache
  refresh();
  // Load AI insights (async, non-blocking)
  loadInsights();

  function refresh() {
    renderGrid();
    updateKpis();
    renderAlerts();
  }

  function lotesForProduct(productoId: string): (Lote & { id: string })[] {
    return getLotes()
      .filter(l => l.productoId === productoId && l.cantidad > 0)
      .sort((a, b) => {
        if (!a.vencimiento && !b.vencimiento) return 0;
        if (!a.vencimiento) return 1;
        if (!b.vencimiento) return -1;
        return a.vencimiento.toDate().getTime() - b.vencimiento.toDate().getTime();
      });
  }

  function updateKpis() {
    const allProducts = getProductos();
    const allLotes = getLotes();
    const total = allProducts.length;
    const value = allProducts.reduce((sum, p) => sum + (p.cantidad * p.precio), 0);
    const low = allProducts.filter(p => p.cantidad > 0 && p.cantidad < 20).length;
    const zero = allProducts.filter(p => p.cantidad === 0).length;

    const now = new Date();
    const weekFromNow = new Date(now.getTime() + 7 * 86400000);
    const expiring = allLotes.filter(l => {
      if (l.cantidad <= 0 || !l.vencimiento) return false;
      return l.vencimiento.toDate() <= weekFromNow;
    }).length;

    document.getElementById('stock-total')!.textContent = String(total);
    document.getElementById('stock-value')!.textContent = formatCurrency(value);
    document.getElementById('stock-low')!.textContent = String(low);
    document.getElementById('stock-expiring')!.textContent = String(expiring);
    document.getElementById('stock-zero')!.textContent = String(zero);
  }

  function renderAlerts() {
    const el = document.getElementById('stock-alerts');
    if (!el) return;

    const now = new Date();
    const weekFromNow = new Date(now.getTime() + 7 * 86400000);
    const alerts: { icon: string; text: string; cls: string }[] = [];

    // Expiring lotes
    const expiringLotes = getLotes().filter(l =>
      l.cantidad > 0 && l.vencimiento && l.vencimiento.toDate() <= weekFromNow
    );
    for (const l of expiringLotes.slice(0, 3)) {
      const days = Math.max(0, Math.ceil((l.vencimiento!.toDate().getTime() - now.getTime()) / 86400000));
      alerts.push({
        icon: 'clock',
        text: `${l.productoNombre} (${l.numero}): ${l.cantidad} uds ${days <= 0 ? 'VENCIDO' : `vence en ${days}d`}`,
        cls: days <= 0 ? 'alert-danger' : 'alert-warning',
      });
    }

    // Zero stock products
    const zeroStock = getProductos().filter(p => p.cantidad === 0);
    if (zeroStock.length > 0) {
      alerts.push({
        icon: 'box',
        text: `Sin stock: ${zeroStock.map(p => p.nombre).join(', ')}`,
        cls: 'alert-danger',
      });
    }

    // Recent anulaciones (last 24h)
    const yesterday = new Date(now.getTime() - 86400000);
    const recentAnul = getMovimientos().filter(m =>
      m.motivo === 'anulacion' && m.fecha.toDate() >= yesterday
    );
    if (recentAnul.length > 0) {
      alerts.push({
        icon: 'undo',
        text: `${recentAnul.length} anulacion${recentAnul.length > 1 ? 'es' : ''} en las ultimas 24h`,
        cls: 'alert-info',
      });
    }

    if (alerts.length === 0) {
      el.innerHTML = '';
      return;
    }

    const iconSvg: Record<string, string> = {
      clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
      box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>',
      undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>',
    };

    el.innerHTML = `
      <div class="stock-alerts">
        ${alerts.map(a => `
          <div class="alert-item ${a.cls}">
            <span class="alert-icon">${iconSvg[a.icon] || ''}</span>
            <span>${esc(a.text)}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  async function loadInsights() {
    const contentEl = document.getElementById('insights-content');
    if (!contentEl) return;

    contentEl.innerHTML = '<div class="insight-skeleton"></div><div class="insight-skeleton"></div>';

    try {
      const { getStockInsights } = await import('../lib/stock-insights');
      const insights = await getStockInsights();

      if (insights.length === 0) {
        contentEl.innerHTML = '<p class="text-xs text-tertiary">Sin insights disponibles</p>';
        return;
      }

      const iconSvg: Record<string, string> = {
        trend: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/></svg>',
        rotation: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M1 4v6h6"/><path d="M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>',
        alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        recommendation: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/></svg>',
      };

      contentEl.innerHTML = insights.map(i => `
        <div class="insight-card insight-${i.severity}">
          <span class="insight-icon">${iconSvg[i.icon] || iconSvg.recommendation}</span>
          <div>
            <strong class="insight-title">${esc(i.title)}</strong>
            <p class="insight-text">${esc(i.text)}</p>
          </div>
        </div>
      `).join('');
    } catch {
      contentEl.innerHTML = '<p class="text-xs text-tertiary">Error cargando insights</p>';
    }
  }

  function renderGrid() {
    const grid = document.getElementById('stock-grid');
    if (!grid) return;
    const allProducts = getProductos();
    const searchQ = (stockSearch?.value || '').toLowerCase();
    const filtered = searchQ
      ? allProducts.filter(p => p.nombre.toLowerCase().includes(searchQ) || (p.proveedor || '').toLowerCase().includes(searchQ))
      : allProducts;
    document.getElementById('stock-count')!.textContent = filtered.length + ' productos';

    if (filtered.length === 0 && allProducts.length === 0) {
      grid.innerHTML = '<div class="empty-state"><p>Sin productos todavia</p><button class="btn btn-primary btn-sm" style="margin-top:var(--sp-3);" onclick="document.getElementById(\'add-product-btn\').click()">+ Agregar primer producto</button></div>';
      return;
    }
    if (filtered.length === 0) {
      grid.innerHTML = '<div class="empty-state"><p>Sin resultados</p></div>';
      return;
    }

    const now = new Date();
    const weekFromNow = new Date(now.getTime() + 7 * 86400000);

    grid.innerHTML = filtered.map(p => {
      const isLow = p.cantidad > 0 && p.cantidad < 20;
      const isZero = p.cantidad === 0;
      const pLotes = lotesForProduct(p.id);
      const hasExpiring = pLotes.some(l => l.vencimiento && l.vencimiento.toDate() <= weekFromNow);
      const cls = hasExpiring ? 'expired' : (isLow || isZero ? 'low-stock' : '');

      const imgHtml = p.imagen ? `<img src="${esc(p.imagen)}" alt="${esc(p.nombre)}" class="stock-card-img" />` : '';

      let lotesHtml = '';
      if (pLotes.length > 0) {
        const loteItems = pLotes.map(l => {
          const isExp = l.vencimiento && l.vencimiento.toDate() <= weekFromNow;
          return `<div class="lote-item ${isExp ? 'lote-expiring' : ''}">
            <span class="lote-numero">${esc(l.numero)}</span>
            <span class="lote-qty">${l.cantidad} uds</span>
            ${l.vencimiento ? `<span class="lote-venc">${formatDate(l.vencimiento)}</span>` : ''}
            ${l.ubicacion ? `<span class="lote-ubic">${esc(l.ubicacion)}</span>` : ''}
          </div>`;
        }).join('');

        lotesHtml = `
          <button class="lote-toggle" data-lote-toggle="${p.id}">Lotes (${pLotes.length})</button>
          <div class="lote-list" id="lotes-${p.id}" style="display:none;">${loteItems}</div>
        `;
      }

      return `<div class="stock-card ${cls}" data-id="${p.id}">
        ${imgHtml}
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:var(--sp-3);">
          <div>
            <strong>${esc(p.nombre)}</strong>
            <div class="text-secondary text-xs">${esc(p.proveedor || '')}</div>
          </div>
          <span class="badge ${isZero ? 'badge-danger' : isLow ? 'badge-warning' : 'badge-success'}">${p.cantidad} ${esc(p.unidad)}</span>
        </div>
        <div class="text-xs text-secondary" style="margin-bottom:var(--sp-3);">
          ${p.precio ? formatCurrency(p.precio) + ' / ' + esc(p.unidad) : ''}
          ${p.updatedBy ? `<br>Editado por ${esc(p.updatedBy.split('@')[0])}` : ''}
        </div>
        ${lotesHtml}
        <div style="display:flex;gap:var(--sp-2);margin-top:var(--sp-2);">
          <button class="btn btn-sm btn-primary" data-stock-action="entrada" data-id="${p.id}" data-name="${esc(p.nombre)}">+ Entrada</button>
          <button class="btn btn-sm btn-secondary" data-stock-action="salida" data-id="${p.id}" data-name="${esc(p.nombre)}">- Salida</button>
        </div>
        <div id="stock-inline-${p.id}" style="display:none;margin-top:var(--sp-3);"></div>
      </div>`;
    }).join('');
  }

  function handleGridClick(e: Event) {
    const target = e.target as HTMLElement;

    const toggleBtn = target.closest('[data-lote-toggle]') as HTMLElement | null;
    if (toggleBtn) {
      const prodId = toggleBtn.dataset.loteToggle!;
      const list = document.getElementById(`lotes-${prodId}`);
      if (list) {
        const isHidden = list.style.display === 'none';
        list.style.display = isHidden ? '' : 'none';
        toggleBtn.classList.toggle('open', isHidden);
      }
      return;
    }

    const btn = target.closest('[data-stock-action]') as HTMLElement | null;
    if (!btn) return;
    const action = btn.dataset.stockAction as 'entrada' | 'salida';
    const id = btn.dataset.id!;
    const name = btn.dataset.name!;
    showInlineForm(id, name, action);
  }

  function showInlineForm(productoId: string, productoNombre: string, tipo: 'entrada' | 'salida') {
    document.querySelectorAll('[id^="stock-inline-"]').forEach(el => {
      (el as HTMLElement).style.display = 'none';
      (el as HTMLElement).innerHTML = '';
    });

    const inlineContainer = document.getElementById(`stock-inline-${productoId}`)!;

    if (tipo === 'entrada') {
      const motivos = '<option value="cosecha">Cosecha</option><option value="compra">Compra</option><option value="devolucion">Devolucion</option><option value="ajuste">Ajuste</option>';
      inlineContainer.innerHTML = `
        <div class="grid-2" style="gap:var(--sp-2);">
          <input type="number" id="inline-qty-${productoId}" class="form-control" min="1" placeholder="Cantidad" style="padding:8px;" />
          <select id="inline-motivo-${productoId}" class="form-control" style="padding:8px;">${motivos}</select>
        </div>
        <div class="grid-2" style="gap:var(--sp-2);margin-top:var(--sp-2);">
          <input type="text" id="inline-lote-${productoId}" class="form-control" placeholder="Nro lote (ej: L001)" style="padding:8px;" />
          <input type="date" id="inline-venc-${productoId}" class="form-control" style="padding:8px;" title="Vencimiento" />
        </div>
        <div style="margin-top:var(--sp-2);">
          <input type="text" id="inline-ubic-${productoId}" class="form-control" placeholder="Ubicacion (opcional)" style="padding:8px;" />
        </div>
        <div style="display:flex;gap:var(--sp-2);margin-top:var(--sp-2);">
          <button class="btn btn-sm btn-primary" id="inline-confirm-${productoId}">Confirmar</button>
          <button class="btn btn-sm btn-secondary" id="inline-cancel-${productoId}">Cancelar</button>
        </div>
      `;
    } else {
      const pLotes = lotesForProduct(productoId);
      const motivos = '<option value="venta">Venta</option><option value="merma">Merma</option><option value="ajuste">Ajuste</option>';

      let loteSelect = '';
      if (pLotes.length > 0) {
        const opts = pLotes.map(l => {
          const vencLabel = l.vencimiento ? ` - Vence: ${formatDate(l.vencimiento)}` : '';
          const ubicLabel = l.ubicacion ? ` (${l.ubicacion})` : '';
          return `<option value="${l.id}">${esc(l.numero)}: ${l.cantidad} uds${vencLabel}${ubicLabel}</option>`;
        }).join('');
        loteSelect = `
          <div style="margin-top:var(--sp-2);">
            <select id="inline-lote-sel-${productoId}" class="form-control" style="padding:8px;">
              <option value="">FEFO automatico</option>
              ${opts}
            </select>
          </div>
        `;
      }

      inlineContainer.innerHTML = `
        <div class="grid-2" style="gap:var(--sp-2);">
          <input type="number" id="inline-qty-${productoId}" class="form-control" min="1" placeholder="Cantidad" style="padding:8px;" />
          <select id="inline-motivo-${productoId}" class="form-control" style="padding:8px;">${motivos}</select>
        </div>
        ${loteSelect}
        <div style="display:flex;gap:var(--sp-2);margin-top:var(--sp-2);">
          <button class="btn btn-sm btn-primary" id="inline-confirm-${productoId}">Confirmar</button>
          <button class="btn btn-sm btn-secondary" id="inline-cancel-${productoId}">Cancelar</button>
        </div>
      `;
    }

    inlineContainer.style.display = '';

    document.getElementById(`inline-cancel-${productoId}`)!.addEventListener('click', () => {
      inlineContainer.style.display = 'none';
      inlineContainer.innerHTML = '';
    });

    document.getElementById(`inline-confirm-${productoId}`)!.addEventListener('click', async () => {
      const qty = Number((document.getElementById(`inline-qty-${productoId}`) as HTMLInputElement).value);
      const motivo = (document.getElementById(`inline-motivo-${productoId}`) as HTMLSelectElement).value;

      if (!qty || qty <= 0) { showToast('Ingresa una cantidad valida', 'error'); return; }

      if (tipo === 'salida') {
        const confirmEl = document.getElementById(`inline-confirm-${productoId}`) as HTMLButtonElement;
        if (confirmEl.dataset.confirmed !== 'true') {
          confirmEl.textContent = `Confirmar -${qty}?`;
          confirmEl.classList.replace('btn-primary', 'btn-danger');
          confirmEl.dataset.confirmed = 'true';
          return;
        }
      }

      try {
        if (tipo === 'entrada') {
          const loteNumero = (document.getElementById(`inline-lote-${productoId}`) as HTMLInputElement).value.trim();
          const vencStr = (document.getElementById(`inline-venc-${productoId}`) as HTMLInputElement).value;
          const ubicacion = (document.getElementById(`inline-ubic-${productoId}`) as HTMLInputElement).value.trim();

          const loteInfo = {
            numero: loteNumero || undefined!,
            vencimiento: vencStr ? new Date(vencStr + 'T00:00:00') : null,
            ubicacion: ubicacion || '',
          };
          const hasLoteInfo = loteNumero || vencStr;
          await recordStockEntry(
            productoId, productoNombre, qty,
            motivo as 'cosecha' | 'compra' | 'devolucion' | 'ajuste',
            hasLoteInfo ? loteInfo : undefined,
          );
        } else {
          const loteSelEl = document.getElementById(`inline-lote-sel-${productoId}`) as HTMLSelectElement | null;
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

  return () => unsub();
}
