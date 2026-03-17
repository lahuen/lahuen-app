import { recordSale } from '../lib/stock';
import { getProductos, getProspectos, getLotes, subscribe } from '../lib/store';
import { formatCurrency } from '../lib/format';
import { esc } from '../lib/sanitize';
import { showToast } from '../lib/toast';

interface CartItem {
  productoId: string;
  productoNombre: string;
  cantidad: number;
  precioUnitario: number;
  unidad: string;
}

/** Pick best lote by FEFO (first expiry first out) from local cache */
function findLocalFefoLote(productoId: string): string | undefined {
  const lotes = getLotes()
    .filter(l => l.productoId === productoId && l.cantidad > 0)
    .sort((a, b) => {
      if (!a.vencimiento && !b.vencimiento) return 0;
      if (!a.vencimiento) return 1;
      if (!b.vencimiento) return -1;
      return a.vencimiento.toDate().getTime() - b.vencimiento.toDate().getTime();
    });
  return lotes[0]?.id;
}

export function renderPosDashboard(container: HTMLElement): (() => void) | null {
  let cart: CartItem[] = [];
  let selectedProspectoId: string | undefined;
  let selectedProspectoLocal: string | undefined;
  let isProcessing = false;

  container.innerHTML = `
    <div class="pos-layout">
      <div class="pos-header">
        <button class="btn btn-secondary btn-sm" id="pos-back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
          Volver
        </button>
        <h2 class="pos-title">Punto de Venta</h2>
        <button class="btn btn-secondary btn-sm" id="pos-clear-cart">Vaciar</button>
      </div>

      <div class="pos-body">
        <div class="pos-products-panel">
          <div class="pos-search-wrap">
            <input type="text" class="form-control" id="pos-search"
                   placeholder="Buscar producto..." autocomplete="off" />
          </div>
          <div class="pos-product-grid" id="pos-product-grid"></div>
        </div>

        <div class="pos-cart-panel">
          <div class="pos-cart-items" id="pos-cart-items"></div>
          <div class="pos-cart-footer">
            <div class="pos-cliente-row" id="pos-cliente-row">
              <input type="text" class="form-control" id="pos-cliente-search"
                     placeholder="Cliente (opcional)" autocomplete="off" />
              <div id="pos-cliente-suggestions" class="pos-suggestions" style="display:none;"></div>
            </div>
            <div class="pos-total-row">
              <span class="pos-total-label">Total</span>
              <span class="pos-total-value" id="pos-total">${formatCurrency(0)}</span>
            </div>
            <button class="btn btn-primary pos-confirm-btn" id="pos-confirm" disabled>
              Confirmar Venta
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  // --- Event listeners ---

  document.getElementById('pos-back')!.addEventListener('click', () => {
    window.location.hash = '#stock';
  });

  document.getElementById('pos-clear-cart')!.addEventListener('click', () => {
    if (cart.length === 0) return;
    cart = [];
    selectedProspectoId = undefined;
    selectedProspectoLocal = undefined;
    const clienteInput = document.getElementById('pos-cliente-search') as HTMLInputElement;
    if (clienteInput) clienteInput.value = '';
    renderCart();
    renderProducts();
  });

  // Search (debounced)
  let searchTimer: ReturnType<typeof setTimeout>;
  document.getElementById('pos-search')!.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderProducts, 200);
  });

  // Product grid: event delegation
  document.getElementById('pos-product-grid')!.addEventListener('click', (e) => {
    const card = (e.target as HTMLElement).closest('.pos-product-card') as HTMLElement | null;
    if (!card || card.classList.contains('pos-product-disabled')) return;
    const id = card.dataset.id;
    if (id) addToCart(id);
  });

  // Cart: event delegation
  document.getElementById('pos-cart-items')!.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
    if (!btn) return;
    const action = btn.dataset.action!;
    const idx = Number(btn.dataset.index);
    if (isNaN(idx) || idx < 0 || idx >= cart.length) return;

    if (action === 'inc') {
      const producto = getProductos().find(p => p.id === cart[idx].productoId);
      if (producto && cart[idx].cantidad < producto.cantidad) {
        cart[idx].cantidad++;
      } else {
        showToast('Stock insuficiente', 'error');
        return;
      }
    } else if (action === 'dec') {
      cart[idx].cantidad--;
      if (cart[idx].cantidad <= 0) cart.splice(idx, 1);
    } else if (action === 'remove') {
      cart.splice(idx, 1);
    }
    renderCart();
    renderProducts();
  });

  // Cart: price input changes
  document.getElementById('pos-cart-items')!.addEventListener('input', (e) => {
    const input = e.target as HTMLInputElement;
    if (!input.classList.contains('pos-price-input')) return;
    const idx = Number(input.dataset.index);
    if (isNaN(idx) || idx < 0 || idx >= cart.length) return;
    const val = Number(input.value);
    if (!isNaN(val) && val >= 0) {
      cart[idx].precioUnitario = val;
      updateTotal();
    }
  });

  // Cliente search
  let clienteTimer: ReturnType<typeof setTimeout>;
  const clienteInput = document.getElementById('pos-cliente-search') as HTMLInputElement;
  clienteInput.addEventListener('input', () => {
    clearTimeout(clienteTimer);
    clienteTimer = setTimeout(() => renderClienteSuggestions(clienteInput.value.trim()), 200);
  });
  clienteInput.addEventListener('focus', () => {
    if (clienteInput.value.trim()) renderClienteSuggestions(clienteInput.value.trim());
  });

  document.getElementById('pos-cliente-suggestions')!.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest('.pos-suggestion-item') as HTMLElement | null;
    if (!item) return;
    selectedProspectoId = item.dataset.id;
    selectedProspectoLocal = item.dataset.local;
    clienteInput.value = selectedProspectoLocal || '';
    document.getElementById('pos-cliente-suggestions')!.style.display = 'none';
  });

  // Close suggestions on outside click
  document.addEventListener('click', (e) => {
    const suggestions = document.getElementById('pos-cliente-suggestions');
    if (suggestions && !suggestions.contains(e.target as Node) && e.target !== clienteInput) {
      suggestions.style.display = 'none';
    }
  });

  // Confirm sale (two-step: first click asks, second confirms)
  let confirmPending = false;
  const confirmBtn = document.getElementById('pos-confirm') as HTMLButtonElement;
  confirmBtn.addEventListener('click', () => {
    if (cart.length === 0 || isProcessing) return;
    if (!confirmPending) {
      const total = cart.reduce((sum, item) => sum + item.cantidad * item.precioUnitario, 0);
      const count = cart.reduce((sum, item) => sum + item.cantidad, 0);
      confirmBtn.textContent = `Confirmar ${count} items por ${formatCurrency(total)}?`;
      confirmBtn.classList.replace('btn-primary', 'btn-danger');
      confirmPending = true;
      return;
    }
    confirmPending = false;
    processSale();
  });

  // Keyboard shortcuts
  function handleKeyboard(e: KeyboardEvent) {
    const tag = (document.activeElement?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      if (e.key === 'Escape') (document.activeElement as HTMLElement).blur();
      return;
    }
    if (e.key === '/' || (e.key === 'f' && (e.metaKey || e.ctrlKey))) {
      e.preventDefault();
      (document.getElementById('pos-search') as HTMLInputElement)?.focus();
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      processSale();
    }
    if (e.key === 'Escape') {
      if (cart.length > 0) {
        cart = [];
        renderCart();
        renderProducts();
      } else {
        window.location.hash = '#stock';
      }
    }
  }
  document.addEventListener('keydown', handleKeyboard);

  // --- Render functions ---

  function renderProducts() {
    const grid = document.getElementById('pos-product-grid');
    if (!grid) return;
    const searchQ = ((document.getElementById('pos-search') as HTMLInputElement)?.value || '').toLowerCase();
    const productos = getProductos();
    const filtered = searchQ
      ? productos.filter(p => p.nombre.toLowerCase().includes(searchQ) || (p.proveedor || '').toLowerCase().includes(searchQ))
      : productos;

    if (filtered.length === 0) {
      grid.innerHTML = '<div class="empty-state"><p>Sin resultados</p></div>';
      return;
    }

    grid.innerHTML = filtered.map(p => {
      const inCart = cart.find(c => c.productoId === p.id);
      const isZero = p.cantidad <= 0;
      return `
        <div class="pos-product-card ${isZero ? 'pos-product-disabled' : ''}" data-id="${p.id}">
          <div class="pos-product-name">${esc(p.nombre)}</div>
          <div class="pos-product-meta">
            <span class="text-secondary text-xs">${p.cantidad} ${esc(p.unidad)}</span>
            <span class="text-accent text-xs">${formatCurrency(p.precio)}</span>
          </div>
          ${inCart ? `<span class="pos-product-in-cart">${inCart.cantidad} en carrito</span>` : ''}
        </div>`;
    }).join('');
  }

  function addToCart(productoId: string) {
    const producto = getProductos().find(p => p.id === productoId);
    if (!producto || producto.cantidad <= 0) return;

    const existing = cart.find(c => c.productoId === productoId);
    if (existing) {
      if (existing.cantidad >= producto.cantidad) {
        showToast('Stock insuficiente', 'error');
        return;
      }
      existing.cantidad++;
    } else {
      cart.push({
        productoId,
        productoNombre: producto.nombre,
        cantidad: 1,
        precioUnitario: producto.precio,
        unidad: producto.unidad,
      });
    }
    renderCart();
    renderProducts();
  }

  function renderCart() {
    const el = document.getElementById('pos-cart-items');
    if (!el) return;
    resetConfirmBtn();

    el.innerHTML = cart.map((item, i) => `
      <div class="pos-cart-row" data-index="${i}">
        <div class="pos-cart-item-info">
          <span class="pos-cart-item-name">${esc(item.productoNombre)}</span>
          <div class="pos-cart-qty-controls">
            <button class="btn btn-xs btn-secondary" data-action="dec" data-index="${i}">&minus;</button>
            <span class="pos-cart-qty">${item.cantidad}</span>
            <button class="btn btn-xs btn-secondary" data-action="inc" data-index="${i}">+</button>
            <span class="text-xs text-secondary">${esc(item.unidad)}</span>
          </div>
        </div>
        <div class="pos-cart-item-pricing">
          <input type="number" class="pos-price-input" data-index="${i}"
                 value="${item.precioUnitario}" min="0" step="1" />
          <span class="pos-cart-subtotal">${formatCurrency(item.cantidad * item.precioUnitario)}</span>
        </div>
        <button class="btn btn-xs btn-danger" data-action="remove" data-index="${i}">&times;</button>
      </div>
    `).join('');

    updateTotal();
  }

  function updateTotal() {
    const total = cart.reduce((sum, item) => sum + item.cantidad * item.precioUnitario, 0);
    const totalEl = document.getElementById('pos-total');
    if (totalEl) totalEl.textContent = formatCurrency(total);
  }

  function renderClienteSuggestions(query: string) {
    const suggestions = document.getElementById('pos-cliente-suggestions')!;
    if (!query) { suggestions.style.display = 'none'; return; }

    const prospectos = getProspectos() as (import('../lib/types').Prospecto & { id: string })[];
    const matches = prospectos
      .filter(p => p.local.toLowerCase().includes(query.toLowerCase())
                || p.contacto.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 5);

    if (matches.length === 0) { suggestions.style.display = 'none'; return; }

    suggestions.style.display = '';
    suggestions.innerHTML = matches.map(p => `
      <div class="pos-suggestion-item" data-id="${p.id}" data-local="${esc(p.local)}">
        <strong>${esc(p.local)}</strong>
        <span class="text-xs text-secondary">${esc(p.contacto)}</span>
      </div>
    `).join('');
  }

  function resetConfirmBtn() {
    const btn = document.getElementById('pos-confirm') as HTMLButtonElement;
    if (!btn) return;
    confirmPending = false;
    btn.classList.replace('btn-danger', 'btn-primary');
    btn.disabled = cart.length === 0;
    btn.textContent = 'Confirmar Venta';
  }

  async function processSale() {
    if (isProcessing || cart.length === 0) return;

    // Re-validate stock
    const productos = getProductos();
    for (const item of cart) {
      const p = productos.find(pr => pr.id === item.productoId);
      if (!p || p.cantidad < item.cantidad) {
        showToast(`Stock insuficiente: ${item.productoNombre} (disponible: ${p?.cantidad ?? 0})`, 'error');
        resetConfirmBtn();
        return;
      }
    }

    isProcessing = true;
    const btn = document.getElementById('pos-confirm') as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = 'Procesando...';

    const total = cart.reduce((sum, item) => sum + item.cantidad * item.precioUnitario, 0);
    const errors: string[] = [];
    const sold: CartItem[] = [];

    try {
      for (const item of cart) {
        try {
          const fefoLoteId = findLocalFefoLote(item.productoId);
          await recordSale(
            item.productoId,
            item.productoNombre,
            item.cantidad,
            selectedProspectoId,
            selectedProspectoLocal,
            item.precioUnitario,
            fefoLoteId,
          );
          sold.push(item);
        } catch (err) {
          errors.push(`${item.productoNombre}: ${err instanceof Error ? err.message : 'Error'}`);
        }
      }

      if (errors.length > 0 && sold.length > 0) {
        // Partial success: remove sold items, keep failed ones
        cart = cart.filter(c => !sold.includes(c));
        showToast(`${sold.length} vendidos, ${errors.length} con error: ${errors.join(', ')}`, 'error');
      } else if (errors.length > 0) {
        showToast(`Error: ${errors.join(', ')}`, 'error');
      } else {
        showToast('Venta registrada', 'success');
        cart = [];
        selectedProspectoId = undefined;
        selectedProspectoLocal = undefined;
        const ci = document.getElementById('pos-cliente-search') as HTMLInputElement;
        if (ci) ci.value = '';
        import('../lib/qr-pago').then(m => m.showQrPagoModal(total)).catch(() => {});
      }
    } catch (err) {
      showToast(`Error inesperado: ${err instanceof Error ? err.message : 'Error'}`, 'error');
    } finally {
      isProcessing = false;
      renderCart();
      renderProducts();
      resetConfirmBtn();
    }
  }

  // --- Init ---
  const unsub = subscribe(() => renderProducts(), ['productos', 'prospectos']);
  renderProducts();
  renderCart();

  return () => {
    unsub();
    document.removeEventListener('keydown', handleKeyboard);
  };
}
