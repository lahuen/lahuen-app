import { collection, onSnapshot, query, orderBy, addDoc, Timestamp } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { esc } from '../lib/sanitize';
import { showToast } from '../lib/toast';
import { logAudit } from '../lib/audit';
import { formatCurrency, formatDate } from '../lib/format';
import { recordStockEntry, recordStockExit } from '../lib/stock';
import type { Producto } from '../lib/types';

export function renderStockDashboard(container: HTMLElement): (() => void) | null {
  let allProducts: (Producto & { id: string })[] = [];

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
            <div class="grid-2">
              <div class="form-group">
                <label class="form-label">Lote</label>
                <input type="text" name="lote" class="form-control" placeholder="Opcional" />
              </div>
              <div class="form-group">
                <label class="form-label">Vencimiento</label>
                <input type="date" name="vencimiento" class="form-control" />
              </div>
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

  // Product form submit
  const productForm = document.getElementById('product-form') as HTMLFormElement;
  productForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const vencStr = (productForm.vencimiento as HTMLInputElement).value;
      const nombreValue = (productForm.nombre as HTMLInputElement).value.trim();
      const ref = await addDoc(collection(db, 'productos'), {
        nombre: nombreValue,
        cantidad: 0,
        unidad: (productForm.unidad as HTMLSelectElement).value,
        precio: Number((productForm.precio as HTMLInputElement).value) || 0,
        proveedor: (productForm.proveedor as HTMLInputElement).value.trim(),
        lote: (productForm.lote as HTMLInputElement).value.trim(),
        imagen: (productForm.imagen as HTMLInputElement).value.trim(),
        vencimiento: vencStr ? Timestamp.fromDate(new Date(vencStr + 'T00:00:00')) : null,
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
  const q = query(collection(db, 'productos'), orderBy('nombre'));
  const unsub = onSnapshot(q, (snap) => {
    allProducts = snap.docs.map(d => ({ id: d.id, ...d.data() } as Producto & { id: string }));
    renderGrid();
    updateKpis();
  });

  function updateKpis() {
    const total = allProducts.length;
    const value = allProducts.reduce((sum, p) => sum + (p.cantidad * p.precio), 0);
    const low = allProducts.filter(p => p.cantidad > 0 && p.cantidad < 20).length;
    const zero = allProducts.filter(p => p.cantidad === 0).length;
    const now = new Date();
    const weekFromNow = new Date(now.getTime() + 7 * 86400000);
    const expiring = allProducts.filter(p => {
      if (!p.vencimiento) return false;
      const d = p.vencimiento.toDate();
      return d <= weekFromNow;
    }).length;

    document.getElementById('stock-total')!.textContent = String(total);
    document.getElementById('stock-value')!.textContent = formatCurrency(value);
    document.getElementById('stock-low')!.textContent = String(low);
    document.getElementById('stock-expiring')!.textContent = String(expiring);
    document.getElementById('stock-zero')!.textContent = String(zero);
  }

  function renderGrid() {
    const grid = document.getElementById('stock-grid')!;
    document.getElementById('stock-count')!.textContent = allProducts.length + ' productos';

    if (allProducts.length === 0) {
      grid.innerHTML = '<div class="empty-state"><p>Sin productos. Agrega uno para empezar.</p></div>';
      return;
    }

    grid.innerHTML = allProducts.map(p => {
      const isLow = p.cantidad > 0 && p.cantidad < 20;
      const isZero = p.cantidad === 0;
      const isExpired = p.vencimiento && p.vencimiento.toDate() <= new Date();
      const cls = isExpired ? 'expired' : (isLow || isZero ? 'low-stock' : '');

      const imgHtml = p.imagen ? `<img src="${esc(p.imagen)}" alt="${esc(p.nombre)}" class="stock-card-img" />` : '';

      return `<div class="stock-card ${cls}" data-id="${p.id}">
        ${imgHtml}
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:var(--sp-3);">
          <div>
            <strong>${esc(p.nombre)}</strong>
            <div class="text-secondary text-xs">${esc(p.proveedor || '')}${p.lote ? ' / Lote: ' + esc(p.lote) : ''}</div>
          </div>
          <span class="badge ${isZero ? 'badge-danger' : isLow ? 'badge-warning' : 'badge-success'}">${p.cantidad} ${esc(p.unidad)}</span>
        </div>
        <div class="text-xs text-secondary" style="margin-bottom:var(--sp-3);">
          ${p.precio ? formatCurrency(p.precio) + ' / ' + esc(p.unidad) : ''}
          ${p.vencimiento ? ' &middot; Vence: ' + formatDate(p.vencimiento) : ''}
          ${p.updatedBy ? `<br>Editado por ${esc(p.updatedBy.split('@')[0])}` : ''}
        </div>
        <div style="display:flex;gap:var(--sp-2);">
          <button class="btn btn-sm btn-primary" data-stock-action="entrada" data-id="${p.id}" data-name="${esc(p.nombre)}">+ Entrada</button>
          <button class="btn btn-sm btn-secondary" data-stock-action="salida" data-id="${p.id}" data-name="${esc(p.nombre)}">- Salida</button>
        </div>
        <div id="stock-inline-${p.id}" style="display:none;margin-top:var(--sp-3);"></div>
      </div>`;
    }).join('');

    grid.addEventListener('click', handleStockAction);
  }

  function handleStockAction(e: Event) {
    const btn = (e.target as HTMLElement).closest('[data-stock-action]') as HTMLElement | null;
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
    const motivos = tipo === 'entrada'
      ? '<option value="cosecha">Cosecha</option><option value="compra">Compra</option><option value="devolucion">Devolucion</option><option value="ajuste">Ajuste</option>'
      : '<option value="venta">Venta</option><option value="merma">Merma</option><option value="ajuste">Ajuste</option>';

    container.innerHTML = `
      <div class="grid-2" style="gap:var(--sp-2);">
        <input type="number" id="inline-qty-${productoId}" class="form-control" min="1" placeholder="Cantidad" style="padding:8px;" />
        <select id="inline-motivo-${productoId}" class="form-control" style="padding:8px;">${motivos}</select>
      </div>
      <div style="display:flex;gap:var(--sp-2);margin-top:var(--sp-2);">
        <button class="btn btn-sm btn-primary" id="inline-confirm-${productoId}">Confirmar</button>
        <button class="btn btn-sm btn-secondary" id="inline-cancel-${productoId}">Cancelar</button>
      </div>
    `;
    container.style.display = '';

    document.getElementById(`inline-cancel-${productoId}`)!.addEventListener('click', () => {
      container.style.display = 'none';
      container.innerHTML = '';
    });

    document.getElementById(`inline-confirm-${productoId}`)!.addEventListener('click', async () => {
      const qty = Number((document.getElementById(`inline-qty-${productoId}`) as HTMLInputElement).value);
      const motivo = (document.getElementById(`inline-motivo-${productoId}`) as HTMLSelectElement).value;

      if (!qty || qty <= 0) { showToast('Ingresa una cantidad valida', 'error'); return; }

      try {
        if (tipo === 'entrada') {
          await recordStockEntry(productoId, productoNombre, qty, motivo as 'cosecha' | 'compra' | 'devolucion' | 'ajuste');
        } else {
          await recordStockExit(productoId, productoNombre, qty, motivo as 'merma' | 'ajuste');
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

  return () => unsub();
}
