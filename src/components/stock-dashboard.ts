import { collection, onSnapshot, query, orderBy, addDoc, Timestamp } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { esc } from '../lib/sanitize';
import { showToast } from '../lib/toast';
import { logAudit } from '../lib/audit';
import { formatCurrency, formatDate } from '../lib/format';
import { recordStockEntry, recordStockExit, recordSale } from '../lib/stock';
import type { Producto, Lote } from '../lib/types';

export function renderStockDashboard(container: HTMLElement): (() => void) | null {
  let allProducts: (Producto & { id: string })[] = [];
  let allLotes: (Lote & { id: string })[] = [];

  container.innerHTML = `
    <div class="page">
      <div class="stat-grid" style="margin-bottom:var(--sp-5);">
        <div class="stat-card"><p class="stat-label">Productos</p><p class="stat-value" id="stock-total">--</p></div>
        <div class="stat-card"><p class="stat-label">Valor total</p><p class="stat-value text-accent" id="stock-value">--</p></div>
        <div class="stat-card"><p class="stat-label">Stock bajo</p><p class="stat-value text-warning" id="stock-low">--</p></div>
        <div class="stat-card"><p class="stat-label">Por vencer</p><p class="stat-value text-danger" id="stock-expiring">--</p></div>
        <div class="stat-card"><p class="stat-label">Sin stock</p><p class="stat-value text-danger" id="stock-zero">--</p></div>
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
  stockSearch.addEventListener('input', renderGrid);

  // Product form submit (no lote/vencimiento — those are per-entry now)
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

  // Listen to productos
  const qProd = query(collection(db, 'productos'), orderBy('nombre'));
  const unsubProd = onSnapshot(qProd, (snap) => {
    allProducts = snap.docs.map(d => ({ id: d.id, ...d.data() } as Producto & { id: string }));
    renderGrid();
    updateKpis();
  });

  // Listen to lotes
  const qLotes = query(collection(db, 'lotes'));
  const unsubLotes = onSnapshot(qLotes, (snap) => {
    allLotes = snap.docs.map(d => ({ id: d.id, ...d.data() } as Lote & { id: string }));
    renderGrid();
    updateKpis();
  });

  function lotesForProduct(productoId: string): (Lote & { id: string })[] {
    return allLotes
      .filter(l => l.productoId === productoId && l.cantidad > 0)
      .sort((a, b) => {
        if (!a.vencimiento && !b.vencimiento) return 0;
        if (!a.vencimiento) return 1;
        if (!b.vencimiento) return -1;
        return a.vencimiento.toDate().getTime() - b.vencimiento.toDate().getTime();
      });
  }

  function updateKpis() {
    const total = allProducts.length;
    const value = allProducts.reduce((sum, p) => sum + (p.cantidad * p.precio), 0);
    const low = allProducts.filter(p => p.cantidad > 0 && p.cantidad < 20).length;
    const zero = allProducts.filter(p => p.cantidad === 0).length;

    // Count expiring from lotes (cantidad > 0, vencimiento <= 7 days)
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

  function renderGrid() {
    const grid = document.getElementById('stock-grid')!;
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

      // Lotes section
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

    // Event delegation
    grid.addEventListener('click', handleGridClick);
  }

  function handleGridClick(e: Event) {
    const target = e.target as HTMLElement;

    // Lote toggle
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

    // Stock action
    const btn = target.closest('[data-stock-action]') as HTMLElement | null;
    if (!btn) return;
    const action = btn.dataset.stockAction as 'entrada' | 'salida';
    const id = btn.dataset.id!;
    const name = btn.dataset.name!;
    showInlineForm(id, name, action);
  }

  function showInlineForm(productoId: string, productoNombre: string, tipo: 'entrada' | 'salida') {
    // Close any open inline forms
    document.querySelectorAll('[id^="stock-inline-"]').forEach(el => {
      (el as HTMLElement).style.display = 'none';
      (el as HTMLElement).innerHTML = '';
    });

    const container = document.getElementById(`stock-inline-${productoId}`)!;

    if (tipo === 'entrada') {
      const motivos = '<option value="cosecha">Cosecha</option><option value="compra">Compra</option><option value="devolucion">Devolucion</option><option value="ajuste">Ajuste</option>';
      container.innerHTML = `
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
      // Salida: show lote selector
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

      container.innerHTML = `
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

    container.style.display = '';

    document.getElementById(`inline-cancel-${productoId}`)!.addEventListener('click', () => {
      container.style.display = 'none';
      container.innerHTML = '';
    });

    document.getElementById(`inline-confirm-${productoId}`)!.addEventListener('click', async () => {
      const qty = Number((document.getElementById(`inline-qty-${productoId}`) as HTMLInputElement).value);
      const motivo = (document.getElementById(`inline-motivo-${productoId}`) as HTMLSelectElement).value;

      if (!qty || qty <= 0) { showToast('Ingresa una cantidad valida', 'error'); return; }

      // Confirmation for exits
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
          // Only pass loteInfo if user provided at least a lote number or vencimiento
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
        container.style.display = 'none';
        container.innerHTML = '';
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Error';
        showToast(msg, 'error');
      }
    });
  }

  return () => { unsubProd(); unsubLotes(); };
}
