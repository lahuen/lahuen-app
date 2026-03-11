import { esc } from '../lib/sanitize';
import { showToast } from '../lib/toast';
import { parseSmartInput, askAssistant, type SmartAction } from '../lib/gemini';
import { findBestProspectMatch } from '../lib/fuzzy-match';
import { recordStockEntry, recordStockExit, recordSale } from '../lib/stock';
import { getProductos, getProspectos, getLotes } from '../lib/store';
import { computeProductMetrics } from '../lib/stock-metrics';

interface ChatMsg { role: 'user' | 'bot'; text: string }

// Module-level state — persists across hash navigations
const history: ChatMsg[] = [];
let pendingConfirm: (() => Promise<void>) | null = null;
let pendingIsVenta = false;
let pendingVentaPrecio: number | undefined = undefined;
let thinking = false;

export function renderAssistantFab(container: HTMLElement): void {
  if (history.length === 0) {
    history.push({ role: 'bot', text: 'Hola! Registra movimientos, ventas o consulta stock en lenguaje natural.' });
  }

  container.innerHTML = `
    <button class="assistant-fab" id="assistant-fab" aria-label="Asistente">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
    </button>
    <div class="assistant-panel" id="assistant-panel" style="display:none;">
      <div class="assistant-header">
        <span class="assistant-title">Asistente Lahuen</span>
        <button class="action-btn" id="assistant-close" title="Cerrar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="assistant-messages" id="assistant-messages"></div>
      <div class="assistant-footer">
        <div class="assistant-chips">
          <button class="assistant-chip" data-chip="entrada">Entrada</button>
          <button class="assistant-chip" data-chip="venta">Venta</button>
          <button class="assistant-chip" data-chip="salida">Salida</button>
          <button class="assistant-chip" data-chip="consultar">Consultar</button>
        </div>
        <div class="assistant-input-row">
          <input type="text" class="assistant-input" id="assistant-input" placeholder="ej: cosechamos 200 lechuga..." />
          <button class="assistant-send" id="assistant-send" aria-label="Enviar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
          </button>
        </div>
      </div>
    </div>
  `;

  const fab = document.getElementById('assistant-fab')!;
  const panel = document.getElementById('assistant-panel')!;
  const msgEl = document.getElementById('assistant-messages')!;
  const input = document.getElementById('assistant-input') as HTMLInputElement;
  const sendBtn = document.getElementById('assistant-send')!;

  renderMessages();

  fab.addEventListener('click', () => toggle(true));
  document.getElementById('assistant-close')!.addEventListener('click', () => toggle(false));

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleSend(); }
  });
  sendBtn.addEventListener('click', handleSend);

  // Chips pre-fill input
  container.addEventListener('click', (e) => {
    const chip = (e.target as HTMLElement).closest('[data-chip]') as HTMLElement | null;
    if (!chip) return;
    const prefills: Record<string, string> = {
      entrada: 'entrada de ',
      venta: 'venta de ',
      salida: 'salida de ',
      consultar: 'cuanto tenemos de ',
    };
    input.value = prefills[chip.dataset.chip!] || '';
    input.focus();
  });

  // Confirm/cancel delegation
  msgEl.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('#chat-confirm') && pendingConfirm) {
      const fn = pendingConfirm;
      const isVenta = pendingIsVenta;
      const ventaPrecio = pendingVentaPrecio;
      pendingConfirm = null;
      pendingIsVenta = false;
      pendingVentaPrecio = undefined;
      addBot('Guardando...');
      try {
        await fn();
        history[history.length - 1].text = 'Listo!';
        renderMessages();
        showToast('Operacion registrada', 'success');
        if (isVenta) import('../lib/qr-pago').then(m => m.showQrPagoModal(ventaPrecio)).catch(() => {});
      } catch (err) {
        history[history.length - 1].text = 'Error: ' + (err instanceof Error ? err.message : 'desconocido');
        renderMessages();
      }
    }
    if (target.closest('#chat-cancel')) {
      pendingConfirm = null;
      addBot('Cancelado.');
    }
  });

  function toggle(open: boolean) {
    panel.style.display = open ? '' : 'none';
    fab.style.display = open ? 'none' : '';
    if (open) {
      renderMessages();
      setTimeout(() => input.focus(), 100);
    }
  }

  async function handleSend() {
    const text = input.value.trim();
    if (!text) return;
    pendingConfirm = null;
    addUser(text);
    input.value = '';
    thinking = true;
    renderMessages();
    sendBtn.setAttribute('disabled', '');

    try {
      const result = await parseSmartInput(text);
      thinking = false;
      handleAction(result);
    } catch (err) {
      thinking = false;
      addBot('Error: ' + (err instanceof Error ? err.message : 'No pude procesar'));
    } finally {
      sendBtn.removeAttribute('disabled');
    }
  }

  function handleAction(result: SmartAction) {
    if (result.action === 'error') {
      addBot(result.message);
      return;
    }

    if (result.action === 'stock_entrada') {
      const producto = findProducto(result.producto);
      if (!producto) { addBot(`Producto "${result.producto}" no encontrado. Crealo primero en Stock.`); return; }
      addBot(`Entrada: ${result.cantidad} ${result.unidad} de ${producto.nombre} (${result.motivo})`);
      pendingConfirm = () => recordStockEntry(producto.id!, producto.nombre, result.cantidad, result.motivo as 'cosecha' | 'compra' | 'devolucion' | 'ajuste');
      renderMessages();
      return;
    }

    if (result.action === 'venta') {
      const producto = findProducto(result.producto);
      if (!producto) { addBot(`Producto "${result.producto}" no encontrado.`); return; }
      let prospectoId: string | undefined;
      let prospectoLocal: string | undefined;
      if (result.prospecto) {
        const prospects = getProspectos().map(p => ({ id: p.id, local: p.local, contacto: p.contacto }));
        const match = findBestProspectMatch(result.prospecto, prospects);
        if (match) { prospectoId = match.id; prospectoLocal = match.local; }
      }
      const prospectoLabel = prospectoLocal ? ` → ${prospectoLocal}` : (result.prospecto ? ` ("${result.prospecto}" no encontrado)` : '');
      addBot(`Venta: ${result.cantidad} ${result.unidad} de ${producto.nombre}${prospectoLabel}`);
      pendingIsVenta = true;
      pendingVentaPrecio = result.precio ?? undefined;
      pendingConfirm = () => recordSale(producto.id!, producto.nombre, result.cantidad, prospectoId, prospectoLocal, result.precio ?? undefined);
      renderMessages();
      return;
    }

    if (result.action === 'stock_salida') {
      const producto = findProducto(result.producto);
      if (!producto) { addBot(`Producto "${result.producto}" no encontrado.`); return; }
      addBot(`Salida: ${result.cantidad} ${result.unidad} de ${producto.nombre} (${result.motivo})`);
      pendingConfirm = () => recordStockExit(producto.id!, producto.nombre, result.cantidad, result.motivo as 'merma' | 'ajuste');
      renderMessages();
      return;
    }

    if (result.action === 'consulta') {
      // Use AI-powered contextual answer
      thinking = true;
      renderMessages();
      askAssistant(result.query).then(answer => {
        thinking = false;
        addBot(answer);
      }).catch(() => {
        thinking = false;
        addBot(answerQuery(result.query)); // fallback to local
      });
      return;
    }

    if (result.action === 'nuevo_prospecto') {
      sessionStorage.setItem('prefill_prospecto', JSON.stringify({
        local: result.local,
        contacto: result.contacto,
        whatsapp: result.whatsapp,
        perfil: result.perfil,
        zona: result.zona,
      }));
      addBot(`Nuevo prospecto: ${result.local || 'sin nombre'}. Abriendo formulario...`);
      setTimeout(() => { window.location.hash = '#nuevo'; }, 600);
    }
  }

  function addUser(text: string) {
    history.push({ role: 'user', text });
    trimHistory();
    renderMessages();
  }

  function addBot(text: string) {
    history.push({ role: 'bot', text });
    trimHistory();
    renderMessages();
  }

  function trimHistory() {
    while (history.length > 20) history.shift();
  }

  function renderMessages() {
    let html = history.map(m =>
      `<div class="assistant-msg-${m.role === 'user' ? 'user' : 'bot'}">${esc(m.text)}</div>`
    ).join('');

    if (thinking) {
      html += `<div class="assistant-msg-bot"><span class="smart-loading">Pensando</span></div>`;
    }
    if (pendingConfirm) {
      html += `<div class="assistant-msg-actions">
        <button class="btn btn-primary btn-sm" id="chat-confirm">Confirmar</button>
        <button class="btn btn-secondary btn-sm" id="chat-cancel">Cancelar</button>
      </div>`;
    }

    msgEl.innerHTML = html;
    msgEl.scrollTop = msgEl.scrollHeight;
  }

  function findProducto(nombre: string) {
    const lower = nombre.toLowerCase();
    return getProductos().find(p =>
      p.nombre.toLowerCase().includes(lower) || lower.includes(p.nombre.toLowerCase())
    ) || null;
  }

  function answerQuery(query: string): string {
    const lower = query.toLowerCase();
    const productos = getProductos();
    const lotes = getLotes();

    const matchedProduct = productos.find(p => lower.includes(p.nombre.toLowerCase()));
    if (matchedProduct) {
      const m = computeProductMetrics(matchedProduct.id);
      const productLotes = lotes.filter(l => l.productoId === matchedProduct.id && l.cantidad > 0);
      let answer = `${matchedProduct.nombre}: ${matchedProduct.cantidad} ${matchedProduct.unidad}`;
      if (m.weeklyVelocity > 0) answer += `\nVelocidad: ${m.weeklyVelocity}/sem`;
      if (m.daysToStockout != null) answer += `\nStock para: ~${m.daysToStockout}d`;
      if (productLotes.length > 0) answer += `\n${productLotes.length} lote(s) activo(s)`;
      if (m.expiringLotes > 0) answer += `\n${m.expiringLotes} por vencer`;
      return answer;
    }

    if (lower.includes('vence') || lower.includes('vencimiento')) {
      const now = Date.now();
      const weekFromNow = now + 7 * 86400000;
      const expiring = lotes.filter(l =>
        l.cantidad > 0 && l.vencimiento && l.vencimiento.toDate().getTime() <= weekFromNow && l.vencimiento.toDate().getTime() > now
      );
      if (expiring.length === 0) return 'No hay lotes por vencer esta semana.';
      return `${expiring.length} lote(s) por vencer:\n${expiring.map(l => {
        const days = Math.ceil((l.vencimiento!.toDate().getTime() - now) / 86400000);
        return `- ${l.productoNombre} (${l.numero}) en ${days}d`;
      }).join('\n')}`;
    }

    const total = productos.reduce((s, p) => s + p.cantidad, 0);
    const value = productos.reduce((s, p) => s + p.cantidad * p.precio, 0);
    const zeroStock = productos.filter(p => p.cantidad === 0);
    let answer = `${productos.length} productos\n${total} unidades totales\nValor: $${Math.round(value)}`;
    if (zeroStock.length > 0) answer += `\nSin stock: ${zeroStock.map(p => p.nombre).join(', ')}`;
    return answer;
  }
}
