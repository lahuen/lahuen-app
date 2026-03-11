import { collection, addDoc, Timestamp } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { esc } from '../lib/sanitize';
import { showToast } from '../lib/toast';
import { logAudit } from '../lib/audit';
import { formatCurrency, formatDate } from '../lib/format';
import { recordStockEntry, recordStockExit, recordSale } from '../lib/stock';
import { getProductos, getLotes, getMovimientos, subscribe } from '../lib/store';
import { computeAllProductMetrics, computeLoteHealth, computeDaysRemaining, computeShelfLifePercent } from '../lib/stock-metrics';
import type { Producto, Lote, Movimiento } from '../lib/types';

export function renderStockDashboard(container: HTMLElement): (() => void) | null {
  const expandedIds = new Set<string>();
  const aiResults = new Map<string, string>();
  let viewMode: 'cards' | 'treemap' = (localStorage.getItem('lahuen_stock_view') as 'cards' | 'treemap') || 'cards';
  let treemapCleanup: (() => void) | null = null;

  container.innerHTML = `
    <div class="page">
      <div class="stat-grid" style="margin-bottom:var(--sp-4);">
        <div class="stat-card"><p class="stat-label">Unidades totales</p><p class="stat-value" id="stock-total">--</p></div>
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
        <div class="view-toggle" id="view-toggle">
          <button class="view-toggle-btn ${viewMode === 'cards' ? 'active' : ''}" data-view="cards">Cards</button>
          <button class="view-toggle-btn ${viewMode === 'treemap' ? 'active' : ''}" data-view="treemap">Treemap</button>
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

  // Search (debounced)
  const stockSearch = document.getElementById('stock-search') as HTMLInputElement;
  let searchTimer: ReturnType<typeof setTimeout>;
  stockSearch.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(refresh, 200);
  });

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

  // View toggle
  document.getElementById('view-toggle')!.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-view]') as HTMLElement | null;
    if (!btn) return;
    const newMode = btn.dataset.view as 'cards' | 'treemap';
    if (newMode === viewMode) return;
    viewMode = newMode;
    localStorage.setItem('lahuen_stock_view', viewMode);
    document.querySelectorAll('#view-toggle .view-toggle-btn').forEach(b => {
      b.classList.toggle('active', (b as HTMLElement).dataset.view === viewMode);
    });
    refresh();
  });

  // Insights refresh button
  document.getElementById('insights-refresh')!.addEventListener('click', () => {
    import('../lib/stock-insights').then(({ clearInsightsCache }) => {
      clearInsightsCache();
      loadInsights();
    });
  });

  // Subscribe to global store
  const unsub = subscribe(refresh, ['productos', 'lotes', 'movimientos']);
  refresh();
  loadInsights();

  function refresh() {
    if (treemapCleanup) { treemapCleanup(); treemapCleanup = null; }
    if (viewMode === 'treemap') {
      renderTreemapView();
    } else {
      renderGrid();
    }
    updateKpis();
    renderAlerts();
  }

  function renderTreemapView() {
    const grid = document.getElementById('stock-grid');
    if (!grid) return;
    const searchQ = (stockSearch?.value || '').toLowerCase();
    const allProducts = getProductos();
    const filtered = searchQ
      ? allProducts.filter(p => p.nombre.toLowerCase().includes(searchQ) || (p.proveedor || '').toLowerCase().includes(searchQ))
      : allProducts;
    document.getElementById('stock-count')!.textContent = filtered.length + ' productos';

    import('./stock-treemap').then(({ renderStockTreemap }) => {
      treemapCleanup = renderStockTreemap(grid, searchQ);
    }).catch(() => {
      grid.innerHTML = '<div class="empty-state"><p>Error cargando treemap</p></div>';
    });
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

  function movimientosForProduct(productoId: string): (Movimiento & { id: string })[] {
    return getMovimientos()
      .filter(m => m.productoId === productoId)
      .slice(0, 5);
  }

  function updateKpis() {
    const allProducts = getProductos();
    const allLotes = getLotes();
    const total = allProducts.reduce((sum, p) => sum + p.cantidad, 0);
    const value = allProducts.reduce((sum, p) => sum + (p.cantidad * p.precio), 0);
    const low = allProducts.filter(p => p.cantidad > 0 && p.cantidad < 20).length;
    const zero = allProducts.filter(p => p.cantidad === 0).length;

    const now = new Date();
    const weekFromNow = new Date(now.getTime() + 7 * 86400000);
    const expiring = allLotes.filter(l => {
      if (l.cantidad <= 0 || !l.vencimiento) return false;
      return l.vencimiento.toDate() <= weekFromNow;
    }).length;

    document.getElementById('stock-total')!.textContent = total.toLocaleString('es-AR');
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

    const zeroStock = getProductos().filter(p => p.cantidad === 0);
    if (zeroStock.length > 0) {
      alerts.push({
        icon: 'box',
        text: `Sin stock: ${zeroStock.map(p => p.nombre).join(', ')}`,
        cls: 'alert-danger',
      });
    }

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

    if (alerts.length === 0) { el.innerHTML = ''; return; }

    const iconSvg: Record<string, string> = {
      clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
      box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>',
      undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>',
    };

    el.innerHTML = `<div class="stock-alerts">${alerts.map(a => `
      <div class="alert-item ${a.cls}">
        <span class="alert-icon">${iconSvg[a.icon] || ''}</span>
        <span>${esc(a.text)}</span>
      </div>
    `).join('')}</div>`;
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

  function timeAgo(ts: Timestamp): string {
    const diff = Date.now() - ts.toDate().getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return 'hoy';
    if (days === 1) return 'ayer';
    if (days < 7) return `hace ${days}d`;
    if (days < 30) return `hace ${Math.floor(days / 7)}sem`;
    return formatDate(ts);
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

    const metricsMap = computeAllProductMetrics();

    grid.innerHTML = filtered.map(p => {
      const m = metricsMap.get(p.id) || { totalValue: 0, weeklyVelocity: 0, daysToStockout: null, lastMovementDate: null, activeLotes: 0, expiringLotes: 0, expiredLotes: 0 };
      const pLotes = lotesForProduct(p.id);
      const isZero = p.cantidad === 0;
      const isLow = p.cantidad > 0 && p.cantidad < 20;
      const isExpanded = expandedIds.has(p.id);

      // Lote health dots
      const dots = pLotes.map(l => {
        const health = computeLoteHealth(l);
        return `<span class="lote-dot lote-dot-${health}" title="${esc(l.numero)}: ${computeDaysRemaining(l.vencimiento) ?? '--'}d"></span>`;
      }).join('');

      // Velocity / stockout labels
      const velLabel = m.weeklyVelocity > 0 ? `${m.weeklyVelocity}/sem` : '--';
      const stockoutLabel = m.daysToStockout != null ? `~${m.daysToStockout}d` : '--';

      // Expanded content
      let expandedHtml = '';
      if (isExpanded) {
        expandedHtml = renderExpanded(p, pLotes, m);
      }

      return `<div class="stock-card stock-card-compact ${isExpanded ? 'expanded' : ''}" data-id="${p.id}">
        <div class="stock-card-header" data-expand="${p.id}">
          <div class="stock-card-info">
            <strong>${esc(p.nombre)}</strong>
            <span class="text-xs text-secondary">${esc(p.proveedor || '')}</span>
          </div>
          <span class="badge ${isZero ? 'badge-danger' : isLow ? 'badge-warning' : 'badge-success'}">${p.cantidad} ${esc(p.unidad)}</span>
        </div>
        <div class="stock-card-metrics" data-expand="${p.id}">
          <span class="metric">${formatCurrency(m.totalValue)}</span>
          <span class="metric">${velLabel}</span>
          <span class="metric">${stockoutLabel}</span>
          <span class="metric lote-dots">${dots || '<span class="text-tertiary">--</span>'}</span>
          <svg class="expand-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M9 18l6-6-6-6"/></svg>
        </div>
        ${expandedHtml}
      </div>`;
    }).join('');
  }

  function renderExpanded(p: Producto & { id: string }, pLotes: (Lote & { id: string })[], m: { totalValue: number; weeklyVelocity: number; daysToStockout: number | null }): string {
    const movs = movimientosForProduct(p.id);

    // Lotes section
    const lotesHtml = pLotes.length > 0 ? pLotes.map((l, i) => {
      const health = computeLoteHealth(l);
      const days = computeDaysRemaining(l.vencimiento);
      const percent = computeShelfLifePercent(l.fechaIngreso, l.vencimiento);
      const isFefo = i === 0;
      return `<div class="lote-detail ${isFefo ? 'lote-fefo' : ''}">
        <div class="lote-detail-header">
          <span class="lote-numero">${esc(l.numero)}</span>
          ${isFefo ? '<span class="badge badge-accent" style="font-size:10px;">FEFO</span>' : ''}
          <span class="lote-qty">${l.cantidad} uds</span>
          ${l.ubicacion ? `<span class="lote-ubic">${esc(l.ubicacion)}</span>` : ''}
        </div>
        <div class="lote-shelf-life">
          <div class="shelf-life-bar"><div class="shelf-life-fill shelf-life-${health}" style="width:${percent}%"></div></div>
          <span class="text-xs ${health === 'danger' || health === 'expired' ? 'text-danger' : 'text-secondary'}">${days != null ? (days <= 0 ? 'Vencido' : days + 'd') : 'Sin venc.'}</span>
        </div>
      </div>`;
    }).join('') : '<p class="text-xs text-tertiary">Sin lotes activos</p>';

    // Recent movements
    const movsHtml = movs.length > 0 ? movs.map(mv => {
      const tipoCls = mv.tipo === 'entrada' ? 'badge-success' : 'badge-danger';
      return `<div class="mini-mov">
        <span class="badge ${tipoCls}" style="font-size:10px;padding:1px 6px;">${mv.tipo === 'entrada' ? '+' : '-'}</span>
        <span>${mv.cantidad}</span>
        <span class="text-secondary">${esc(mv.motivo)}</span>
        <span class="text-xs text-tertiary" style="margin-left:auto;">${timeAgo(mv.fecha)}</span>
      </div>`;
    }).join('') : '<p class="text-xs text-tertiary">Sin movimientos</p>';

    // AI result (if cached)
    const cachedAi = aiResults.get(p.id);
    const aiHtml = cachedAi
      ? `<div class="ai-result">${esc(cachedAi)}</div>`
      : '';

    return `<div class="stock-card-expanded">
      <div class="expanded-section">
        <h4>Lotes (${pLotes.length})</h4>
        ${lotesHtml}
      </div>
      <div class="expanded-section">
        <h4>Ultimos movimientos</h4>
        ${movsHtml}
      </div>
      <div class="expanded-actions">
        <button class="btn btn-sm btn-secondary" data-ai-analyze="${p.id}">Analizar con AI</button>
        <button class="btn btn-sm btn-primary" data-stock-action="entrada" data-id="${p.id}" data-name="${esc(p.nombre)}">+ Entrada</button>
        <button class="btn btn-sm btn-secondary" data-stock-action="salida" data-id="${p.id}" data-name="${esc(p.nombre)}">- Salida</button>
      </div>
      <div id="ai-result-${p.id}">${aiHtml}</div>
      <div id="stock-inline-${p.id}" style="display:none;margin-top:var(--sp-3);"></div>
    </div>`;
  }

  function handleGridClick(e: Event) {
    const target = e.target as HTMLElement;

    // Expand/collapse
    const expandBtn = target.closest('[data-expand]') as HTMLElement | null;
    if (expandBtn && !target.closest('button') && !target.closest('input') && !target.closest('select')) {
      const pid = expandBtn.dataset.expand!;
      if (expandedIds.has(pid)) {
        expandedIds.delete(pid);
      } else {
        expandedIds.add(pid);
      }
      renderGrid();
      return;
    }

    // AI analyze
    const aiBtn = target.closest('[data-ai-analyze]') as HTMLElement | null;
    if (aiBtn) {
      const pid = aiBtn.dataset.aiAnalyze!;
      handleAiAnalyze(pid, aiBtn as HTMLButtonElement);
      return;
    }

    // Stock actions (entrada/salida)
    const actionBtn = target.closest('[data-stock-action]') as HTMLElement | null;
    if (!actionBtn) return;
    const action = actionBtn.dataset.stockAction as 'entrada' | 'salida';
    const id = actionBtn.dataset.id!;
    const name = actionBtn.dataset.name!;
    showInlineForm(id, name, action);
  }

  async function handleAiAnalyze(productoId: string, btn: HTMLButtonElement) {
    const resultEl = document.getElementById(`ai-result-${productoId}`);
    if (!resultEl) return;

    // Check if already cached in memory
    if (aiResults.has(productoId)) {
      resultEl.innerHTML = `<div class="ai-result">${esc(aiResults.get(productoId)!)}</div>`;
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Analizando...';
    resultEl.innerHTML = '<p class="text-xs text-tertiary ai-loading">Pensando...</p>';

    try {
      const { getProductInsight } = await import('../lib/stock-insights');
      const insight = await getProductInsight(productoId);
      aiResults.set(productoId, insight);
      resultEl.innerHTML = `<div class="ai-result">${esc(insight)}</div>`;
    } catch {
      resultEl.innerHTML = '<p class="text-xs text-tertiary">Error al analizar</p>';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Analizar con AI';
    }
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

  return () => {
    unsub();
    if (treemapCleanup) { treemapCleanup(); treemapCleanup = null; }
  };
}
