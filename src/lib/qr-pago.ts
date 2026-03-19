import QRCode from 'qrcode';
import { showToast } from './toast';
import { formatCurrency } from './format';

const ALIAS = import.meta.env.VITE_PAGO_ALIAS || 'lahuen.coop.ar';
const TITULAR = import.meta.env.VITE_PAGO_TITULAR || 'COOP DE TRAB LAHUEN LTDA';
const CUIT = import.meta.env.VITE_PAGO_CUIT || '30-71842618-5';

export async function showQrPagoModal(monto?: number): Promise<void> {
  document.getElementById('qr-pago-modal')?.remove();

  let qrDataUrl: string;
  try {
    qrDataUrl = await QRCode.toDataURL(ALIAS, { width: 220, margin: 2 });
  } catch {
    showToast('Error generando QR', 'error');
    return;
  }

  const montoHtml = monto && monto > 0
    ? `<p class="qr-pago-monto">Monto: <strong>${formatCurrency(monto)}</strong></p>`
    : '';

  const overlay = document.createElement('div');
  overlay.id = 'qr-pago-modal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box" style="text-align:center">
      <h2 class="modal-title">Pago por transferencia</h2>
      <img class="qr-pago-img" src="${qrDataUrl}" alt="QR ${ALIAS}" />
      ${montoHtml}
      <div class="qr-pago-alias">
        <span>${ALIAS}</span>
        <button class="btn btn-xs btn-secondary" id="qr-copy-alias">Copiar</button>
      </div>
      <p class="qr-pago-info">${TITULAR} &middot; CUIT ${CUIT}</p>
      <div class="modal-footer" style="justify-content:center">
        <button class="btn btn-primary" id="qr-close">Cerrar</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  document.getElementById('qr-close')!.addEventListener('click', () => overlay.remove());

  document.getElementById('qr-copy-alias')!.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(ALIAS);
      showToast('Alias copiado', 'success');
    } catch {
      showToast('No se pudo copiar', 'error');
    }
  });
}
