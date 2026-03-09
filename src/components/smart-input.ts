import { esc } from '../lib/sanitize';
import { showToast } from '../lib/toast';
import { parseSmartInput, type SmartAction } from '../lib/gemini';
import { findBestProspectMatch } from '../lib/fuzzy-match';
import { recordStockEntry, recordStockExit, recordSale } from '../lib/stock';
import { getProductos, getProspectos, getLotes } from '../lib/store';
import { computeProductMetrics } from '../lib/stock-metrics';

let pendingInput = '';

export function renderSmartInput(container: HTMLElement): (() => void) | null {
  container.innerHTML = `
    <div class="smart-input-bar">
      <label class="smart-input-label">Entrada rapida</label>
      <div class="smart-input-row">
        <input type="text" class="smart-input" id="smart-input" placeholder="ej: cosechamos 200 bandejas lechuga, venta 50 rucula a Restaurant..." value="${esc(pendingInput)}" />
        <button class="btn btn-primary btn-sm" id="smart-send">Enviar</button>
      </div>
      <p class="smart-hint" id="smart-hint" style="display:none;"></p>
      <div id="smart-confirm" style="display:none;"></div>
    </div>
  `;

  const input = document.getElementById('smart-input') as HTMLInputElement;
  const sendBtn = document.getElementById('smart-send') as HTMLButtonElement;
  const hintEl = document.getElementById('smart-hint')!;
  const confirmEl = document.getElementById('smart-confirm')!;

  input.addEventListener('input', () => { pendingInput = input.value; });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleSend(); }
  });

  sendBtn.addEventListener('click', handleSend);

  async function handleSend() {
    const text = input.value.trim();
    if (!text) return;

    sendBtn.disabled = true;
    sendBtn.textContent = '...';
    hintEl.style.display = '';
    hintEl.innerHTML = '<span class="smart-loading">Pensando</span>';
    confirmEl.style.display = 'none';

    try {
      const result = await parseSmartInput(text);
      await handleAction(result, text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error procesando';
      hintEl.textContent = msg;
      hintEl.style.display = '';
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Enviar';
    }
  }

  async function handleAction(result: SmartAction, originalText: string) {
    if (result.action === 'error') {
      hintEl.textContent = result.message;
      return;
    }

    if (result.action === 'stock_entrada') {
      const producto = findProducto(result.producto);
      if (!producto) {
        hintEl.textContent = `Producto "${result.producto}" no encontrado. Crealo primero en Stock.`;
        return;
      }
      showConfirmation(
        `Entrada: ${result.cantidad} ${result.unidad} de ${producto.nombre} (${result.motivo})`,
        async () => {
          await recordStockEntry(producto.id!, producto.nombre, result.cantidad, result.motivo as 'cosecha' | 'compra' | 'devolucion' | 'ajuste');
          // Lote is auto-generated when no loteInfo is passed
          showToast('Entrada registrada', 'success');
          clearInput();
        },
      );
      return;
    }

    if (result.action === 'venta') {
      const producto = findProducto(result.producto);
      if (!producto) {
        hintEl.textContent = `Producto "${result.producto}" no encontrado.`;
        return;
      }

      // Fuzzy match prospect
      let prospectoId: string | undefined;
      let prospectoLocal: string | undefined;

      if (result.prospecto) {
        const prospects = getProspects();
        const match = findBestProspectMatch(result.prospecto, prospects);
        if (match) {
          prospectoId = match.id;
          prospectoLocal = match.local;
        }
      }

      const prospectoLabel = prospectoLocal
        ? `Vincular con: ${prospectoLocal}`
        : (result.prospecto ? `No se encontro "${result.prospecto}"` : 'Sin prospecto');

      showConfirmation(
        `Venta: ${result.cantidad} ${result.unidad} de ${producto.nombre}. ${prospectoLabel}`,
        async () => {
          await recordSale(producto.id!, producto.nombre, result.cantidad, prospectoId, prospectoLocal, result.precio ?? undefined);
          showToast('Venta registrada', 'success');
          clearInput();
        },
      );
      return;
    }

    if (result.action === 'stock_salida') {
      const producto = findProducto(result.producto);
      if (!producto) {
        hintEl.textContent = `Producto "${result.producto}" no encontrado.`;
        return;
      }
      showConfirmation(
        `Salida: ${result.cantidad} ${result.unidad} de ${producto.nombre} (${result.motivo})`,
        async () => {
          await recordStockExit(producto.id!, producto.nombre, result.cantidad, result.motivo as 'merma' | 'ajuste');
          showToast('Salida registrada', 'success');
          clearInput();
        },
      );
      return;
    }

    if (result.action === 'consulta') {
      const answer = answerQuery(result.query);
      hintEl.textContent = answer;
      hintEl.style.display = '';
      return;
    }

    if (result.action === 'nuevo_prospecto') {
      // Pre-fill and navigate to form
      // Store in sessionStorage so crm-form can pick it up
      sessionStorage.setItem('prefill_prospecto', JSON.stringify({
        local: result.local,
        contacto: result.contacto,
        whatsapp: result.whatsapp,
        perfil: result.perfil,
        zona: result.zona,
      }));
      hintEl.textContent = `Nuevo prospecto: ${result.local || 'sin nombre'}. Redirigiendo al formulario...`;
      setTimeout(() => { window.location.hash = '#nuevo'; clearInput(); }, 800);
    }
  }

  function showConfirmation(message: string, onConfirm: () => Promise<void>) {
    hintEl.textContent = message;
    confirmEl.style.display = '';
    confirmEl.innerHTML = `
      <div style="display:flex;gap:var(--sp-2);justify-content:flex-end;">
        <button class="btn btn-secondary btn-sm" id="smart-cancel">Cancelar</button>
        <button class="btn btn-primary btn-sm" id="smart-ok">Confirmar</button>
      </div>
    `;

    document.getElementById('smart-cancel')!.addEventListener('click', () => {
      confirmEl.style.display = 'none';
      hintEl.style.display = 'none';
    });

    document.getElementById('smart-ok')!.addEventListener('click', async () => {
      confirmEl.style.display = 'none';
      hintEl.textContent = 'Guardando...';
      try {
        await onConfirm();
        hintEl.style.display = 'none';
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Error';
        hintEl.textContent = msg;
        showToast(msg, 'error');
      }
    });
  }

  function clearInput() {
    input.value = '';
    pendingInput = '';
    hintEl.style.display = 'none';
    confirmEl.style.display = 'none';
  }

  function findProducto(nombre: string) {
    const lower = nombre.toLowerCase();
    return getProductos().find(p =>
      p.nombre.toLowerCase().includes(lower) || lower.includes(p.nombre.toLowerCase())
    ) || null;
  }

  function getProspects() {
    return getProspectos().map(p => ({ id: p.id, local: p.local, contacto: p.contacto }));
  }

  function answerQuery(query: string): string {
    const lower = query.toLowerCase();
    const productos = getProductos();
    const lotes = getLotes();

    // "cuanto stock de X?" or "tenemos de X?"
    const matchedProduct = productos.find(p => lower.includes(p.nombre.toLowerCase()));
    if (matchedProduct) {
      const m = computeProductMetrics(matchedProduct.id);
      const productLotes = lotes.filter(l => l.productoId === matchedProduct.id && l.cantidad > 0);
      let answer = `${matchedProduct.nombre}: ${matchedProduct.cantidad} ${matchedProduct.unidad}`;
      if (m.weeklyVelocity > 0) answer += `, velocidad ${m.weeklyVelocity}/sem`;
      if (m.daysToStockout != null) answer += `, stock para ~${m.daysToStockout}d`;
      if (productLotes.length > 0) answer += `, ${productLotes.length} lote(s) activo(s)`;
      if (m.expiringLotes > 0) answer += `, ${m.expiringLotes} por vencer`;
      return answer;
    }

    // "que vence esta semana?"
    if (lower.includes('vence') || lower.includes('vencimiento')) {
      const now = Date.now();
      const weekFromNow = now + 7 * 86400000;
      const expiring = lotes.filter(l =>
        l.cantidad > 0 && l.vencimiento && l.vencimiento.toDate().getTime() <= weekFromNow && l.vencimiento.toDate().getTime() > now
      );
      if (expiring.length === 0) return 'No hay lotes por vencer esta semana.';
      return `${expiring.length} lote(s) por vencer: ${expiring.map(l => {
        const days = Math.ceil((l.vencimiento!.toDate().getTime() - now) / 86400000);
        return `${l.productoNombre} (${l.numero}) en ${days}d`;
      }).join(', ')}`;
    }

    // Generic stock overview
    const total = productos.reduce((s, p) => s + p.cantidad, 0);
    const value = productos.reduce((s, p) => s + p.cantidad * p.precio, 0);
    const zeroStock = productos.filter(p => p.cantidad === 0);
    let answer = `${productos.length} productos, ${total} unidades totales, valor $${Math.round(value)}`;
    if (zeroStock.length > 0) answer += `. Sin stock: ${zeroStock.map(p => p.nombre).join(', ')}`;
    return answer;
  }

  return null;
}
