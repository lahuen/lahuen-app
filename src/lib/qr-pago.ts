import QRCode from 'qrcode';
import { showToast } from './toast';
import { formatCurrency } from './format';

const ALIAS = import.meta.env.VITE_PAGO_ALIAS || 'lahuen.mcp';
const TITULAR = import.meta.env.VITE_PAGO_TITULAR || 'COOPERATIVA DE TRABAJO LAHUEN';
const CVU = import.meta.env.VITE_PAGO_CVU || '0000003100006408028165';

export async function showQrPagoModal(monto?: number): Promise<void> {
  document.getElementById('qr-pago-modal')?.remove();

  let qrDataUrl: string;
  try {
    // QR encodes the alias — MP app recognizes it when scanned
    qrDataUrl = await QRCode.toDataURL(ALIAS, { width: 220, margin: 2 });
  } catch {
    showToast('Error generando QR', 'error');
    return;
  }

  const hasMonto = monto != null && monto > 0;
  const montoFormatted = hasMonto ? formatCurrency(monto!) : '';

  const overlay = document.createElement('div');
  overlay.id = 'qr-pago-modal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box" style="text-align:center">
      <h2 class="modal-title">Pago por transferencia</h2>
      ${hasMonto ? `<p class="qr-pago-monto">${montoFormatted}</p>` : ''}
      <img class="qr-pago-img" src="${qrDataUrl}" alt="QR ${ALIAS}" />
      <div class="qr-pago-alias">
        <span>${ALIAS}</span>
        <button class="btn btn-xs btn-secondary" id="qr-copy-alias">Copiar alias</button>
        ${hasMonto ? `<button class="btn btn-xs btn-secondary" id="qr-copy-monto">Copiar monto</button>` : ''}
      </div>
      <p class="qr-pago-info">${TITULAR}<br/>CVU: ${CVU}</p>
      <div class="modal-footer" style="justify-content:center;gap:var(--sp-2);">
        ${hasMonto && 'share' in navigator ? `<button class="btn btn-secondary" id="qr-share">Compartir</button>` : ''}
        <button class="btn btn-primary" id="qr-close">Cerrar</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  document.getElementById('qr-close')!.addEventListener('click', () => overlay.remove());

  document.getElementById('qr-copy-alias')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(ALIAS);
      showToast('Alias copiado', 'success');
    } catch {
      showToast('No se pudo copiar', 'error');
    }
  });

  document.getElementById('qr-copy-monto')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(String(monto));
      showToast('Monto copiado', 'success');
    } catch {
      showToast('No se pudo copiar', 'error');
    }
  });

  document.getElementById('qr-share')?.addEventListener('click', async () => {
    try {
      await navigator.share({
        title: 'Pago Lahuen',
        text: `Pago por ${montoFormatted}\nAlias: ${ALIAS}\nCVU: ${CVU}\n${TITULAR}`,
      });
    } catch {
      // User cancelled share — ignore
    }
  });
}
